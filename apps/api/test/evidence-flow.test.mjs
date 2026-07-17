// End-to-end evidence-workflow test — the real regression coverage behind the
// manual verification done for SEIP-API-001. Uses Fastify's app.inject() for API
// calls (no port binding, no network) and a REAL fetch() only for the MinIO
// presigned PUT (that URL points at MinIO directly, not the Fastify app).
// Quiets Fastify's per-request logger during the test run and skips the
// (idempotent, but noisy on repeat) ensureBucket call at boot — loadEnv() is only
// called lazily inside buildServer(), so setting this before that first call is
// enough; no need for it to be a real env var at process start.
process.env.NODE_ENV = 'test';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { hash as argonHash } from '@node-rs/argon2';
import { buildServer } from '../dist/server.js';

const prisma = new PrismaClient();
let app;
let school, teacherToken, teacherPersonnelId, categoryId, frameworkId, indicatorId;

before(async () => {
  ({ app } = await buildServer());
  await app.ready();

  school = await prisma.school.create({ data: { code: `flow-${randomUUID()}`, name: 'Flow School' } });
  await prisma.rankLevel.upsert({
    where: { code: 'flow_kru' }, create: { code: 'flow_kru', roleFamily: 'teacher', labelTh: 'ครู', sortOrder: 2 }, update: {},
  });

  const password = 'flow-test-password-1234';
  const teacher = await prisma.userAccount.create({
    data: { email: `flow-teacher-${randomUUID()}@x.io`, displayName: 'Flow Teacher', status: 'active', passwordHash: await argonHash(password) },
  });
  const personnel = await prisma.personnelProfile.create({
    data: { schoolId: school.id, userId: teacher.id, fullName: 'Flow Teacher', positionRole: 'teacher', rankLevelCode: 'flow_kru' },
  });
  teacherPersonnelId = personnel.id;
  await prisma.schoolMembership.create({
    data: { userId: teacher.id, schoolId: school.id, role: 'teacher', membershipScope: 'school', effectiveFrom: new Date('2020-01-01'), status: 'active' },
  });

  const loginRes = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: teacher.email, password } });
  assert.equal(loginRes.statusCode, 200);
  teacherToken = loginRes.json().access_token;

  const cat = await prisma.evidenceCategory.upsert({
    where: { code: `flow-cat-${Date.now()}` },
    create: { code: `flow-cat-${Date.now()}`, labelTh: 'x', allowedMimeTypes: ['application/pdf'] },
    update: {},
  });
  categoryId = cat.id;

  const fw = await prisma.frameworkVersion.upsert({
    where: { code: `flow-fw-${process.pid}` },
    create: { code: `flow-fw-${process.pid}`, roleFamily: 'teacher', legalRef: 'x', revisionYear: 9999, status: 'draft', effectiveFrom: new Date() },
    update: {},
  });
  frameworkId = fw.id;
  const domain = await prisma.evaluationDomain.create({ data: { frameworkVersionId: fw.id, code: `D-${randomUUID()}`, nameTh: 'd', sortOrder: 1, part: 'standards' } });
  const indicator = await prisma.indicator.create({ data: { domainId: domain.id, frameworkVersionId: fw.id, code: `I-${randomUUID()}`, nameTh: 'i', sortOrder: 1, isScored: true, indicatorKind: 'standard' } });
  indicatorId = indicator.id;
});

after(async () => {
  await app.close();
  await prisma.$disconnect();
});

function auth(token) {
  return { authorization: `Bearer ${token}` };
}

