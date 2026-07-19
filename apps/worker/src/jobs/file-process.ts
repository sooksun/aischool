// Handles file.process jobs enqueued when completeFileUpload succeeds.
// 1) HEAD object in MinIO — must exist and be the size that was declared
// 2) Malware scan via clamd when SCAN_PROVIDER=clamav (ADR-0009)
// 3) Emit evidence.file.scan_completed outbox + mark registered outbox published
import type { S3Client } from '@aws-sdk/client-s3';
import {
  getEvidenceFileById,
  setFileScanStatus,
  enqueueOutboxEvent,
  markOutboxPublished,
  prisma,
} from '@seip/database';
import { headObject, getObjectStream } from '../s3.js';
import { scanStream } from '../clamav.js';
import type { Env } from '../env.js';

export interface FileProcessPayload {
  file_id: string;
  evidence_id: string;
  school_id: string;
  outbox_event_id?: string;
  /** Set by the re-scan sweep (`scripts/ops/rescan-files.mjs`) so a queue full of
   * these is legible in `worker_job` and distinguishable from upload traffic when
   * something goes wrong mid-sweep. Nothing branches on it. */
  reason?: 'rescan';
}

/** A verdict, plus whether a scanner actually produced it (ADR-0009). */
interface ScanOutcome {
  status: 'clean' | 'blocked' | 'unscanned';
  /** True only when clamd read the bytes and answered. Drives `scanned_at`, which
   * is what a future sweep selects on — so getting this wrong either re-scans
   * everything forever or hides a file that was never checked. */
  scanned: boolean;
}

/**
 * Malware scanning (ADR-0009), the wiring the comment that used to live here
 * described as future work.
 *
 * What was here before CCR-012 matched "eicar"/"virus" against the FILENAME and
 * returned `clean` for everything else, having read no bytes. That verdict drove
 * the UI badge ("ปลอดภัย"), the scan_completed event and the UPL-006 download
 * gate, so the platform asserted a clean bill of health it had never earned. CCR-012
 * deleted it in favour of `unscanned`, on the principle that a stub producing a
 * verdict is worse than no stub — downstream it is indistinguishable from a real
 * result.
 *
 * The rule that principle becomes, now that a real scanner exists: **the only
 * path that writes `clean` is one where clamd returned OK.** Every failure mode —
 * clamd down, timed out, refusing the file as too large — throws, leaving the
 * file `pending` for the worker's existing retry. Unavailable is not safe.
 */
async function scanIfEnabled(
  env: Env,
  s3: S3Client,
  file: { id: string; storageUri: string; byteSize: bigint },
): Promise<ScanOutcome> {
  // Keyed on `!== 'clamav'`, not `=== 'none'`: scanning is opt-in positively, so
  // an absent or unexpected value behaves exactly like the schema's own default
  // (`none`) instead of falling into the scan path. zod rejects bad values at
  // boot, so this only matters for callers that build an Env by hand — which is
  // what every worker test does, and what made three of them fail when this was
  // first written the other way round.
  if (env.SCAN_PROVIDER !== 'clamav') {
    // Honest, and visible: `unscanned` is disclosed in the UI and is the signal
    // that this deployment has no scanner (ADR-0009 §3). No receipt — these are
    // precisely the files a sweep must pick up once a scanner is switched on.
    return { status: 'unscanned', scanned: false };
  }

  // Too big for clamd to stream. Quarantine rather than pass — "could not be
  // checked" is not a clean result (ADR-0009 §4).
  if (file.byteSize > BigInt(env.CLAMAV_MAX_BYTES)) {
    console.warn(
      `[file.process] file ${file.id} is ${file.byteSize} bytes, above CLAMAV_MAX_BYTES `
      + `(${env.CLAMAV_MAX_BYTES}); marking blocked rather than serving it unscanned`,
    );
    // Blocked, but NOT scanned: nothing read these bytes. Leaving the receipt off
    // keeps the file re-checkable, so raising clamd's StreamMaxLength and running
    // the sweep again can legitimately clear it (ADR-0009 §4).
    return { status: 'blocked', scanned: false };
  }

  const body = await getObjectStream(s3, env.S3_BUCKET, file.storageUri);
  const verdict = await scanStream(body, {
    host: env.CLAMAV_HOST,
    port: env.CLAMAV_PORT,
    timeoutMs: env.CLAMAV_TIMEOUT_MS,
  });

  // Past this line clamd has read every byte and answered, so both outcomes earn
  // the receipt. These are the only two `scanned: true` returns in the codebase.
  if (verdict.status === 'infected') {
    console.warn(`[file.process] file ${file.id} BLOCKED — ${verdict.signature}`);
    return { status: 'blocked', scanned: true };
  }
  return { status: 'clean', scanned: true };
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
  //
  // The catch is not cosmetic. S3 HEAD returns no response body, so the SDK has
  // nothing to build a message from and surfaces a bare `UnknownError` — which is
  // what lands in worker_job.last_error, eight times, before the job dies. During
  // normal uploads this is unreachable (the object was just PUT). The re-scan
  // sweep is the first thing to touch old rows in bulk, and it turned three
  // orphaned metadata rows into three identical `UnknownError`s with nothing
  // naming the file or the cause. An operator watching a sweep stall deserves the
  // actual sentence.
  let head;
  try {
    head = await headObject(s3, env.S3_BUCKET, file.storageUri);
  } catch (e) {
    const status = (e as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    if (status === 404 || (e as { name?: string })?.name === 'NotFound') {
      throw new Error(
        `object missing from storage for file ${file.id} (bucket=${env.S3_BUCKET} `
        + `key=${file.storageUri}) — the metadata row outlived its bytes`,
      );
    }
    throw e;
  }
  const storedSize = head.ContentLength;
  const sizeMismatch = storedSize != null && BigInt(storedSize) !== file.byteSize;

  // A stored object that is not the size it was declared to be is quarantined
  // regardless of its contents — and short-circuits the scan, because there is
  // nothing to learn from scanning a file we already refuse to serve.
  const outcome: ScanOutcome = sizeMismatch
    // Refused on metadata alone — no scanner involved, so no receipt, and a
    // re-scan will make the same judgement from the same evidence.
    ? { status: 'blocked', scanned: false }
    : await scanIfEnabled(env, s3, { id: file.id, storageUri: file.storageUri, byteSize: file.byteSize });
  await setFileScanStatus(file.id, outcome.status, { scanned: outcome.scanned });
  const scanStatus = outcome.status;

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
