// P3 v0 end to end over HTTP: a note starts its analysis by itself; the worker
// (heuristic floor) writes suggestions; the owner sees confidence and rationale,
// the director does not; accept makes an owner_confirmed ai_accepted mapping;
// reject records a reason; re-runs are throttled; batch accept refuses until the
// indicator's gate has passed.
process.env.NODE_ENV = 'test';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '../../../prisma/client.mjs';
import { hash as argonHash } from '@node-rs/argon2';
import { buildServer } from '../dist/server.js';
import { runOnce } from '../../worker/dist/loop.js';
import { S3Client } from '@aws-sdk/client-s3';
import { cleanupSchools, trackSchools } from '../../../tests/helpers/db-cleanup.mjs';

const created = trackSchools();
const prisma = createPrismaClient();
let app, env, school, categoryId;
const token = {};

const s3 = new S3Client({
  region: 'us-east-1', endpoint: process.env.S3_ENDPOINT || 'http://127.0.0.1:8333', forcePathStyle: true,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID || 'x', secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || 'y' },
});

async function userWith(role, { personnel = true } = {}) {
  const password = `ai-${role}-pass-1234`;
  const user = await prisma.userAccount.create({
    data: { person: { create: { displayName: role } }, email: `ai-${role}-${randomUUID()}@x.io`, displayName: role, status: 'active', passwordHash: await argonHash(password) },
  });
  await prisma.schoolMembership.create({ data: { userId: user.id, schoolId: school.id, role, membershipScope: 'school', effectiveFrom: new Date('2020-01-01'), status: 'active' } });
  if (personnel) {
    await prisma.personnelProfile.create({ data: { schoolId: school.id, userId: user.id, personId: user.personId, fullName: role, positionRole: 'teacher', rankLevelCode: 'ai_kru' } });
  }
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: user.email, password } });
  assert.equal(login.statusCode, 200, login.body);
  return login.json().access_token;
}

const h = (role, extra = {}) => ({ authorization: `Bearer ${token[role]}`, 'x-school-id': school.id, ...extra });
const worker = () => runOnce(env, s3, { scheduleGc: false });

before(async () => {
  ({ app, env } = await buildServer());
  await app.ready();
  const area = await prisma.area.create({ data: { code: `ai-area-${randomUUID()}`, name: 'Area' } });
  school = created.add(await prisma.school.create({ data: { code: `ai-school-${randomUUID()}`, name: 'School', areaId: area.id } }));
  await prisma.rankLevel.upsert({ where: { code: 'ai_kru' }, create: { code: 'ai_kru', roleFamily: 'teacher', labelTh: 'ครู', sortOrder: 2 }, update: {} });
  token.teacher = await userWith('teacher');
  token.other = await userWith('teacher');
  token.director = await userWith('director');
  categoryId = (await prisma.evidenceCategory.findFirstOrThrow()).id;
});

after(async () => {
  await cleanupSchools(prisma, created.ids(), created.userIds(), created.frameworkIds());
  await app.close();
  await prisma.$disconnect();
});

async function noteEvidence(text) {
  const res = await app.inject({
    method: 'POST', url: '/api/v1/evidence', headers: h('teacher', { 'idempotency-key': randomUUID() }),
    payload: { category_id: categoryId, title: 'บันทึกหลังสอน', kind: 'note', note_text: text, client_uuid: randomUUID(), contains_learners: 'no' },
  });
  assert.equal(res.statusCode, 201, res.body);
  return res.json();
}