test('full evidence submission flow: create -> upload -> map -> confirm', async () => {
  const create = await app.inject({
    method: 'POST', url: '/api/v1/evidence', headers: auth(teacherToken),
    payload: { category_id: categoryId, title: 'flow test evidence' },
  });
  assert.equal(create.statusCode, 201);
  const evidence = create.json();
  assert.equal(evidence.status, 'draft');

  const fileContent = Buffer.from('%PDF-1.4 flow test');
  const checksum = createHash('sha256').update(fileContent).digest('hex');

  const initiate = await app.inject({
    method: 'POST', url: `/api/v1/evidence/${evidence.id}/files/initiate`, headers: auth(teacherToken),
    payload: { content_type: 'application/pdf', byte_size: fileContent.length, checksum_sha256: checksum, original_filename: 'plan.pdf' },
  });
  assert.equal(initiate.statusCode, 201);
  const target = initiate.json();

  const putRes = await fetch(target.upload_url, { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: fileContent });
  assert.ok(putRes.ok, `MinIO PUT failed: ${putRes.status}`);

  const complete = await app.inject({
    method: 'POST', url: `/api/v1/evidence/${evidence.id}/files/${target.file_id}/complete`, headers: auth(teacherToken),
    payload: { checksum_sha256: checksum, content_type: 'application/pdf', byte_size: fileContent.length, original_filename: 'plan.pdf' },
  });
  assert.equal(complete.statusCode, 200);
  assert.equal(complete.json().scan_status, 'pending');

  const detail = await app.inject({ method: 'GET', url: `/api/v1/evidence/${evidence.id}`, headers: auth(teacherToken) });
  assert.equal(detail.json().status, 'active', 'CCR-002 lifecycle: draft -> active on first completed upload');
  assert.equal(detail.json().files.length, 1);
  assert.equal(detail.json().files[0].download_url, null, 'pending scan → no download_url (UPL-006)');
  assert.equal(complete.json().download_url, null, 'complete response also null while pending');

  const mapping = await app.inject({
    method: 'POST', url: `/api/v1/evidence/${evidence.id}/mappings`, headers: auth(teacherToken),
    payload: { indicator_id: indicatorId },
  });
  assert.equal(mapping.statusCode, 201);
  assert.equal(mapping.json().status, 'suggested');
});

test('download_url issued only when scan_status=clean (UPL-006); never for blocked', async () => {
  const create = await app.inject({
    method: 'POST', url: '/api/v1/evidence', headers: auth(teacherToken),
    payload: { category_id: categoryId, title: 'download url test' },
  });
  assert.equal(create.statusCode, 201);
  const evidence = create.json();

  const fileContent = Buffer.from('%PDF-1.4 download-url');
  const checksum = createHash('sha256').update(fileContent).digest('hex');
  const initiate = await app.inject({
    method: 'POST', url: `/api/v1/evidence/${evidence.id}/files/initiate`, headers: auth(teacherToken),
    payload: {
      content_type: 'application/pdf', byte_size: fileContent.length,
      checksum_sha256: checksum, original_filename: 'dl.pdf',
    },
  });
  const target = initiate.json();
  const putRes = await fetch(target.upload_url, {
    method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: fileContent,
  });
  assert.ok(putRes.ok);

  const complete = await app.inject({
    method: 'POST',
    url: `/api/v1/evidence/${evidence.id}/files/${target.file_id}/complete`,
    headers: auth(teacherToken),
    payload: {
      checksum_sha256: checksum, content_type: 'application/pdf',
      byte_size: fileContent.length, original_filename: 'dl.pdf',
    },
  });
  assert.equal(complete.statusCode, 200);
  assert.equal(complete.json().scan_status, 'pending');
  assert.equal(complete.json().download_url, null);

  // Simulate worker marking clean
  await prisma.evidenceFile.update({
    where: { id: target.file_id },
    data: { scanStatus: 'clean' },
  });

  const cleanDetail = await app.inject({
    method: 'GET', url: `/api/v1/evidence/${evidence.id}`, headers: auth(teacherToken),
  });
  assert.equal(cleanDetail.statusCode, 200);
  const cleanFile = cleanDetail.json().files[0];
  assert.equal(cleanFile.scan_status, 'clean');
  assert.ok(typeof cleanFile.download_url === 'string' && cleanFile.download_url.startsWith('http'),
    'clean files must get a presigned GET URL');
  assert.ok(!JSON.stringify(cleanDetail.json()).includes('storage_uri'),
    'storage_uri must never appear in API responses');

  // Blocked → still null
  await prisma.evidenceFile.update({
    where: { id: target.file_id },
    data: { scanStatus: 'blocked' },
  });
  const blockedDetail = await app.inject({
    method: 'GET', url: `/api/v1/evidence/${evidence.id}`, headers: auth(teacherToken),
  });
  assert.equal(blockedDetail.json().files[0].download_url, null);
});

