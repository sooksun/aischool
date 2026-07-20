// SEIP-WORKER-001 — file.process + outbox against real Postgres + MinIO.
process.env.NODE_ENV = 'test';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
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

const prisma = new PrismaClient();
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

async function fixture(filename = 'lesson.pdf', contentType = 'application/pdf', declaredByteSize = null) {
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
    },
  });
  const personnel = await prisma.personnelProfile.create({
    data: {
      schoolId: school.id,
      userId: user.id,
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
      schoolId: school.id,
      ownerPersonnelId: personnel.id,
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
    checksumSha256: 'a'.repeat(64),
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
    where: { jobType: 'file.process', payload: { path: '$.file_id', equals: file.id } },
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
    where: { jobType: 'file.process', payload: { path: '$.file_id', equals: file.id } },
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
    where: { jobType: 'file.process', payload: { path: '$.file_id', equals: file.id } },
  });
  assert.match(job.lastError ?? '', /object missing from storage/);
  assert.match(job.lastError ?? '', new RegExp(file.id), 'the message must name the file');

  const after = await prisma.evidenceFile.findUniqueOrThrow({ where: { id: file.id } });
  assert.equal(after.scanStatus, 'pending', 'a file we could not read keeps no verdict');
  assert.equal(after.scannedAt, null);

  // Unsatisfiable by construction — same shared-queue cleanup as above.
  await prisma.workerJob.deleteMany({
    where: { jobType: 'file.process', payload: { path: '$.file_id', equals: file.id } },
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
    where: { jobType: 'file.process', payload: { path: '$.file_id', equals: file.id } },
  });
});