test('a note is analysed by itself; the owner sees rationale, the director sees the suggestion without it', async () => {
  const ev = await noteEvidence('ประชุมผู้ปกครองและภาคีเครือข่าย สร้างความร่วมมือส่งเสริมการอ่าน และออกแบบการจัดการเรียนรู้ร่วมกัน');
  const queued = await app.inject({ method: 'GET', url: `/api/v1/evidence/${ev.id}/suggestions`, headers: h('teacher') });
  assert.equal(queued.json().analysis.status, 'queued');
  await worker();

  const mine = (await app.inject({ method: 'GET', url: `/api/v1/evidence/${ev.id}/suggestions`, headers: h('teacher') })).json();
  assert.equal(mine.analysis.status, 'degraded');
  assert.equal(mine.analysis.provisional, true);
  const codes = mine.items.map((s) => s.indicator_code);
  assert.ok(codes.includes('T-2.4'), `T-2.4 suggested (got ${codes})`);
  const s = mine.items.find((x) => x.indicator_code === 'T-2.4');
  assert.equal(s.status, 'open');
  assert.equal(s.provisional, true);
  assert.equal(s.batch_acceptable, false);
  assert.match(s.rationale_th, /T-2\.4/);
  assert.deepEqual(s.locators, [], 'a note has no file to point into');

  const theirs = (await app.inject({ method: 'GET', url: `/api/v1/evidence/${ev.id}/suggestions`, headers: h('director') })).json();
  const d = theirs.items.find((x) => x.id === s.id);
  assert.equal(d.rationale_th, null);
  assert.equal(d.calibrated_p, null);

  const stranger = await app.inject({ method: 'GET', url: `/api/v1/evidence/${ev.id}/suggestions`, headers: h('other') });
  assert.equal(stranger.statusCode, 404);
  assert.equal(stranger.json().code, 'RES-001');
});

test('accept makes an owner_confirmed ai_accepted mapping; a second accept is AI-003; only the owner may', async () => {
  const ev = await noteEvidence('ออกแบบการจัดการเรียนรู้ แผนการสอนอ่าน');
  await worker();
  const s = (await app.inject({ method: 'GET', url: `/api/v1/evidence/${ev.id}/suggestions`, headers: h('teacher') })).json()
    .items.find((x) => x.indicator_code === 'T-1.2');
  assert.ok(s, 'T-1.2 suggested');

  const byDirector = await app.inject({ method: 'POST', url: `/api/v1/suggestions/${s.id}/accept`, headers: h('director', { 'idempotency-key': randomUUID() }) });
  assert.equal(byDirector.statusCode, 404, 'not the owner: no route to it');

  const key = randomUUID();
  const ok = await app.inject({ method: 'POST', url: `/api/v1/suggestions/${s.id}/accept`, headers: h('teacher', { 'idempotency-key': key }) });
  assert.equal(ok.statusCode, 201, ok.body);
  const m = ok.json();
  assert.equal(m.status, 'owner_confirmed');
  assert.equal(m.mapping_source, 'ai_accepted');
  assert.equal(m.ai_suggestion_id, s.id);
  assert.equal(m.indicator_id, s.indicator_id);

  const replay = await app.inject({ method: 'POST', url: `/api/v1/suggestions/${s.id}/accept`, headers: h('teacher', { 'idempotency-key': key }) });
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.json().id, m.id);
  const again = await app.inject({ method: 'POST', url: `/api/v1/suggestions/${s.id}/accept`, headers: h('teacher', { 'idempotency-key': randomUUID() }) });
  assert.equal(again.statusCode, 409);
  assert.equal(again.json().code, 'AI-003');

  // The director now sees it in the validation queue like any owner mapping.
  const queue = (await app.inject({ method: 'GET', url: '/api/v1/mappings?status=owner_confirmed', headers: h('director') })).json();
  assert.ok((queue.items ?? queue).some((x) => x.id === m.id));
});

