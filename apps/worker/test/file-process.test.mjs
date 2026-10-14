// SEIP-WORKER-001 — file.process + outbox against real PostgreSQL + S3-compatible storage.
process.env.NODE_ENV = 'test';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPrismaClient } from '../../../prisma/client.mjs';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import {
  registerEvidenceFileWithWorkerJobs,
  listFilesForRescan,
  countFilesForRescan,
  listQueuedFileProcessTargets,
  enqueueWorkerJob,
} from '@seip/database';
import { cleanupSchools, trackSchools } from '../../../tests/helpers/db-cleanup.mjs';
import { runOnce } from '../dist/loop.js';

const prisma = createPrismaClient();
const env = {
  DATABASE_URL: process.env.DATABASE_URL,
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
  S3_BUCKET: process.env.S3_BUCKET ?? 'seip-evidence',
  S3_ACCESS_KEY: process.env.S3_ACCESS_KEY ?? 'seip_dev',
  S3_SECRET_KEY: process.env.S3_SECRET_KEY ?? 'seip_dev_only_change_me',
  S3_REGION: process.env.S3_REGION ?? 'us-east-1',
  NODE_ENV: 'test',
  WORKER_POLL_MS: 100,
  WORKER_GC_AFTER_DAYS: 0, // GC immediately for soft-deleted in tests
  // Explicit rather than relying on the absent-value fallback: these tests assert
  // the no-scanner behaviour, so they should say so (ADR-0009).
  SCAN_PROVIDER: 'none',
  // This object is hand-built, so it skips loadEnv's zod defaults — anything the
  // scan path reads has to be spelled out here or it arrives undefined. Omitting
  // it made `BigInt(env.CLAMAV_MAX_BYTES)` throw, which the worker correctly
  // treated as a failed scan and left the file `pending`. Fail-closed did its
  // job; the test was simply lying about the environment.
  CLAMAV_MAX_BYTES: 25 * 1024 * 1024,
  // FR-021: the probe runs for video/audio. CI installs ffmpeg for this suite.
  MEDIA_PROBE: 'ffprobe',
  MEDIA_RENDITIONS: 'on',
  FFMPEG_PATH: process.env.FFMPEG_PATH ?? 'ffmpeg',
  FFPROBE_PATH: process.env.FFPROBE_PATH ?? 'ffprobe',
};

const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  forcePathStyle: true,
  credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
});

async function putObject(key, body, contentType) {
  await s3.send(new PutObjectCommand({
    Bucket: env.S3_BUCKET, Key: key, Body: body, ContentType: contentType,
  }));
}

const created = trackSchools();

async function fixture(filename = 'lesson.pdf', contentType = 'application/pdf', declaredByteSize = null, declaredChecksum = null) {
  const school = await prisma.school.create({
    data: { code: `w-${randomUUID().slice(0, 8)}`, name: 'Worker School' },
  });
  created.add(school.id);
  await prisma.rankLevel.upsert({
    where: { code: 'w_kru' },
    create: { code: 'w_kru', roleFamily: 'teacher', labelTh: 'ครู', sortOrder: 2 },
    update: {},
  });
  const user = await prisma.userAccount.create({
    data: {
      email: `w-${randomUUID().slice(0, 8)}@example.com`,
      displayName: 'W',
      status: 'active',
      passwordHash: 'x',
      person: { create: { displayName: 'W' } },
    },
  });
  const personnel = await prisma.personnelProfile.create({
    data: {
      schoolId: school.id,
      userId: user.id,
      personId: user.personId,
      fullName: 'Teacher W',
      positionRole: 'teacher',
      rankLevelCode: 'w_kru',
    },
  });
  const cat = await prisma.evidenceCategory.upsert({
    where: { code: 'other_document' },
    create: {
      code: 'other_document',
      labelTh: 'เอกสาร',
      allowedMimeTypes: ['application/pdf', 'video/mp4'],
      maxByteSize: BigInt(50 * 1024 * 1024),
    },
    update: {},
  });
  const evidence = await prisma.evidence.create({
    data: {
      originSchoolId: school.id,
      ownerPersonId: personnel.personId,
      uploadedByUserId: user.id,
      categoryId: cat.id,
      title: 't',
      status: 'draft',
    },
  });
  const fileId = randomUUID();
  const key = `evidence/${school.id}/${evidence.id}/${fileId}/${filename}`;
  const body = Buffer.from('hello-worker-bytes');
  await putObject(key, body, contentType);

  const file = await registerEvidenceFileWithWorkerJobs({
    id: fileId,
    evidenceId: evidence.id,
    storageUri: key,
    contentType,
    byteSize: BigInt(declaredByteSize ?? body.length),
    // The worker re-hashes the stored object (CCR-017) — the declared checksum
    // has to be the real one or the file is blocked as corrupted.
    checksumSha256: declaredChecksum ?? createHash('sha256').update(body).digest('hex'),
    durationSeconds: null,
    originalFilename: filename,
    schoolId: school.id,
    actorUserId: user.id,
  });

  return { school, evidence, file, key, user };
}

