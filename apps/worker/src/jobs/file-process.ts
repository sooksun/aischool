// Handles file.process jobs enqueued when an upload completes (completeUpload).
// 1) HEAD the object — it must exist and be the size that was declared
// 2) Re-hash it: SHA-256 of the stored bytes must equal the declared checksum
//    (ADR-0018) — evidence.file.verified, and the sha256_verified_at receipt
// 3) Measure video/audio with ffprobe (FR-021) — the server's length replaces
//    the client's, and a clip longer than its category allows is blocked
// 4) Malware scan via clamd when SCAN_PROVIDER=clamav (ADR-0009)
// 5) Emit evidence.file.scan_completed + mark the registered outbox published
import type { S3Client } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import {
  getEvidenceFileById,
  setFileScanStatus,
  markFileSha256Verified,
  markDuplicateIfAny,
  recordMediaProbe,
  createRenditionFile,
  hasRendition,
  setFileMediaState,
  enqueueOutboxEvent,
  markOutboxPublished,
  prisma,
} from '@seip/database';
import { headObject, getObjectStream, putObjectFromFile } from '../s3.js';
import { scanStream } from '../clamav.js';
import { isProbeable, probeMedia, localCopy, probeFile, transcodeReview720p, makePosterJpeg } from '../media-probe.js';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
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
 * Duration is MEASURED (FR-021): ffprobe reads the stored object's container
 * header (media-probe.ts). It once was estimated as byteSize / 500KB/s, clamped
 * to the cap, which looked like a check while guaranteeing a pass (2026-07-18
 * audit). The client's declared length still gates initiate (VAL-002); the
 * measured one replaces it, and a clip longer than its category's cap (with 1 s
 * of container slack) is blocked. Without ffprobe the length stays as declared
 * and is never invented.
 */
const DURATION_SLACK_MS = 1000;

/**
 * FR-021: server-made copies of an original, stored next to it (the original
 * is never touched) and listed as child files — the 720p copy a browser plays
 * (review_720p) and a small preview picture (poster). Both carry no location
 * or other metadata. Best effort: a failed render leaves the original, which
 * is still served, as it was.
 */
async function makeRendition(
  env: Env, s3: S3Client,
  file: { id: string; evidenceId: string; storageUri: string; originalFilename: string },
  scanStatus: 'clean' | 'unscanned',
  role: 'review_720p' | 'poster',
) {
  const spec = role === 'review_720p'
    ? { ext: '720p.mp4', type: 'video/mp4', render: transcodeReview720p }
    : { ext: 'poster.jpg', type: 'image/jpeg', render: makePosterJpeg };
  const copy = await localCopy((await getObjectStream(s3, env.S3_BUCKET, file.storageUri)) as Readable);
  try {
    const out = join(copy.dir, `out.${spec.ext}`);
    if (!(await spec.render(env.FFMPEG_PATH, copy.path, out))) return;
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(out)) hash.update(chunk as Buffer);
    const key = `${file.storageUri}.${role}.${spec.ext.split('.').pop()}`;
    const size = await putObjectFromFile(s3, env.S3_BUCKET, key, out, spec.type);
    const probe = await probeFile(env.FFPROBE_PATH, out);
    await createRenditionFile({
      parentFileId: file.id, evidenceId: file.evidenceId, role, storageUri: key, contentType: spec.type,
      byteSize: BigInt(size), checksumSha256: hash.digest('hex'), scanStatus,
      durationMs: role === 'poster' ? null : probe?.durationMs ?? null, width: probe?.width ?? null, height: probe?.height ?? null,
      originalFilename: file.originalFilename.replace(/\.[^.]+$/, '') + '.' + spec.ext,
    });
  } finally {
    await copy.cleanup();
  }
}

/** SHA-256 (hex) of the stored object, streamed — never buffered whole. */
async function sha256OfStoredObject(env: Env, s3: S3Client, key: string): Promise<string> {
  const body = (await getObjectStream(s3, env.S3_BUCKET, key)) as Readable;
  const hash = createHash('sha256');
  for await (const chunk of body) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export async function processFileJob(
  env: Env,
  s3: S3Client,
  payload: FileProcessPayload,
): Promise<void> {
  const file = await getEvidenceFileById(payload.file_id);
  if (!file) {
    throw new Error(`file ${payload.file_id} not found`);
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
  // The declared checksum used to be recorded and never compared with anything
  // (ADR-0018). Now the stored bytes are re-hashed: a mismatch is quarantined
  // exactly like a size mismatch, and a match earns the sha256_verified_at receipt
  // that offline clients wait for before deleting their local copy.
  let hashMismatch = false;
  if (!sizeMismatch) {
    hashMismatch = (await sha256OfStoredObject(env, s3, file.storageUri)) !== file.checksumSha256;
    if (!hashMismatch) {
      await markFileSha256Verified(file.id);
      // FR-012: the same bytes already in this person's portfolio — a warning on
      // the file, never a refusal; the duplicate is not analysed again (P3).
      await markDuplicateIfAny(file.id);
    }
    await enqueueOutboxEvent({
      eventType: 'evidence.file.verified',
      schoolId: payload.school_id,
      actorUserId: null,
      payload: { evidence_id: payload.evidence_id, file_id: file.id, sha256_matched: !hashMismatch },
    });
  }

  // FR-021: measure, then enforce the category's cap on the measured length.
  let tooLong = false;
  if (!sizeMismatch && !hashMismatch && env.MEDIA_PROBE === 'ffprobe' && isProbeable(file.contentType)) {
    const probe = await probeMedia(env.FFPROBE_PATH, (await getObjectStream(s3, env.S3_BUCKET, file.storageUri)) as Readable);
    if (probe) {
      await recordMediaProbe(file.id, probe);
      const cap = file.evidence.category?.maxDurationSeconds;
      tooLong = cap != null && probe.durationMs !== null && probe.durationMs > cap * 1000 + DURATION_SLACK_MS;
      if (tooLong) console.warn(`[file.process] file ${file.id} BLOCKED — measured ${probe.durationMs} ms > cap ${cap}s`);
    }
  }

  const outcome: ScanOutcome = sizeMismatch || hashMismatch || tooLong
    // Refused on integrity alone — no scanner involved, so no receipt, and a
    // re-scan will make the same judgement from the same evidence.
    ? { status: 'blocked', scanned: false }
    : await scanIfEnabled(env, s3, { id: file.id, storageUri: file.storageUri, byteSize: file.byteSize });
  await setFileScanStatus(file.id, outcome.status, { scanned: outcome.scanned });
  // A sanitised original (CDR) is rendered from nothing — only a clean or
  // unscanned one has renditions.
  if ((outcome.status === 'clean' || outcome.status === 'unscanned') && file.role === 'original' && env.MEDIA_RENDITIONS === 'on') {
    const isVideo = file.contentType.startsWith('video/');
    if (isVideo && !(await hasRendition(file.id, 'review_720p'))) await makeRendition(env, s3, file, outcome.status, 'review_720p');
    if ((isVideo || file.contentType.startsWith('image/')) && !(await hasRendition(file.id, 'poster'))) {
      await makeRendition(env, s3, file, outcome.status, 'poster');
    }
  }
  // Renditions (720p review copy, audio proxy, OCR) arrive in P2/P3; until then
  // a verified original is the whole of the item.
  await setFileMediaState(file.id, sizeMismatch || hashMismatch || tooLong ? 'failed' : 'ready');
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