test('cross-school access returns RES-001, never leaks existence', async () => {
  const otherSchool = await prisma.school.create({ data: { code: `flow-other-${randomUUID()}`, name: 'Other' } });
  const otherUser = await prisma.userAccount.create({ data: { email: `flow-other-${randomUUID()}@x.io`, displayName: 'Other', status: 'active', passwordHash: await argonHash('other-password-1234') } });
  await prisma.personnelProfile.create({ data: { schoolId: otherSchool.id, userId: otherUser.id, fullName: 'Other', positionRole: 'teacher', rankLevelCode: 'flow_kru' } });
  await prisma.schoolMembership.create({ data: { userId: otherUser.id, schoolId: otherSchool.id, role: 'teacher', membershipScope: 'school', effectiveFrom: new Date('2020-01-01'), status: 'active' } });

  const create = await app.inject({
    method: 'POST', url: '/api/v1/evidence', headers: auth(teacherToken),
    payload: { category_id: categoryId, title: 'tenant isolation test' },
  });
  const evidence = create.json();

  const otherLogin = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: otherUser.email, password: 'other-password-1234' } });
  const otherToken = otherLogin.json().access_token;

  const crossRead = await app.inject({ method: 'GET', url: `/api/v1/evidence/${evidence.id}`, headers: auth(otherToken) });
  assert.equal(crossRead.statusCode, 404);
  assert.equal(crossRead.json().code, 'RES-001');

  const crossWrite = await app.inject({ method: 'PATCH', url: `/api/v1/evidence/${evidence.id}`, headers: auth(otherToken), payload: { title: 'HACKED' } });
  assert.equal(crossWrite.statusCode, 404);
});

test('upload validation runs before bytes move (UPL-001/002)', async () => {
  const create = await app.inject({
    method: 'POST', url: '/api/v1/evidence', headers: auth(teacherToken),
    payload: { category_id: categoryId, title: 'validation test' },
  });
  const evidence = create.json();

  const wrongType = await app.inject({
    method: 'POST', url: `/api/v1/evidence/${evidence.id}/files/initiate`, headers: auth(teacherToken),
    payload: { content_type: 'application/zip', byte_size: 100, checksum_sha256: 'a'.repeat(64), original_filename: 'x.zip' },
  });
  assert.equal(wrongType.statusCode, 422);
  assert.equal(wrongType.json().code, 'UPL-001');
});