before(async () => {
  // ensure bucket exists
  try {
    await s3.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: 'nonexistent-probe' }));
  } catch {
    // ignore — bucket may exist
  }
});

after(async () => {
  // Not optional hygiene. This suite registers file rows whose objects were
  // never uploaded (`lost.pdf`, and anything left `pending` by a deliberately
  // unreachable scanner). To the ADR-0009 re-scan sweep those are
  // indistinguishable from production evidence whose bytes were lost: each one
  // burns 8 worker retries and then sits in the census as an unexplained orphan.
  // Three of them survived into the first full-store sweep and had to be purged
  // by hand.
  await cleanupSchools(prisma, created.ids(), created.userIds());
  await prisma.$disconnect();
});

test('the worker does not invent a duration it never measured', async () => {
  const { file } = await fixture('teach.mp4', 'video/mp4');
  assert.equal(file.durationSeconds, null);
  await runOnce(env, s3, { scheduleGc: false });
  const updated = await prisma.evidenceFile.findUniqueOrThrow({ where: { id: file.id } });
  assert.equal(
    updated.durationSeconds, null,
    'duration must stay null until something actually probes the container — a byte-size estimate ' +
    'written into this column reads as a measurement and cannot be told apart from one downstream',
  );
  assert.equal(updated.scanStatus, 'unscanned');
});

test('file.process blocks a file whose stored size does not match what was declared', async () => {
  // Declared 18 bytes at initiate/complete, but the object in storage is bigger.
  // Presigned ContentLength makes this unreachable through the normal path; the
  // worker is the backstop for anything written another way (2026-07-18 audit).
  const { file } = await fixture('mismatch.pdf', 'application/pdf', 9_999_999);
  await runOnce(env, s3, { scheduleGc: false });
  const updated = await prisma.evidenceFile.findUniqueOrThrow({ where: { id: file.id } });
  assert.equal(updated.scanStatus, 'blocked', 'a size mismatch must never be served as clean');
  assert.equal(updated.scannedAt, null, 'refused on metadata alone — nothing read the bytes');
});

test('file.process re-hashes the stored bytes: a match is recorded, the file becomes ready', async () => {
  const { file } = await fixture('hash-ok.pdf');
  await runOnce(env, s3, { scheduleGc: false });
  const updated = await prisma.evidenceFile.findUniqueOrThrow({ where: { id: file.id } });
  assert.ok(updated.sha256VerifiedAt, 'sha256_verified_at is what lets a client delete its local copy');
  assert.equal(updated.mediaState, 'ready');
  const verified = await prisma.outboxEvent.findMany({ where: { eventType: 'evidence.file.verified' } });
  assert.ok(verified.some((e) => e.payload?.file_id === file.id), 'evidence.file.verified is emitted');
});

test('file.process blocks a file whose stored bytes do not hash to the declared checksum', async () => {
  const { file } = await fixture('hash-bad.pdf', 'application/pdf', null, 'f'.repeat(64));
  await runOnce(env, s3, { scheduleGc: false });
  const updated = await prisma.evidenceFile.findUniqueOrThrow({ where: { id: file.id } });
  assert.equal(updated.scanStatus, 'blocked', 'corrupted bytes must never be served');
  assert.equal(updated.sha256VerifiedAt, null);
  assert.equal(updated.mediaState, 'failed');
});

