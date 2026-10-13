// End-to-end evidence workflow on contract 4.0.0 (CCR-017): person-owned
// evidence, upload sessions, Idempotency-Key / If-Match, two-tier mappings.
// Uses Fastify's app.inject() for API calls (no port binding, no network) and a
// REAL fetch() only for the presigned PUTs (those URLs point at the store).
// Quiets Fastify's per-request logger during the test run and skips the
// (idempotent, but noisy on repeat) ensureBucket call at boot — loadEnv() is only
// called lazily inside buildServer(), so setting this before that first call is
// enough; no need for it to be a real env var at process start.
process.env.NODE_ENV = 'test';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createPrismaClient } from '../../../prisma/client.mjs';
import { hash as argonHash } from '@node-rs/argon2';
import { buildServer } from '../dist/server.js';
import { cleanupSchools, trackSchools } from '../../../tests/helpers/db-cleanup.mjs';
import {
  bearer as auth, postEvidence, postUpload, completeUpload, uploadFile, postMapping, actOnMapping,
} from '../../../tests/helpers/api-evidence.mjs';

const created = trackSchools();

const prisma = createPrismaClient();
let app;
let school, teacherToken, categoryId, indicatorId, indicator2Id, directorToken;

before(async () => {
  ({ app } = await buildServer());
  await app.ready();

  school = created.add(await prisma.school.create({ data: { code: `flow-${randomUUID()}`, name: 'Flow School' } }));
  await prisma.rankLevel.upsert({
    where: { code: 'flow_kru' }, create: { code: 'flow_kru', roleFamily: 'teacher', labelTh: 'ครู', sortOrder: 2 }, update: {},
  });

  const password = 'flow-test-password-1234';
  const teacher = await prisma.userAccount.create({
    data: { person: { create: { displayName: 'fixture' } }, email: `flow-teacher-${randomUUID()}@x.io`, displayName: 'Flow Teacher', status: 'active', passwordHash: await argonHash(password) },
  });
  const personnel = await prisma.personnelProfile.create({
    data: { schoolId: school.id, userId: teacher.id, personId: teacher.personId, fullName: 'Flow Teacher', positionRole: 'teacher', rankLevelCode: 'flow_kru' },
  });
  void personnel;
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

  const fw = created.addFramework(await prisma.frameworkVersion.upsert({
    where: { code: `flow-fw-${process.pid}` },
    create: { code: `flow-fw-${process.pid}`, roleFamily: 'teacher', legalRef: 'x', revisionYear: 9999, status: 'draft', effectiveFrom: new Date() },
    update: {},
  }));
  const domain = await prisma.evaluationDomain.create({ data: { frameworkVersionId: fw.id, code: `D-${randomUUID()}`, nameTh: 'd', sortOrder: 1, part: 'standards' } });
  const indicator = await prisma.indicator.create({ data: { domainId: domain.id, frameworkVersionId: fw.id, code: `I-${randomUUID()}`, nameTh: 'i', sortOrder: 1, isScored: true, indicatorKind: 'standard' } });
  indicatorId = indicator.id;
  indicator2Id = (await prisma.indicator.create({ data: { domainId: domain.id, frameworkVersionId: fw.id, code: `I-${randomUUID()}`, nameTh: 'i2', sortOrder: 2, isScored: true, indicatorKind: 'standard' } })).id;

  const directorPassword = 'director-password-1234';
  const director = await prisma.userAccount.create({ data: { person: { create: { displayName: 'fixture' } }, email: `flow-director-${randomUUID()}@x.io`, displayName: 'Director', status: 'active', passwordHash: await argonHash(directorPassword) } });
  await prisma.schoolMembership.create({ data: { userId: director.id, schoolId: school.id, role: 'director', membershipScope: 'school', effectiveFrom: new Date('2020-01-01'), status: 'active' } });
  directorToken = (await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: director.email, password: directorPassword } })).json().access_token;
});

after(async () => {
  await cleanupSchools(prisma, created.ids(), created.userIds(), created.frameworkIds());
  await app.close();
  await prisma.$disconnect();
});

async function newEvidence(title) {
  const res = await postEvidence(app, teacherToken, { category_id: categoryId, title });
  assert.equal(res.statusCode, 201, res.body);
  return res.json();
}