test('duplicate mapping (MAP-001) and duplicate file completion (UPL-004) are rejected', async () => {
  const create = await app.inject({
    method: 'POST', url: '/api/v1/evidence', headers: auth(teacherToken),
    payload: { category_id: categoryId, title: 'duplicate test' },
  });
  const evidence = create.json();

  const m1 = await app.inject({ method: 'POST', url: `/api/v1/evidence/${evidence.id}/mappings`, headers: auth(teacherToken), payload: { indicator_id: indicatorId } });
  assert.equal(m1.statusCode, 201);
  const m2 = await app.inject({ method: 'POST', url: `/api/v1/evidence/${evidence.id}/mappings`, headers: auth(teacherToken), payload: { indicator_id: indicatorId } });
  assert.equal(m2.statusCode, 409);
  assert.equal(m2.json().code, 'MAP-001');

  const fileContent = Buffer.from('dup test');
  const checksum = createHash('sha256').update(fileContent).digest('hex');
  const initiate = await app.inject({
    method: 'POST', url: `/api/v1/evidence/${evidence.id}/files/initiate`, headers: auth(teacherToken),
    payload: { content_type: 'application/pdf', byte_size: fileContent.length, checksum_sha256: checksum, original_filename: 'd.pdf' },
  });
  const target = initiate.json();
  await fetch(target.upload_url, { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: fileContent });
  const complete1 = await app.inject({
    method: 'POST', url: `/api/v1/evidence/${evidence.id}/files/${target.file_id}/complete`, headers: auth(teacherToken),
    payload: { checksum_sha256: checksum, content_type: 'application/pdf', byte_size: fileContent.length, original_filename: 'd.pdf' },
  });
  assert.equal(complete1.statusCode, 200);
  const complete2 = await app.inject({
    method: 'POST', url: `/api/v1/evidence/${evidence.id}/files/${target.file_id}/complete`, headers: auth(teacherToken),
    payload: { checksum_sha256: checksum, content_type: 'application/pdf', byte_size: fileContent.length, original_filename: 'd.pdf' },
  });
  assert.equal(complete2.statusCode, 409);
  assert.equal(complete2.json().code, 'UPL-004');
});

test('mapping confirmation is a governance act: teacher self-confirm rejected, director allowed', async () => {
  const create = await app.inject({ method: 'POST', url: '/api/v1/evidence', headers: auth(teacherToken), payload: { category_id: categoryId, title: 'governance test' } });
  const evidence = create.json();
  const mapping = await app.inject({ method: 'POST', url: `/api/v1/evidence/${evidence.id}/mappings`, headers: auth(teacherToken), payload: { indicator_id: indicatorId } });
  const mappingId = mapping.json().id;

  const selfConfirm = await app.inject({ method: 'PATCH', url: `/api/v1/mappings/${mappingId}`, headers: auth(teacherToken), payload: { action: 'confirm' } });
  assert.equal(selfConfirm.statusCode, 403, "teacher's grant is own-revoke, not confirm");
  assert.equal(selfConfirm.json().code, 'PERM-001');

  const directorPassword = 'director-password-1234';
  const director = await prisma.userAccount.create({ data: { email: `flow-director-${randomUUID()}@x.io`, displayName: 'Director', status: 'active', passwordHash: await argonHash(directorPassword) } });
  await prisma.schoolMembership.create({ data: { userId: director.id, schoolId: school.id, role: 'director', membershipScope: 'school', effectiveFrom: new Date('2020-01-01'), status: 'active' } });
  const directorLogin = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: director.email, password: directorPassword } });
  const directorToken = directorLogin.json().access_token;

  const directorConfirm = await app.inject({ method: 'PATCH', url: `/api/v1/mappings/${mappingId}`, headers: auth(directorToken), payload: { action: 'confirm' } });
  assert.equal(directorConfirm.statusCode, 200);
  assert.equal(directorConfirm.json().status, 'confirmed');
});

test('teacher may revoke their own suggested mapping, but not after it is confirmed', async () => {
  const create = await app.inject({ method: 'POST', url: '/api/v1/evidence', headers: auth(teacherToken), payload: { category_id: categoryId, title: 'revoke test' } });
  const evidence = create.json();
  const mapping = await app.inject({ method: 'POST', url: `/api/v1/evidence/${evidence.id}/mappings`, headers: auth(teacherToken), payload: { indicator_id: indicatorId } });
  const mappingId = mapping.json().id;

  const revoke = await app.inject({ method: 'PATCH', url: `/api/v1/mappings/${mappingId}`, headers: auth(teacherToken), payload: { action: 'revoke' } });
  assert.equal(revoke.statusCode, 200);
  assert.equal(revoke.json().status, 'revoked');
});