test('file.process marks unscanned and publishes outbox after register', async () => {
  const { file, evidence } = await fixture('clean-lesson.pdf');

  const pendingJobs = await prisma.workerJob.count({
    where: { status: 'pending', jobType: 'file.process' },
  });
  assert.ok(pendingJobs >= 1);

  await runOnce(env, s3, { scheduleGc: false });

  const updated = await prisma.evidenceFile.findUniqueOrThrow({ where: { id: file.id } });
  assert.equal(updated.scanStatus, 'unscanned', 'no scanner ran, so the platform must not claim clean');

  const allScan = await prisma.outboxEvent.findMany({
    where: { eventType: 'evidence.file.scan_completed' },
  });
  const mine = allScan.filter((e) => e.payload?.file_id === file.id);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].payload.scan_status, 'unscanned');

  const registered = await prisma.outboxEvent.findMany({
    where: { eventType: 'evidence.file.registered' },
  });
  const reg = registered.find((e) => e.payload?.file_id === file.id);
  assert.ok(reg);
  // After job + outbox dispatch, registered event should be marked published
  assert.ok(reg.publishedAt != null, 'registered outbox should be marked published');

  const active = await prisma.evidence.findUniqueOrThrow({ where: { id: evidence.id } });
  assert.equal(active.status, 'active');
});

test('a filename that looks like malware is NOT treated as a scan result', async () => {
  // The removed stub blocked on the substring "eicar"/"virus" in the filename and
  // called everything else clean. Renaming a file is not a scan in either
  // direction, so this now reports unscanned like any other file — the blocked
  // path is earned by the size check, not by string matching (CCR-012).
  const { file } = await fixture('eicar-test.pdf');
  await runOnce(env, s3, { scheduleGc: false });
  const updated = await prisma.evidenceFile.findUniqueOrThrow({ where: { id: file.id } });
  assert.equal(updated.scanStatus, 'unscanned');
});


// ── malware scanning through the real job (ADR-0009) ──
//
// The unit tests in clamav-scan.test.mjs cover the protocol. These cover the
// thing that actually protects a reviewer: what processFileJob writes to
// scan_status, which is what the UPL-006 download gate reads.

test('SCAN_PROVIDER=none leaves the honest `unscanned` — it does not invent a verdict', async () => {
  const { file, school, evidence } = await fixture('plain.pdf');
  await runOnce({ ...env, SCAN_PROVIDER: 'none' }, s3, { scheduleGc: false });
  const after = await prisma.evidenceFile.findUnique({ where: { id: file.id } });
  assert.equal(after.scanStatus, 'unscanned');
  assert.equal(
    after.scannedAt, null,
    'no scanner ran, so there must be no receipt — this null is what makes the file '
    + 'selectable by the re-scan sweep once a scanner is switched on',
  );
  assert.equal(school.id.length, 36);
  assert.ok(evidence.id);
});

test('a file above CLAMAV_MAX_BYTES is blocked, not waved through', async () => {
  // "Too big for the scanner to read" is not "safe" (ADR-0009 §4). The previous
  // generation of this code would have called it clean.
  const { file } = await fixture('big.pdf');
  await runOnce(
    { ...env, SCAN_PROVIDER: 'clamav', CLAMAV_MAX_BYTES: 1, CLAMAV_HOST: '127.0.0.1', CLAMAV_PORT: 3310, CLAMAV_TIMEOUT_MS: 5_000 },
    s3,
    { scheduleGc: false },
  );
  const after = await prisma.evidenceFile.findUnique({ where: { id: file.id } });
  assert.equal(after.scanStatus, 'blocked');
  assert.equal(
    after.scannedAt, null,
    'blocked on size WITHOUT being read, so no receipt: raising CLAMAV_MAX_BYTES and '
    + 're-running the sweep must be able to reconsider this file',
  );
});

