// SEIP-WORKER-001 — file.process + outbox against real Postgres + MinIO.
process.env.NODE_ENV = 'test';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { registerEvidenceFileWithWorkerJobs } from '@seip/database';
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

async function fixture(filename = 'lesson.pdf', contentType = 'application/pdf', declaredByteSize = null) {
  const school = await prisma.school.create({
    data: { code: `w-${randomUUID().slice(0, 8)}`, name: 'Worker School' },
  });
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

  // Clean up the job this test deliberately made unsatisfiable. Left behind it
  // retries forever against a port nothing listens on, and — because every test
  // file shares one worker_job queue — the next runOnce anywhere claims it
  // instead of its own. That is what broke three sibling tests the first time
  // this was written (see the caveat in docs/qa/QUALITY-GATES.md).
  await prisma.workerJob.deleteMany({
    where: { jobType: 'file.process', payload: { path: '$.file_id', equals: file.id } },
  });
});