test('full evidence submission flow: create -> upload session -> map (owner_confirmed)', async () => {
  const idempotencyKey = randomUUID();
  const clientUuid = randomUUID();
  const body = { category_id: categoryId, title: 'flow test evidence', client_uuid: clientUuid };
  const create = await postEvidence(app, teacherToken, body, { idempotencyKey });
  assert.equal(create.statusCode, 201);
  const evidence = create.json();
  assert.equal(evidence.status, 'draft');
  assert.equal(create.headers.etag, `"${evidence.version}"`);

  // A blind retry with the same key replays — 200, same row, nothing new created.
  const replay = await postEvidence(app, teacherToken, body, { idempotencyKey });
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.headers['idempotent-replay'], 'true');
  assert.equal(replay.json().id, evidence.id);
  // A different key but the same client_uuid (an offline outbox replay) also lands on the same row.
  const outboxReplay = await postEvidence(app, teacherToken, body);
  assert.equal(outboxReplay.statusCode, 200);
  assert.equal(outboxReplay.json().id, evidence.id);
  // The same key with a different body is a client bug, not a retry.
  const misuse = await postEvidence(app, teacherToken, { ...body, title: 'something else' }, { idempotencyKey });
  assert.equal(misuse.statusCode, 422);
  assert.equal(misuse.json().code, 'IDEMP-001');

  const { session, file } = await uploadFile(app, teacherToken, evidence.id, Buffer.from('%PDF-1.4 flow test'), { filename: 'plan.pdf' });
  assert.equal(session.protocol, 'single_put');
  assert.equal(session.part_count, 1);
  assert.equal(file.scan_status, 'pending');
  assert.equal(file.media_state, 'verifying');
  assert.equal(file.download_url, null);

  const detail = await app.inject({ method: 'GET', url: `/api/v1/evidence/${evidence.id}`, headers: auth(teacherToken) });
  assert.equal(detail.json().status, 'active', 'CCR-002 lifecycle: draft -> active on first completed upload');
  assert.equal(detail.json().files.length, 1);
  assert.equal(detail.json().files[0].download_url, null, 'pending scan → no download_url (UPL-006)');

  const mapping = await postMapping(app, teacherToken, evidence.id, indicatorId);
  assert.equal(mapping.statusCode, 201);
  assert.equal(mapping.json().status, 'owner_confirmed');
  assert.equal(mapping.json().mapping_source, 'manual');
});

test('lazy download-url only when scan_status allows it (UPL-006); getEvidence never presigns (CCR-010)', async () => {
  const evidence = await newEvidence('download url test');
  const { file } = await uploadFile(app, teacherToken, evidence.id, Buffer.from('%PDF-1.4 download-url'), { filename: 'dl.pdf' });
  const dl = () => app.inject({
    method: 'GET', url: `/api/v1/evidence/${evidence.id}/files/${file.id}/download-url`, headers: auth(teacherToken),
  });

  const pendingDl = await dl();
  assert.equal(pendingDl.statusCode, 423);
  assert.equal(pendingDl.json().code, 'UPL-006');

  await prisma.evidenceFile.update({ where: { id: file.id }, data: { scanStatus: 'clean' } });
  const cleanDetail = await app.inject({ method: 'GET', url: `/api/v1/evidence/${evidence.id}`, headers: auth(teacherToken) });
  assert.equal(cleanDetail.statusCode, 200);
  assert.equal(cleanDetail.json().files[0].download_url, null, 'getEvidence never embeds presigned URLs (CCR-010)');
  assert.ok(!JSON.stringify(cleanDetail.json()).includes('storage_uri'), 'storage_uri must never appear in API responses');

  const cleanDl = await dl();
  assert.equal(cleanDl.statusCode, 200);
  assert.ok(cleanDl.json().download_url.startsWith('http'));
  assert.ok(typeof cleanDl.json().expires_at === 'string');

  await prisma.evidenceFile.update({ where: { id: file.id }, data: { scanStatus: 'sanitised' } });
  assert.equal((await dl()).statusCode, 200, 'sanitised is served (ADR-0018)');

  await prisma.evidenceFile.update({ where: { id: file.id }, data: { scanStatus: 'blocked' } });
  const blockedDl = await dl();
  assert.equal(blockedDl.statusCode, 423);
  assert.equal(blockedDl.json().code, 'UPL-006');
});