test('an unreachable scanner leaves the file pending — never clean', async () => {
  // THE test. The file must remain undownloadable (UPL-006 refuses `pending`)
  // rather than acquiring a verdict nobody earned.
  //
  // Asserted on scan_status, not on runOnce throwing: runOnce deliberately
  // isolates per-job errors so one bad job cannot stop the loop, so the throw
  // never reaches the caller. What a reviewer is protected by is the column.
  const { file } = await fixture('unreachable.pdf');
  await runOnce(
    { ...env, SCAN_PROVIDER: 'clamav', CLAMAV_HOST: '127.0.0.1', CLAMAV_PORT: 1, CLAMAV_TIMEOUT_MS: 2_000 },
    s3,
    { scheduleGc: false },
  );

  const after = await prisma.evidenceFile.findUnique({ where: { id: file.id } });
  assert.equal(after.scanStatus, 'pending', 'a file whose scan failed must stay pending, not become clean');
  assert.equal(after.scannedAt, null, 'a failed scan is not a scan');

  // Clean up the job this test deliberately made unsatisfiable. Left behind it
  // retries forever against a port nothing listens on, and — because every test
  // file shares one worker_job queue — the next runOnce anywhere claims it
  // instead of its own. That is what broke three sibling tests the first time
  // this was written (see the caveat in docs/qa/QUALITY-GATES.md).
  await prisma.workerJob.deleteMany({
    where: { jobType: 'file.process', payload: { path: ['file_id'], equals: file.id } },
  });
});


// ── the re-scan sweep (ADR-0009 follow-up) ──

const REAL_CLAMD = process.env.CLAMAV_HOST
  ? { host: process.env.CLAMAV_HOST, port: Number(process.env.CLAMAV_PORT ?? 3310) }
  : null;

test('a real scan writes the receipt that stops the sweep re-selecting the file', {
  skip: !REAL_CLAMD,
}, async () => {
  const { file } = await fixture('genuinely-fine.pdf');
  await runOnce(
    { ...env, SCAN_PROVIDER: 'clamav', CLAMAV_HOST: REAL_CLAMD.host, CLAMAV_PORT: REAL_CLAMD.port, CLAMAV_TIMEOUT_MS: 30_000 },
    s3,
    { scheduleGc: false },
  );

  const after = await prisma.evidenceFile.findUniqueOrThrow({ where: { id: file.id } });
  assert.equal(after.scanStatus, 'clean');
  assert.ok(
    after.scannedAt instanceof Date,
    'clamd read the bytes and answered, so this clean IS backed by a scan — the receipt is '
    + 'what distinguishes it from the 81 stub-written `clean` rows the sweep exists to correct',
  );

  const stillSelected = await countFilesForRescan({
    statuses: ['pending', 'clean', 'unscanned', 'blocked'],
  });
  const mine = await listFilesForRescan({
    statuses: ['pending', 'clean', 'unscanned', 'blocked'], limit: stillSelected + 1,
  });
  assert.ok(
    !mine.some((c) => c.id === file.id),
    'a verified file must drop out of the sweep, or every run re-scans the whole store forever',
  );
});

test('the sweep corrects a stub-written `clean` row that was never actually scanned', {
  skip: !REAL_CLAMD,
}, async () => {
  // This reproduces the real defect. Before CCR-012, file.process matched
  // "eicar"/"virus" against the FILENAME, read nothing, and wrote `clean`. Those
  // rows are still in production databases: downloadable, badged ปลอดภัย, never
  // verified. The sweep has to find them even though their status says clean —
  // which is exactly why it selects on scanned_at, not on scan_status.
  const { file, evidence, school } = await fixture('stub-era.pdf');
  await prisma.evidenceFile.update({
    where: { id: file.id },
    data: { scanStatus: 'clean', scannedAt: null },
  });
  await prisma.workerJob.deleteMany({
    where: { jobType: 'file.process', payload: { path: ['file_id'], equals: file.id } },
  });

  // Selected despite reading `clean`.
  const candidates = await listFilesForRescan({
    statuses: ['pending', 'clean', 'unscanned'], schoolId: school.id, limit: 50,
  });
  assert.ok(
    candidates.some((c) => c.id === file.id),
    'a `clean` row with no receipt must be selected — status alone cannot be trusted',
  );

  // What the CLI does: enqueue, then let the ordinary worker path decide.
  await enqueueWorkerJob({
    jobType: 'file.process',
    payload: {
      file_id: file.id, evidence_id: evidence.id, school_id: school.id, reason: 'rescan',
    },
  });
  await runOnce(
    { ...env, SCAN_PROVIDER: 'clamav', CLAMAV_HOST: REAL_CLAMD.host, CLAMAV_PORT: REAL_CLAMD.port, CLAMAV_TIMEOUT_MS: 30_000 },
    s3,
    { scheduleGc: false },
  );

  const after = await prisma.evidenceFile.findUniqueOrThrow({ where: { id: file.id } });
  assert.ok(after.scannedAt instanceof Date, 'the sweep must leave a receipt behind');

  const stillCandidate = await listFilesForRescan({
    statuses: ['pending', 'clean', 'unscanned'], schoolId: school.id, limit: 50,
  });
  assert.ok(
    !stillCandidate.some((c) => c.id === file.id),
    're-running the sweep must not pick the same file up forever',
  );
});

