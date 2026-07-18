// Upload integrity: the server must not take the client's word for how big a
// file is or how long a video runs (2026-07-18 audit).
//
// Before this: presignUpload signed only {Bucket, Key, ContentType}, so
// byte_size was checked against UPL-002 and then never compared to anything
// real — declare 10 bytes, PUT a gigabyte. And the ว9 <=600s rule short-circuited
// on `body.duration_seconds &&`, so OMITTING the field skipped the check
// entirely, while the worker backfilled a fabricated value hard-clamped to <=600
// that could therefore never trip it.
process.env.NODE_ENV = 'test';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { hash as argonHash } from '@node-rs/argon2';
import { buildServer } from '../dist/server.js';

const prisma = new PrismaClient();
let app;
let teacherToken, videoEvidenceId, pdfEvidenceId;

const auth = (t) => ({ authorization: `Bearer ${t}` });
const PASSWORD = 'upload-integrity-password-1234';
const MAX_DURATION = 600; // ว9 inspiration video: <= 10 minutes

before(async () => {
  ({ app } = await buildServer());
  await app.ready();

  const school = await prisma.school.create({
    data: { code: `integ-${randomUUID()}`, name: 'Integrity School' },
  });
  await prisma.rankLevel.upsert({
    where: { code: 'integ_kru' },
    create: { code: 'integ_kru', roleFamily: 'teacher', labelTh: 'ครู', sortOrder: 2 },
    update: {},
  });

  const teacher = await prisma.userAccount.create({
    data: {
      email: `integ-teacher-${randomUUID()}@x.io`, displayName: 'Teacher',
      status: 'active', passwordHash: await argonHash(PASSWORD),
    },
  });
  await prisma.personnelProfile.create({
    data: {
      schoolId: school.id, userId: teacher.id, fullName: 'Teacher',
      positionRole: 'teacher', rankLevelCode: 'integ_kru',
    },
  });
  await prisma.schoolMembership.create({
    data: {
      userId: teacher.id, schoolId: school.id, role: 'teacher', membershipScope: 'school',
      effectiveFrom: new Date('2020-01-01'), status: 'active',
    },
  });
  const login = await app.inject({
    method: 'POST', url: '/api/v1/auth/login',
    payload: { email: teacher.email, password: PASSWORD },
  });
  teacherToken = login.json().access_token;

  // A duration-capped video category (the ว9 inspiration-video shape) ...
  const videoCat = await prisma.evidenceCategory.create({
    data: {
      code: `integ-video-${randomUUID()}`, labelTh: 'วิดีโอ',
      allowedMimeTypes: ['video/mp4'], maxDurationSeconds: MAX_DURATION,
    },
  });
  // ... and an uncapped document category, to prove the new rule is scoped.
  const pdfCat = await prisma.evidenceCategory.create({
    data: { code: `integ-pdf-${randomUUID()}`, labelTh: 'เอกสาร', allowedMimeTypes: ['application/pdf'] },
  });

  for (const [catId, target] of [[videoCat.id, 'video'], [pdfCat.id, 'pdf']]) {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/evidence', headers: auth(teacherToken),
      payload: { category_id: catId, title: `integrity ${target}` },
    });
    assert.equal(res.statusCode, 201);
    if (target === 'video') videoEvidenceId = res.json().id;
    else pdfEvidenceId = res.json().id;
  }
});

after(async () => {
  await app.close();
  await prisma.$disconnect();
});

const initiate = (evidenceId, payload) => app.inject({
  method: 'POST', url: `/api/v1/evidence/${evidenceId}/files/initiate`,
  headers: auth(teacherToken), payload,
});

const videoPayload = (over = {}) => ({
  content_type: 'video/mp4', byte_size: 1024,
  checksum_sha256: 'a'.repeat(64), original_filename: 'clip.mp4', ...over,
});

test('UPL-003 still fires when a declared duration exceeds the cap', async () => {
  const res = await initiate(videoEvidenceId, videoPayload({ duration_seconds: MAX_DURATION + 1 }));
  assert.equal(res.statusCode, 422);
  assert.equal(res.json().code, 'UPL-003');
});

test('omitting duration_seconds on a capped video category is rejected, not skipped', async () => {
  const omitted = await initiate(videoEvidenceId, videoPayload());
  assert.equal(omitted.statusCode, 422, 'omitting the field must not bypass the duration rule');
  assert.equal(omitted.json().code, 'VAL-002');

  const explicitNull = await initiate(videoEvidenceId, videoPayload({ duration_seconds: null }));
  assert.equal(explicitNull.statusCode, 422, 'an explicit null must not bypass it either');
  assert.equal(explicitNull.json().code, 'VAL-002');
});

test('a duration within the cap is still accepted', async () => {
  const res = await initiate(videoEvidenceId, videoPayload({ duration_seconds: MAX_DURATION }));
  assert.equal(res.statusCode, 201);
});

test('the duration requirement is scoped to capped categories only', async () => {
  const res = await initiate(pdfEvidenceId, {
    content_type: 'application/pdf', byte_size: 512,
    checksum_sha256: 'b'.repeat(64), original_filename: 'plan.pdf',
  });
  assert.equal(res.statusCode, 201, 'an uncapped category must not suddenly require duration');
});

test('storage rejects a PUT whose real size differs from the declared byte_size', async () => {
  const declared = Buffer.from('%PDF-1.4 small declared body');
  const actual = Buffer.concat([declared, Buffer.alloc(4096, 0x41)]); // much bigger

  const res = await initiate(pdfEvidenceId, {
    content_type: 'application/pdf',
    byte_size: declared.length, // the honest-looking number that passes UPL-002
    checksum_sha256: createHash('sha256').update(declared).digest('hex'),
    original_filename: 'lie.pdf',
  });
  assert.equal(res.statusCode, 201);

  const put = await fetch(res.json().upload_url, {
    method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: actual,
  });
  assert.equal(
    put.ok, false,
    `MinIO accepted ${actual.length} bytes against a presign declaring ${declared.length} — ` +
    'ContentLength is not part of the signature',
  );
});