test('another school\'s teacher has no route to the evidence: RES-001, never leaks existence', async () => {
  const otherSchool = created.add(await prisma.school.create({ data: { code: `flow-other-${randomUUID()}`, name: 'Other' } }));
  const otherUser = await prisma.userAccount.create({ data: { person: { create: { displayName: 'fixture' } }, email: `flow-other-${randomUUID()}@x.io`, displayName: 'Other', status: 'active', passwordHash: await argonHash('other-password-1234') } });
  await prisma.personnelProfile.create({ data: { schoolId: otherSchool.id, userId: otherUser.id, personId: otherUser.personId, fullName: 'Other', positionRole: 'teacher', rankLevelCode: 'flow_kru' } });
  await prisma.schoolMembership.create({ data: { userId: otherUser.id, schoolId: otherSchool.id, role: 'teacher', membershipScope: 'school', effectiveFrom: new Date('2020-01-01'), status: 'active' } });

  const evidence = await newEvidence('tenant isolation test');
  const otherToken = (await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: otherUser.email, password: 'other-password-1234' } })).json().access_token;

  const crossRead = await app.inject({ method: 'GET', url: `/api/v1/evidence/${evidence.id}`, headers: auth(otherToken) });
  assert.equal(crossRead.statusCode, 404);
  assert.equal(crossRead.json().code, 'RES-001');

  const crossWrite = await app.inject({
    method: 'PATCH', url: `/api/v1/evidence/${evidence.id}`,
    headers: { ...auth(otherToken), 'if-match': `"${evidence.version}"` }, payload: { title: 'HACKED' },
  });
  assert.equal(crossWrite.statusCode, 404);

  const crossUpload = await postUpload(app, otherToken, {
    evidence_id: evidence.id, filename: 'x.pdf', content_type: 'application/pdf', byte_size: 10, checksum_sha256: 'a'.repeat(64),
  });
  assert.equal(crossUpload.statusCode, 404);
});

test('updateEvidence requires If-Match: missing is RES-005, stale is RES-004', async () => {
  const evidence = await newEvidence('if-match test');
  const patch = (headers) => app.inject({
    method: 'PATCH', url: `/api/v1/evidence/${evidence.id}`, headers: { ...auth(teacherToken), ...headers }, payload: { title: 'renamed' },
  });
  const missing = await patch({});
  assert.equal(missing.statusCode, 428);
  assert.equal(missing.json().code, 'RES-005');
  const ok = await patch({ 'if-match': `"${evidence.version}"` });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().title, 'renamed');
  assert.equal(ok.headers.etag, `"${evidence.version + 1}"`);
  const stale = await patch({ 'if-match': `"${evidence.version}"` });
  assert.equal(stale.statusCode, 412);
  assert.equal(stale.json().code, 'RES-004');
});

test('upload validation runs before bytes move (UPL-001)', async () => {
  const evidence = await newEvidence('validation test');
  const wrongType = await postUpload(app, teacherToken, {
    evidence_id: evidence.id, filename: 'x.zip', content_type: 'application/zip', byte_size: 100, checksum_sha256: 'a'.repeat(64),
  });
  assert.equal(wrongType.statusCode, 422);
  assert.equal(wrongType.json().code, 'UPL-001');
});

test('duplicate mapping (MAP-001) and a second completion of the same session (UPL-007) are rejected', async () => {
  const evidence = await newEvidence('duplicate test');
  const m1 = await postMapping(app, teacherToken, evidence.id, indicatorId);
  assert.equal(m1.statusCode, 201);
  const m2 = await postMapping(app, teacherToken, evidence.id, indicatorId);
  assert.equal(m2.statusCode, 409);
  assert.equal(m2.json().code, 'MAP-001');

  const { session } = await uploadFile(app, teacherToken, evidence.id, Buffer.from('dup test'), { filename: 'd.pdf' });
  const again = await completeUpload(app, teacherToken, session.id, session.part_count);
  assert.equal(again.statusCode, 409);
  assert.equal(again.json().code, 'UPL-007');
});