test('a metadata row whose object is gone fails with a sentence, not `UnknownError`', async () => {
  // S3 HEAD has no response body, so a 404 reaches the SDK as a bare
  // `UnknownError` — eight identical useless rows in worker_job.last_error before
  // the job dies. Unreachable during normal uploads; the re-scan sweep is what
  // touches old rows in bulk, and it produced exactly this on the first real run.
  const { file } = await fixture('lost.pdf');
  await prisma.evidenceFile.update({
    where: { id: file.id }, data: { storageUri: 'evidence/definitely/not/here.pdf' },
  });
  await runOnce(env, s3, { scheduleGc: false });

  const job = await prisma.workerJob.findFirstOrThrow({
    where: { jobType: 'file.process', payload: { path: ['file_id'], equals: file.id } },
  });
  assert.match(job.lastError ?? '', /object missing from storage/);
  assert.match(job.lastError ?? '', new RegExp(file.id), 'the message must name the file');

  const after = await prisma.evidenceFile.findUniqueOrThrow({ where: { id: file.id } });
  assert.equal(after.scanStatus, 'pending', 'a file we could not read keeps no verdict');
  assert.equal(after.scannedAt, null);

  // Unsatisfiable by construction — same shared-queue cleanup as above.
  await prisma.workerJob.deleteMany({
    where: { jobType: 'file.process', payload: { path: ['file_id'], equals: file.id } },
  });
});

test('the sweep skips soft-deleted evidence and files already queued', async () => {
  const { file, school, evidence } = await fixture('doomed.pdf');
  await prisma.evidenceFile.update({
    where: { id: file.id }, data: { scanStatus: 'unscanned', scannedAt: null },
  });

  // Already queued by registerEvidenceFileWithWorkerJobs — the guard that stops a
  // re-run piling a second job onto the same file.
  const queued = await listQueuedFileProcessTargets();
  assert.ok(queued.has(file.id), 'a pending file.process job must be visible to the guard');

  // Soft-deleted: storage GC will delete the object, so a job queued now would
  // fail on a missing object and burn its 8 retries for nothing.
  await prisma.evidence.update({ where: { id: evidence.id }, data: { deletedAt: new Date() } });
  const candidates = await listFilesForRescan({
    statuses: ['pending', 'clean', 'unscanned', 'blocked'], schoolId: school.id, limit: 50,
  });
  assert.ok(
    !candidates.some((c) => c.id === file.id),
    'soft-deleted evidence is already unreachable through the API; scanning it is wasted clamd time',
  );

  await prisma.workerJob.deleteMany({
    where: { jobType: 'file.process', payload: { path: ['file_id'], equals: file.id } },
  });
});