test('reject records the reason; batch accept refuses until the gate passes (AI-004); re-run is throttled (AI-002)', async () => {
  const ev = await noteEvidence('ออกแบบการจัดการเรียนรู้ และประสานความร่วมมือกับผู้ปกครอง ภาคีเครือข่าย');
  await worker();
  const items = (await app.inject({ method: 'GET', url: `/api/v1/evidence/${ev.id}/suggestions`, headers: h('teacher') })).json().items;
  assert.ok(items.length >= 2);

  const rej = await app.inject({
    method: 'POST', url: `/api/v1/suggestions/${items[0].id}/reject`, headers: h('teacher', { 'idempotency-key': randomUUID() }),
    payload: { reason_code: 'wrong_indicator', note: 'ไม่ใช่ตัวนี้' },
  });
  assert.equal(rej.statusCode, 200, rej.body);
  assert.equal(rej.json().status, 'rejected');
  const fb = await prisma.suggestionFeedback.findFirstOrThrow({ where: { suggestionId: items[0].id } });
  assert.equal(fb.reasonCode, 'wrong_indicator');

  const batch = await app.inject({
    method: 'POST', url: '/api/v1/suggestions/accept-batch', headers: h('teacher', { 'idempotency-key': randomUUID() }),
    payload: { suggestion_ids: [items[0].id, items[1].id, randomUUID()] },
  });
  assert.equal(batch.statusCode, 200, batch.body);
  assert.deepEqual(batch.json().accepted, []);
  assert.deepEqual(batch.json().skipped.map((x) => x.code), ['AI-003', 'AI-004', 'RES-001']);

  // The automatic run was just now: a manual re-run waits out the 10 minutes.
  const rerun = await app.inject({ method: 'POST', url: `/api/v1/evidence/${ev.id}/analysis`, headers: h('teacher') });
  assert.equal(rerun.statusCode, 429);
  assert.equal(rerun.json().code, 'AI-002');
  assert.ok(Number(rerun.headers['retry-after']) > 0);

  // Past the cooldown it queues, and the earlier open suggestions are superseded on completion.
  await prisma.evidenceAnalysis.updateMany({ where: { evidenceId: ev.id }, data: { createdAt: new Date(Date.now() - 11 * 60 * 1000) } });
  const later = await app.inject({ method: 'POST', url: `/api/v1/evidence/${ev.id}/analysis`, headers: h('teacher') });
  assert.equal(later.statusCode, 202, later.body);
  const got = await app.inject({ method: 'GET', url: `/api/v1/analyses/${later.json().id}`, headers: h('teacher') });
  assert.equal(got.json().status, 'queued');
  await worker();
  assert.equal(await prisma.aiSuggestion.count({ where: { id: items[1].id, status: 'superseded' } }), 1);
  assert.equal(await prisma.aiSuggestion.count({ where: { id: items[0].id, status: 'rejected' } }), 1, 'a decision is never overwritten');
});

test('FR-023a: segment text — the owner reads the original, the director reads it masked', async () => {
  const ev = await noteEvidence('ประสานความร่วมมือกับผู้ปกครอง');
  await worker();
  const analysis = await prisma.evidenceAnalysis.findFirstOrThrow({ where: { evidenceId: ev.id }, orderBy: { createdAt: 'desc' } });
  const file = await prisma.evidenceFile.create({
    data: {
      evidenceId: ev.id, storageProvider: 's3_compatible', storageUri: `x/${randomUUID()}`, contentType: 'application/pdf',
      byteSize: 1n, checksumSha256: 'a'.repeat(64), scanStatus: 'clean', originalFilename: 'contact.pdf',
    },
  });
  await prisma.contentSegment.create({
    data: { evidenceId: ev.id, evidenceFileId: file.id, analysisId: analysis.id, kind: 'page_block', ordinal: 0, page: 1, text: 'ผู้ปกครอง โทร 081-234-5678 เลขบัตร 1101700203451' },
  });

  const mine = (await app.inject({ method: 'GET', url: `/api/v1/evidence/${ev.id}/segments`, headers: h('teacher') })).json();
  assert.equal(mine.items[0].text, 'ผู้ปกครอง โทร 081-234-5678 เลขบัตร 1101700203451');
  const theirs = (await app.inject({ method: 'GET', url: `/api/v1/evidence/${ev.id}/segments`, headers: h('director') })).json();
  assert.equal(theirs.items[0].text, 'ผู้ปกครอง โทร [เบอร์โทร] เลขบัตร [เลขบัตรประชาชน]');
});