test('completeUpload with nothing uploaded is UPL-008, and the session stays open for a retry', async () => {
  const evidence = await newEvidence('nothing uploaded');
  const bytes = Buffer.from('late bytes');
  const open = await postUpload(app, teacherToken, {
    evidence_id: evidence.id, filename: 'late.pdf', content_type: 'application/pdf', byte_size: bytes.length,
    checksum_sha256: createHash('sha256').update(bytes).digest('hex'),
  });
  const session = open.json();
  const early = await completeUpload(app, teacherToken, session.id, 1);
  assert.equal(early.statusCode, 422);
  assert.equal(early.json().code, 'UPL-008');
  const wrongCount = await completeUpload(app, teacherToken, session.id, 2);
  assert.equal(wrongCount.json().code, 'UPL-008');

  const resumed = (await app.inject({ method: 'GET', url: `/api/v1/uploads/${session.id}`, headers: auth(teacherToken) })).json();
  assert.equal(resumed.status, 'open');
  assert.ok(resumed.single_put?.url, 'a resumed single_put session gets a fresh URL');
  assert.ok((await fetch(resumed.single_put.url, { method: 'PUT', headers: resumed.single_put.headers, body: bytes })).ok);
  assert.equal((await completeUpload(app, teacherToken, session.id, 1)).statusCode, 200);
});

test('a file above 16 MiB uses S3 multipart: signed parts with checksums, server completes from ListParts', async () => {
  const evidence = await newEvidence('multipart test');
  const bytes = Buffer.alloc(16 * 1024 * 1024 + 1024, 7);
  const open = await postUpload(app, teacherToken, {
    evidence_id: evidence.id, filename: 'big.pdf', content_type: 'application/pdf', byte_size: bytes.length,
    checksum_sha256: createHash('sha256').update(bytes).digest('hex'),
  });
  assert.equal(open.statusCode, 201, open.body);
  const session = open.json();
  assert.equal(session.protocol, 's3_multipart');
  assert.equal(session.part_count, 2);
  assert.equal(session.single_put ?? null, null);

  const partBytes = (n) => bytes.subarray((n - 1) * session.part_size, Math.min(n * session.part_size, bytes.length));
  const b64 = (buf) => createHash('sha256').update(buf).digest('base64');
  const signed = await app.inject({
    method: 'POST', url: `/api/v1/uploads/${session.id}/part-urls`, headers: auth(teacherToken),
    payload: { part_numbers: [1], checksums_sha256: [b64(partBytes(1))] },
  });
  assert.equal(signed.statusCode, 200, signed.body);
  const p1 = signed.json().parts[0];
  assert.ok((await fetch(p1.request.url, { method: 'PUT', headers: p1.request.headers, body: partBytes(1) })).ok);

  const missing = await completeUpload(app, teacherToken, session.id, 2);
  assert.equal(missing.statusCode, 422);
  assert.equal(missing.json().code, 'UPL-008', 'part 2 never arrived');

  const resumed = (await app.inject({ method: 'GET', url: `/api/v1/uploads/${session.id}`, headers: auth(teacherToken) })).json();
  assert.deepEqual(resumed.parts_received, [1], 'resume starts at the first missing part');

  // A part whose bytes do not match its signed checksum is refused by the store.
  const signed2 = (await app.inject({
    method: 'POST', url: `/api/v1/uploads/${session.id}/part-urls`, headers: auth(teacherToken),
    payload: { part_numbers: [2], checksums_sha256: [b64(partBytes(2))] },
  })).json().parts[0];
  const corrupted = Buffer.from(partBytes(2)); corrupted[0] ^= 0xff;
  assert.equal((await fetch(signed2.request.url, { method: 'PUT', headers: signed2.request.headers, body: corrupted })).ok, false);
  assert.ok((await fetch(signed2.request.url, { method: 'PUT', headers: signed2.request.headers, body: partBytes(2) })).ok);

  const done = await completeUpload(app, teacherToken, session.id, 2);
  assert.equal(done.statusCode, 200, done.body);
  assert.equal(done.json().byte_size, bytes.length);
});