test('FR-012: the same verified bytes twice in one portfolio mark the later file as a duplicate; another person is not affected', async () => {
  const first = await fixture('dup-a.pdf');
  await runOnce(env, s3, { scheduleGc: false });

  // A second item, same owner, same bytes.
  const evidence2 = await prisma.evidence.create({
    data: {
      originSchoolId: first.school.id, ownerPersonId: first.evidence.ownerPersonId, uploadedByUserId: first.user.id,
      categoryId: first.evidence.categoryId, title: 'again', status: 'draft',
    },
  });
  const body = Buffer.from('hello-worker-bytes');
  const fileId = randomUUID();
  const key = `evidence/${first.school.id}/${evidence2.id}/${fileId}/dup-b.pdf`;
  await putObject(key, body, 'application/pdf');
  const second = await registerEvidenceFileWithWorkerJobs({
    id: fileId, evidenceId: evidence2.id, storageUri: key, contentType: 'application/pdf',
    byteSize: BigInt(body.length), checksumSha256: createHash('sha256').update(body).digest('hex'),
    durationSeconds: null, originalFilename: 'dup-b.pdf', schoolId: first.school.id, actorUserId: first.user.id,
  });
  const stranger = await fixture('dup-c.pdf');
  await runOnce(env, s3, { scheduleGc: false });

  const a = await prisma.evidenceFile.findUniqueOrThrow({ where: { id: first.file.id } });
  const b = await prisma.evidenceFile.findUniqueOrThrow({ where: { id: second.id } });
  const c = await prisma.evidenceFile.findUniqueOrThrow({ where: { id: stranger.file.id } });
  assert.equal(a.duplicateOfFileId, null, 'the first copy is the original');
  assert.equal(b.duplicateOfFileId, a.id, 'the later copy points at it');
  assert.equal(c.duplicateOfFileId, null, "another person's identical file is theirs, not a duplicate");
  assert.equal(b.mediaState, 'ready', 'a warning, never a refusal');
});


/** A real 3-second 320x240 MP4, made by ffmpeg. */
function clip(seconds = 3, size = '320x240') {
  const dir = mkdtempSync(join(tmpdir(), 'seip-clip-'));
  const out = join(dir, 'clip.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `testsrc=size=${size}:rate=10:duration=${seconds}`, '-pix_fmt', 'yuv420p',
    '-metadata', 'location=+13.7563+100.5018/', out]);
  return readFileSync(out);
}

async function videoFixture(maxDurationSeconds, bytes) {
  const base = await fixture('probe.pdf');
  const cat = await prisma.evidenceCategory.create({
    data: { code: `probe-${randomUUID()}`, labelTh: 'วิดีโอ', allowedMimeTypes: ['video/mp4'], maxDurationSeconds },
  });
  const evidence = await prisma.evidence.create({
    data: { originSchoolId: base.school.id, ownerPersonId: base.evidence.ownerPersonId, uploadedByUserId: base.user.id, categoryId: cat.id, title: 'v', status: 'draft' },
  });
  const fileId = randomUUID();
  const key = `evidence/${base.school.id}/${evidence.id}/${fileId}/clip.mp4`;
  await putObject(key, bytes, 'video/mp4');
  const file = await registerEvidenceFileWithWorkerJobs({
    id: fileId, evidenceId: evidence.id, storageUri: key, contentType: 'video/mp4', byteSize: BigInt(bytes.length),
    checksumSha256: createHash('sha256').update(bytes).digest('hex'),
    // What the client claimed: far shorter than the truth.
    durationSeconds: 1, originalFilename: 'clip.mp4', schoolId: base.school.id, actorUserId: base.user.id,
  });
  return file;
}

test('FR-021: the server measures a video and its length replaces the declared one', async () => {
  const file = await videoFixture(600, clip(3));
  await runOnce(env, s3, { scheduleGc: false });
  const row = await prisma.evidenceFile.findUniqueOrThrow({ where: { id: file.id } });
  assert.ok(Math.abs(row.durationMs - 3000) < 200, `measured ${row.durationMs} ms`);
  assert.equal(row.durationSeconds, 3);
  assert.deepEqual([row.width, row.height], [320, 240]);
  assert.equal(row.mediaState, 'ready');
});

test('FR-021: a clip longer than its category allows is blocked on the measured length', async () => {
  const file = await videoFixture(1, clip(3));
  await runOnce(env, s3, { scheduleGc: false });
  const row = await prisma.evidenceFile.findUniqueOrThrow({ where: { id: file.id } });
  assert.equal(row.scanStatus, 'blocked');
  assert.equal(row.mediaState, 'failed');
});

