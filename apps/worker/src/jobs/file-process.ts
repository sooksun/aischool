// Handles file.process jobs enqueued when completeFileUpload succeeds.
// 1) HEAD object in MinIO (must exist)
// 2) Virus-scan stub (deterministic rules for tests + safe default clean)
// 3) Duration probe for video when duration_seconds is null
// 4) Emit evidence.file.scan_completed outbox + mark registered outbox published
import type { S3Client } from '@aws-sdk/client-s3';
import {
  getEvidenceFileById,
  setFileScanStatus,
  enqueueOutboxEvent,
  markOutboxPublished,
  prisma,
} from '@seip/database';
import { headObject } from '../s3.js';
import type { Env } from '../env.js';

export interface FileProcessPayload {
  file_id: string;
  evidence_id: string;
  school_id: string;
  outbox_event_id?: string;
}

/**
 * Stub scanner — production would shell out to ClamAV (or similar).
 * Deterministic rules so integration tests don't need a real AV engine:
 * - filename containing "eicar" or "virus" (case-insensitive) → blocked
 * - otherwise clean after HEAD succeeds
 */
export function stubScanStatus(originalFilename: string): 'clean' | 'blocked' {
  const lower = originalFilename.toLowerCase();
  if (lower.includes('eicar') || lower.includes('virus')) return 'blocked';
  return 'clean';
}

/**
 * There is deliberately NO duration probe here.
 *
 * This used to estimate duration as byteSize / 500KB/s, clamped to 1..600s, and
 * write it to evidence_file.duration_seconds — a column the API serves and the
 * ว9 ≤600s rule is expressed in. Two problems: the number was invented rather
 * than measured, and the clamp meant it could never exceed the cap, so it looked
 * like a check while guaranteeing a pass. Enforcement now happens at initiate,
 * which requires the client to declare a duration for a capped category
 * (VAL-002) instead of letting a fabricated value stand in for one.
 *
 * A real probe means reading the container header (ffprobe or equivalent). Until
 * that exists, duration_seconds stays null when the client did not supply it —
 * null is honest, an estimate is not (2026-07-18 audit).
 */

export async function processFileJob(
  env: Env,
  s3: S3Client,
  payload: FileProcessPayload,
): Promise<void> {
  const file = await getEvidenceFileById(payload.school_id, payload.file_id);
  if (!file) {
    throw new Error(`file ${payload.file_id} not found for school ${payload.school_id}`);
  }
  if (file.evidenceId !== payload.evidence_id) {
    throw new Error('payload evidence_id does not match file row');
  }

  // Object must exist in storage (SEC-UPL path integrity), and be the size the
  // client claimed. presignUpload signs ContentLength so a mismatch cannot happen
  // through the normal upload path — this is the backstop for rows written any
  // other way, and the point where the HeadObject result stops being discarded
  // (2026-07-18 audit). A file that is not what it said it was is never served:
  // 'blocked' is the state getEvidenceFileDownloadUrl already refuses (UPL-006).
  const head = await headObject(s3, env.S3_BUCKET, file.storageUri);
  const storedSize = head.ContentLength;
  const sizeMismatch = storedSize != null && BigInt(storedSize) !== file.byteSize;

  const scanStatus = sizeMismatch ? 'blocked' : stubScanStatus(file.originalFilename);
  await setFileScanStatus(file.id, scanStatus);

  await enqueueOutboxEvent({
    eventType: 'evidence.file.scan_completed',
    schoolId: payload.school_id,
    actorUserId: null,
    payload: {
      evidence_id: payload.evidence_id,
      file_id: file.id,
      scan_status: scanStatus,
    },
  });

  if (payload.outbox_event_id) {
    const existing = await prisma.outboxEvent.findUnique({
      where: { id: payload.outbox_event_id },
    });
    if (existing && existing.publishedAt == null) {
      await markOutboxPublished(payload.outbox_event_id);
    }
  }
}