test('two-tier mappings: the owner confirms, never validates; the director validates or returns with a note', async () => {
  const evidence = await newEvidence('governance test');
  const m = (await postMapping(app, teacherToken, evidence.id, indicatorId)).json();

  const selfValidate = await actOnMapping(app, teacherToken, m.id, m.version, 'validate');
  assert.equal(selfValidate.statusCode, 403, 'nobody validates their own evidence');
  assert.equal(selfValidate.json().code, 'PERM-001');

  const noIfMatch = await actOnMapping(app, directorToken, m.id, null, 'validate');
  assert.equal(noIfMatch.statusCode, 428);
  assert.equal(noIfMatch.json().code, 'RES-005');
  const stale = await actOnMapping(app, directorToken, m.id, m.version + 3, 'validate');
  assert.equal(stale.statusCode, 412);
  assert.equal(stale.json().code, 'RES-004');

  const validated = await actOnMapping(app, directorToken, m.id, m.version, 'validate');
  assert.equal(validated.statusCode, 200, validated.body);
  assert.equal(validated.json().status, 'validated');
  assert.equal(validated.json().validator_role, 'director');
  assert.equal(validated.headers.etag, `"${m.version + 1}"`);

  const again = await actOnMapping(app, directorToken, m.id, validated.json().version, 'validate');
  assert.equal(again.statusCode, 422);
  assert.equal(again.json().code, 'MAP-002');

  const directorRevoke = await actOnMapping(app, directorToken, m.id, validated.json().version, 'revoke');
  assert.equal(directorRevoke.statusCode, 403, 'revoke is the owner\'s alone');

  const m2 = (await postMapping(app, teacherToken, evidence.id, indicator2Id)).json();
  const noNote = await actOnMapping(app, directorToken, m2.id, m2.version, 'return');
  assert.equal(noNote.statusCode, 422);
  assert.equal(noNote.json().code, 'VAL-002');
  const returned = await actOnMapping(app, directorToken, m2.id, m2.version, 'return', 'ไม่ตรงกับตัวชี้วัด');
  assert.equal(returned.statusCode, 200);
  assert.equal(returned.json().status, 'returned');
  assert.equal(returned.json().return_note, 'ไม่ตรงกับตัวชี้วัด');

  const queue = await app.inject({ method: 'GET', url: '/api/v1/mappings?status=returned', headers: auth(directorToken) });
  assert.equal(queue.statusCode, 200);
  assert.ok(queue.json().items.some((i) => i.id === m2.id), 'the director\'s queue lists the school\'s mappings');
});

test('the owner may revoke from any live state, which frees the slot for a re-map', async () => {
  const evidence = await newEvidence('revoke test');
  const m = (await postMapping(app, teacherToken, evidence.id, indicatorId)).json();
  const v = (await actOnMapping(app, directorToken, m.id, m.version, 'validate')).json();

  const revoke = await actOnMapping(app, teacherToken, m.id, v.version, 'revoke');
  assert.equal(revoke.statusCode, 200);
  assert.equal(revoke.json().status, 'revoked');
  const twice = await actOnMapping(app, teacherToken, m.id, revoke.json().version, 'revoke');
  assert.equal(twice.json().code, 'MAP-002');

  const remap = await postMapping(app, teacherToken, evidence.id, indicatorId);
  assert.equal(remap.statusCode, 201);
});

test('link evidence is active at once and refuses an upload', async () => {
  const res = await postEvidence(app, teacherToken, { category_id: categoryId, title: 'a link', kind: 'link', link_url: 'https://example.org/lesson' });
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(res.json().status, 'active');
  const up = await postUpload(app, teacherToken, {
    evidence_id: res.json().id, filename: 'x.pdf', content_type: 'application/pdf', byte_size: 10, checksum_sha256: 'a'.repeat(64),
  });
  assert.equal(up.statusCode, 422);
});

test('FR-015: a link must be a web address — script, data and file URLs are refused', async () => {
  for (const link_url of ['javascript:alert(1)', 'data:text/html,<b>x</b>', 'file:///etc/passwd']) {
    const res = await postEvidence(app, teacherToken, { category_id: categoryId, title: 'bad link', kind: 'link', link_url });
    assert.equal(res.statusCode, 400, link_url);
    assert.equal(res.json().code, 'VAL-001');
    assert.equal(res.json().details[0].field, 'link_url');
  }
});

test('FR-015: a note is active at once and reads back as written', async () => {
  const res = await postEvidence(app, teacherToken, { category_id: categoryId, title: 'บันทึกหลังสอน', kind: 'note', note_text: 'นักเรียนอ่านคล่องขึ้น\nบรรทัดสอง' });
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(res.json().status, 'active');
  assert.equal(res.json().note_text, 'นักเรียนอ่านคล่องขึ้น\nบรรทัดสอง');
});