test('a file whose item moved school before processing is still processed', async () => {
  const { file, evidence } = await fixture('moved.pdf');
  const other = await prisma.school.create({ data: { code: `w-moved-${randomUUID().slice(0, 8)}`, name: 'Moved to' } });
  created.add(other.id);
  await prisma.evidence.update({ where: { id: evidence.id }, data: { originSchoolId: other.id } });
  await runOnce(env, s3, { scheduleGc: false });
  const row = await prisma.evidenceFile.findUniqueOrThrow({ where: { id: file.id } });
  assert.ok(row.sha256VerifiedAt, 'verified despite the job naming the old school');
});

test('FR-021: a video gets a 720p browser copy, stored apart from the untouched original, without location metadata', async () => {
  const file = await videoFixture(600, clip(2, '1280x960'));
  await runOnce(env, s3, { scheduleGc: false });
  const rendition = await prisma.evidenceFile.findFirst({ where: { parentFileId: file.id, role: 'review_720p' } });
  assert.ok(rendition, 'a review_720p child row exists');
  assert.deepEqual([rendition.width, rendition.height], [960, 720]);
  assert.equal(rendition.contentType, 'video/mp4');
  assert.ok(rendition.sha256VerifiedAt);
  assert.notEqual(rendition.storageUri, file.storageUri, 'the original object is not overwritten');
  const head = await s3.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: rendition.storageUri }));
  assert.equal(Number(head.ContentLength), Number(rendition.byteSize));

  const { GetObjectCommand } = await import('@aws-sdk/client-s3');
  const body = Buffer.from(await (await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: rendition.storageUri }))).Body.transformToByteArray());
  assert.ok(!body.includes(Buffer.from('+13.7563')), 'no GPS location in the rendition');

  // Re-processing reuses the rendition rather than making another.
  await prisma.workerJob.create({ data: { jobType: 'file.process', payload: { file_id: file.id, evidence_id: rendition.evidenceId, school_id: 'x' } } }).catch(() => {});
  await runOnce(env, s3, { scheduleGc: false });
  assert.equal(await prisma.evidenceFile.count({ where: { parentFileId: file.id, role: 'review_720p' } }), 1);
});

/** A real JPEG with an EXIF segment (APP1) carrying a marker in place of GPS tags. */
function photoWithExif(marker) {
  const dir = mkdtempSync(join(tmpdir(), 'seip-photo-'));
  const out = join(dir, 'photo.jpg');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=1600x1200:rate=1:duration=1', '-frames:v', '1', out]);
  const jpeg = readFileSync(out);
  const payload = Buffer.concat([Buffer.from('Exif\0\0'), Buffer.from(marker)]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), Buffer.from([(payload.length + 2) >> 8, (payload.length + 2) & 0xff]), payload]);
  return Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]);
}

async function imageFixture(bytes) {
  const base = await fixture('photo.pdf');
  const fileId = randomUUID();
  const key = `evidence/${base.school.id}/${base.evidence.id}/${fileId}/photo.jpg`;
  await putObject(key, bytes, 'image/jpeg');
  return registerEvidenceFileWithWorkerJobs({
    id: fileId, evidenceId: base.evidence.id, storageUri: key, contentType: 'image/jpeg', byteSize: BigInt(bytes.length),
    checksumSha256: createHash('sha256').update(bytes).digest('hex'),
    originalFilename: 'photo.jpg', schoolId: base.school.id, actorUserId: base.user.id,
  });
}

async function objectBytes(key) {
  const { GetObjectCommand } = await import('@aws-sdk/client-s3');
  return Buffer.from(await (await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }))).Body.transformToByteArray());
}

test('FR-021: a photo gets a small preview without its EXIF; the original keeps it', async () => {
  const marker = 'GPS-13.7563-100.5018';
  const bytes = photoWithExif(marker);
  const file = await imageFixture(bytes);
  await runOnce(env, s3, { scheduleGc: false });
  const poster = await prisma.evidenceFile.findFirst({ where: { parentFileId: file.id, role: 'poster' } });
  assert.ok(poster, 'a poster child row exists');
  assert.equal(poster.contentType, 'image/jpeg');
  assert.deepEqual([poster.width, poster.height], [480, 360]);
  assert.equal(poster.durationMs, null);
  const preview = await objectBytes(poster.storageUri);
  assert.ok(!preview.includes(Buffer.from(marker)), 'no EXIF in the preview');
  assert.ok(!preview.includes(Buffer.from('Exif\0\0')), 'no EXIF segment at all');
  assert.ok((await objectBytes(file.storageUri)).includes(Buffer.from(marker)), 'the original is untouched');
  assert.equal(await prisma.evidenceFile.count({ where: { parentFileId: file.id, role: 'review_720p' } }), 0, 'a photo has no video copy');
});

