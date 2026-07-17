// SEIP-WORKER-001 review follow-up — storage.gc had zero test coverage.
// Tests processStorageGc() directly (not via the job queue/runOnce) since its
// enqueue path shares runOnce's module-level `gcScheduled` flag with
// file-process.test.mjs, which would make cross-file ordering assumptions
// fragile; the job-queue wiring itself is already covered by loop.ts's shared
// claim/markDone path exercised in file-process.test.mjs.
process.env.NODE_ENV = 'test';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { processStorageGc } from '../dist/jobs/storage-gc.js';

const prisma = new PrismaClient();
const env = {
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
  S3_BUCKET: process.env.S3_BUCKET ?? 'seip-evidence',
  S3_ACCESS_KEY: process.env.S3_ACCESS_KEY ?? 'seip_dev',
  S3_SECRET_KEY: process.env.S3_SECRET_KEY ?? 'seip_dev_only_change_me',
  S3_REGION: process.env.S3_REGION ?? 'us-east-1',
  WORKER_GC_AFTER_DAYS: 30,
};

const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  forcePathStyle: true,
  credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
});

async function objectExists(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

/** Creates a school/evidence/file fixture and returns everything needed to
 * soft-delete it at a controlled deletedAt. Mirrors file-process.test.mjs's
 * fixture() shape but skips registerEvidenceFileWithWorkerJobs (GC doesn't
 * need a worker_job/outbox row — it operates directly on evidence_file). */
async function fixture(deletedAt) {
  const school = await prisma.school.create({
    data: { code: `gc-${randomUUID().slice(0, 8)}`, name: 'GC School' },
  });
  await prisma.rankLevel.upsert({
    where: { code: 'gc_kru' },
    create: { code: 'gc_kru', roleFamily: 'teacher', labelTh: 'ครู', sortOrder: 2 },
    update: {},
  });
  const user = await prisma.userAccount.create({
    data: { email: `gc-${randomUUID().slice(0, 8)}@example.com`, displayName: 'GC', status: 'active', passwordHash: 'x' },
  });
  const personnel = await prisma.personnelProfile.create({
    data: { schoolId: school.id, userId: user.id, fullName: 'GC Teacher', positionRole: 'teacher', rankLevelCode: 'gc_kru' },
  });
  const cat = await prisma.evidenceCategory.upsert({
    where: { code: 'other_document' },
    create: { code: 'other_document', labelTh: 'เอกสาร', allowedMimeTypes: ['application/pdf'], maxByteSize: BigInt(50 * 1024 * 1024) },
    update: {},
  });
  const evidence = await prisma.evidence.create({
    data: {
      schoolId: school.id, ownerPersonnelId: personnel.id, uploadedByUserId: user.id,
      categoryId: cat.id, title: 'gc test', status: 'active', deletedAt,
    },
  });
  const fileId = randomUUID();
  const key = `evidence/${school.id}/${evidence.id}/${fileId}/doc.pdf`;
  await s3.send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: Buffer.from('gc-bytes'), ContentType: 'application/pdf' }));
  const file = await prisma.evidenceFile.create({
    data: {
      id: fileId, evidenceId: evidence.id, storageUri: key, contentType: 'application/pdf',
      byteSize: 8n, checksumSha256: 'b'.repeat(64), originalFilename: 'doc.pdf', scanStatus: 'clean',
    },
  });
  return { school, evidence, file, key };
}

after(async () => {
  await prisma.$disconnect();
});

test('processStorageGc removes the S3 object and the file row for evidence soft-deleted past the cutoff', async () => {
  const oldDeletedAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000); // 31 days ago, cutoff is 30
  const { file, key } = await fixture(oldDeletedAt);
  assert.ok(await objectExists(key), 'fixture object should exist before GC');

  const removed = await processStorageGc(env, s3);
  assert.ok(removed >= 1);

  assert.equal(await objectExists(key), false, 'S3 object must be deleted');
  const row = await prisma.evidenceFile.findUnique({ where: { id: file.id } });
  assert.equal(row, null, 'evidence_file row must be deleted');
});

test('processStorageGc leaves files alone when evidence is not soft-deleted', async () => {
  const { file, key } = await fixture(null);

  await processStorageGc(env, s3);

  assert.ok(await objectExists(key), 'S3 object for non-deleted evidence must survive GC');
  const row = await prisma.evidenceFile.findUnique({ where: { id: file.id } });
  assert.ok(row, 'evidence_file row for non-deleted evidence must survive GC');
});

test('processStorageGc leaves files alone when soft-deleted more recently than the cutoff', async () => {
  const recentDeletedAt = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000); // 1 day ago, cutoff is 30
  const { file, key } = await fixture(recentDeletedAt);

  await processStorageGc(env, s3);

  assert.ok(await objectExists(key), 'S3 object soft-deleted within the retention window must survive GC');
  const row = await prisma.evidenceFile.findUnique({ where: { id: file.id } });
  assert.ok(row, 'evidence_file row soft-deleted within the retention window must survive GC');
});

test('processStorageGc does not throw when the S3 object is already gone (metadata row still cleaned up)', async () => {
  const oldDeletedAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
  const { file, key } = await fixture(oldDeletedAt);
  // Simulate the object having already been removed out-of-band.
  await s3.send(new (await import('@aws-sdk/client-s3')).DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));

  await processStorageGc(env, s3);

  const row = await prisma.evidenceFile.findUnique({ where: { id: file.id } });
  assert.equal(row, null, 'the row must still be cleaned up even though the object was already gone');
});
