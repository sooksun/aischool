// Handles file.process jobs enqueued when completeFileUpload succeeds.
// 1) HEAD object in MinIO (must exist)
// 2) Virus-scan stub (deterministic rules for tests + safe default clean)
// 3) Duration probe for video when duration_seconds is null
// 4) Emit evidence.file.scan_completed outbox + mark registered outbox published
import type { S3Client } from '@aws-sdk/client-s3';
import {
  getEvidenceFileById,
  setFileScanStatus,
  setFileDurationSeconds,
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
 * Stub duration probe when client did not send duration_seconds.
 * Real deployment can replace with ffprobe; formula is documented and bounded
 * to the framework's ≤10 minute inspiration-video rule upper bound for safety.
 */
export function stubProbeDurationSeconds(byteSize: bigint, contentType: string): number | null {
  if (!contentType.startsWith('video/')) return null;
  // ~500 KB/s heuristic, clamp 1..600 seconds
  const approx = Math.round(Number(byteSize) / 500_000);
  return Math.min(600, Math.max(1, approx || 1));
}

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

  // Object must exist in storage (SEC-UPL path integrity)
  await headObject(s3, env.S3_BUCKET, file.storageUri);

  const scanStatus = stubScanStatus(file.originalFilename);
  await setFileScanStatus(file.id, scanStatus);

  if (file.durationSeconds == null) {
    const probed = stubProbeDurationSeconds(file.byteSize, file.contentType);
    if (probed != null) {
      await setFileDurationSeconds(file.id, probed);
    }
  }

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