test('FR-021: a video gets a poster from its opening frame', async () => {
  const file = await videoFixture(600, clip(2, '640x480'));
  await runOnce(env, s3, { scheduleGc: false });
  const poster = await prisma.evidenceFile.findFirst({ where: { parentFileId: file.id, role: 'poster' } });
  assert.ok(poster);
  assert.deepEqual([poster.width, poster.height], [480, 360]);
  assert.ok(!(await objectBytes(poster.storageUri)).includes(Buffer.from('+13.7563')));
});

/** A real two-page PDF with a Thai text layer (pdfkit + Noto Sans Thai). */
async function thaiPdf(pages) {
  const { default: PDFDocument } = await import('pdfkit');
  const doc = new PDFDocument({ autoFirstPage: false });
  doc.registerFont('Thai', new URL('../../../assets/fonts/NotoSansThai-Regular.ttf', import.meta.url).pathname);
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((r) => doc.on('end', r));
  for (const text of pages) {
    doc.addPage();
    doc.font('Thai').fontSize(14).text(text);
  }
  doc.end();
  await done;
  return Buffer.concat(chunks);
}

test('P3 v0: a verified PDF is analysed on the heuristic floor — page segments, a verbatim quote, degraded + provisional', async () => {
  const { file, evidence } = await fixture('plan.pdf');
  const bytes = await thaiPdf([
    'แผนการจัดการเรียนรู้ที่ 3 วิชาภาษาไทย',
    'ครูออกแบบการจัดการเรียนรู้แบบ Active Learning โดยใช้เกมการอ่าน',
  ]);
  await putObject(file.storageUri, bytes, 'application/pdf');
  await prisma.evidenceFile.update({
    where: { id: file.id },
    data: { byteSize: BigInt(bytes.length), checksumSha256: createHash('sha256').update(bytes).digest('hex') },
  });

  await runOnce(env, s3, { scheduleGc: false }); // file.process → queues evidence.analyze
  await runOnce(env, s3, { scheduleGc: false }); // evidence.analyze

  const analysis = await prisma.evidenceAnalysis.findFirst({ where: { evidenceId: evidence.id }, orderBy: { createdAt: 'desc' } });
  assert.equal(analysis.status, 'degraded');
  assert.equal(analysis.provisional, true);
  const segments = await prisma.contentSegment.findMany({ where: { analysisId: analysis.id }, orderBy: { ordinal: 'asc' } });
  assert.deepEqual(segments.map((s) => s.page), [1, 2]);
  assert.match(segments[1].text, /ออกแบบการจัดการเรียนรู้/);

  const suggestions = await prisma.aiSuggestion.findMany({ where: { evidenceId: evidence.id }, include: { indicator: true } });
  const plan = suggestions.find((s) => s.indicator.code === 'T-1.2');
  assert.ok(plan, `T-1.2 suggested (got ${suggestions.map((s) => s.indicator.code)})`);
  assert.equal(plan.status, 'open');
  assert.notEqual(plan.band, 'clear');
  assert.equal(plan.modelLabel, 'SEIP local_heuristic');
  const [loc] = plan.locators;
  assert.equal(loc.segment_id, segments[1].id, 'locator points at the stored page-2 segment');
  assert.ok(segments[1].text.replace(/\s+/g, ' ').includes(loc.quote), 'quote is verbatim');

  // A second analysis supersedes the open suggestions rather than duplicating them.
  const { requestAnalysis } = await import('@seip/database');
  await requestAnalysis(evidence.id, null);
  await runOnce(env, s3, { scheduleGc: false });
  const open = await prisma.aiSuggestion.count({ where: { evidenceId: evidence.id, status: 'open', indicatorId: plan.indicatorId } });
  assert.equal(open, 1);
  assert.equal(await prisma.aiSuggestion.count({ where: { id: plan.id, status: 'superseded' } }), 1);
});
