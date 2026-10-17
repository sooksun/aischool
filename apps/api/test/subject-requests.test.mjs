// FR-117 / CCR-029: a person files a data-subject request; the DPO of the area
// decides. Approving access / portability queues the person's portfolio export
// and the request completes when it is ready. Nobody else sees requests.
process.env.NODE_ENV = 'test';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '../../../prisma/client.mjs';
import { hash as argonHash } from '@node-rs/argon2';
import { S3Client } from '@aws-sdk/client-s3';
import { buildServer } from '../dist/server.js';
import { runOnce } from '../../worker/dist/loop.js';
import { notifyFromEvent } from '@seip/database';
import { cleanupSchools, trackSchools } from '../../../tests/helpers/db-cleanup.mjs';

const created = trackSchools();
const prisma = createPrismaClient();
let app, env, s3, area, otherArea, school, noAreaSchool, otherSchool;
const token = {};
const user = {};

async function userWith(key, role, { sch = school, areaId = null, personnel = true } = {}) {
  const password = `dsr-${key}-pass-1234`;
  const u = await prisma.userAccount.create({
    data: { person: { create: { displayName: `คุณ ${key}` } }, email: `dsr-${key.toLowerCase()}-${randomUUID()}@x.io`, displayName: key, status: 'active', passwordHash: await argonHash(password) },
  });
  if (areaId) {
    created.addUser(u);
    await prisma.schoolMembership.create({ data: { userId: u.id, areaId, role, membershipScope: 'area', effectiveFrom: new Date('2020-01-01'), status: 'active' } });
  } else {
    await prisma.schoolMembership.create({ data: { userId: u.id, schoolId: sch.id, role, membershipScope: 'school', effectiveFrom: new Date('2020-01-01'), status: 'active' } });
    if (personnel) await prisma.personnelProfile.create({ data: { schoolId: sch.id, userId: u.id, personId: u.personId, fullName: key, positionRole: 'teacher', rankLevelCode: 'dsr_kru' } });
  }
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: u.email, password } });
  assert.equal(login.statusCode, 200, login.body);
  token[key] = login.json().access_token;
  user[key] = u;
}
const h = (key, extra = {}) => ({ authorization: `Bearer ${token[key]}`, ...extra });
const file = (key, payload) => app.inject({ method: 'POST', url: '/api/v1/subject-requests', headers: h(key, { 'idempotency-key': randomUUID() }), payload });
const decide = (key, id, payload) => app.inject({ method: 'POST', url: `/api/v1/subject-requests/${id}/decision`, headers: h(key), payload });
const get = (key, id) => app.inject({ method: 'GET', url: `/api/v1/subject-requests/${id}`, headers: h(key) });
async function dispatch() {
  for (const e of await prisma.outboxEvent.findMany({ where: { eventType: { startsWith: 'subject_request.' }, publishedAt: null } })) {
    await notifyFromEvent(e);
    await prisma.outboxEvent.update({ where: { id: e.id }, data: { publishedAt: new Date() } });
  }
}

before(async () => {
  ({ app, env } = await buildServer());
  await app.ready();
  s3 = new S3Client({
    region: env.S3_REGION, endpoint: env.S3_ENDPOINT, forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY }, // gitleaks:allow — field name only; the value comes from the environment
  });
  area = await prisma.area.create({ data: { code: `dsr-a-${randomUUID()}`, name: 'สพท. ทดสอบ' } });
  otherArea = await prisma.area.create({ data: { code: `dsr-b-${randomUUID()}`, name: 'อีกเขต' } });
  school = created.add(await prisma.school.create({ data: { code: `dsr-s-${randomUUID()}`, name: 'S', areaId: area.id } }));
  otherSchool = created.add(await prisma.school.create({ data: { code: `dsr-o-${randomUUID()}`, name: 'O', areaId: otherArea.id } }));
  noAreaSchool = created.add(await prisma.school.create({ data: { code: `dsr-n-${randomUUID()}`, name: 'N' } }));
  await prisma.rankLevel.upsert({ where: { code: 'dsr_kru' }, create: { code: 'dsr_kru', roleFamily: 'teacher', labelTh: 'ครู', sortOrder: 2 }, update: {} });
  await userWith('teacher', 'teacher');
  await userWith('peer', 'teacher');
  await userWith('director', 'director');
  await userWith('loner', 'teacher', { sch: noAreaSchool });
  await userWith('areaAdmin', 'area_admin', { areaId: area.id });
  await userWith('dpo', 'dpo', { areaId: area.id });
  await userWith('otherDpo', 'dpo', { areaId: otherArea.id });
});

after(async () => {
  await cleanupSchools(prisma, created.ids(), created.userIds(), created.frameworkIds());
  await prisma.area.deleteMany({ where: { id: { in: [area.id, otherArea.id] } } }).catch(() => {});
  await app.close();
  await prisma.$disconnect();
});

test('a person files a request; only they and the DPO of the area see it', async () => {
  const before = Date.now();
  const r = await file('teacher', { request_type: 'correction', details: 'ชื่อสกุลในระบบสะกดผิด' });
  assert.equal(r.statusCode, 201, r.body);
  const body = r.json();
  assert.equal(body.status, 'received');
  assert.equal(body.area_id, area.id);
  assert.equal(body.person_id, user.teacher.personId);
  assert.equal(body.requester_display_name, 'คุณ teacher');
  assert.equal(body.overdue, false);
  const days = (new Date(body.due_at) - before) / 86400000;
  assert.ok(days > 29.9 && days < 30.1, `due in 30 days, got ${days}`);

  assert.equal((await get('teacher', body.id)).statusCode, 200);
  assert.equal((await get('dpo', body.id)).statusCode, 200);
  assert.equal((await get('peer', body.id)).json().code, 'RES-001');
  assert.equal((await get('director', body.id)).json().code, 'RES-001', 'own means own, even for the director');
  assert.equal((await get('otherDpo', body.id)).json().code, 'RES-001', 'another area\'s DPO');
  assert.equal((await get('areaAdmin', body.id)).json().code, 'PERM-001', 'the area admin is not the DPO');

  const mine = await app.inject({ method: 'GET', url: '/api/v1/subject-requests', headers: h('peer') });
  assert.ok(!mine.json().items.some((i) => i.id === body.id));
  const queue = await app.inject({ method: 'GET', url: '/api/v1/subject-requests?status=received', headers: h('dpo') });
  assert.ok(queue.json().items.some((i) => i.id === body.id));
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/subject-requests', headers: h('otherDpo') })).json().items.length, 0);

  // The DPO cannot file (no person route), the area admin cannot list.
  assert.equal((await file('dpo', { request_type: 'access' })).json().code, 'PERM-001');
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/subject-requests', headers: h('areaAdmin') })).json().code, 'PERM-001');

  // A school with no สพท. has no DPO to receive it.
  assert.equal((await file('loner', { request_type: 'access' })).json().code, 'VAL-002');

  // The DPO of the area is told; another area's is not. No details in the text or the audit.
  await dispatch();
  const notes = await prisma.notification.findMany({ where: { entityId: body.id, kind: 'subject_request_received' } });
  assert.deepEqual(notes.map((n) => n.userId), [user.dpo.id]);
  assert.equal(notes[0].route, '/dpo/requests');
  const audit = await prisma.auditEvent.findMany({ where: { entityId: body.id } });
  assert.ok(audit.length >= 1);
  assert.ok(audit.every((a) => !JSON.stringify(a).includes('สะกดผิด')), 'details never reach the audit trail');
});

test('approving access queues the person\'s export; the request completes when it is ready', async () => {
  const r = (await file('teacher', { request_type: 'access' })).json();
  assert.equal((await decide('otherDpo', r.id, { action: 'approve' })).json().code, 'RES-001');
  assert.equal((await decide('teacher', r.id, { action: 'approve' })).json().code, 'PERM-001', 'the person cannot decide their own request');

  const ok = await decide('dpo', r.id, { action: 'approve' });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.json().status, 'fulfilling');
  const exportId = ok.json().export_id;
  assert.ok(exportId);
  const exp = await prisma.exportPackage.findUniqueOrThrow({ where: { id: exportId } });
  assert.equal(exp.personId, user.teacher.personId);
  assert.equal(exp.kind, 'portfolio_portable');
  assert.equal((await decide('dpo', r.id, { action: 'approve' })).json().code, 'VAL-002', 'already decided');

  await runOnce(env, s3, { scheduleGc: false }); // builds the zip, emits export.ready
  await runOnce(env, s3, { scheduleGc: false }); // dispatches export.ready → completes the request
  const done = (await get('teacher', r.id)).json();
  assert.equal(done.status, 'completed');
  assert.ok(done.completed_at);

  // The export is the person's: they download it, the DPO cannot even see it.
  assert.equal((await app.inject({ method: 'GET', url: `/api/v1/exports/${exportId}/download-url`, headers: h('teacher') })).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: `/api/v1/exports/${exportId}`, headers: h('dpo') })).json().code, 'PERM-001');

  await dispatch();
  const told = await prisma.notification.findMany({ where: { entityId: r.id, kind: 'subject_request_updated', userId: user.teacher.id } });
  assert.ok(told.length >= 2, 'approved, then completed');
  assert.ok(told.every((n) => n.route === '/privacy-requests'));
});

test('other types: approve, carry out by hand, complete with a note; reject needs a reason', async () => {
  const c = (await file('teacher', { request_type: 'erasure', details: 'ลบรูปที่ไม่เกี่ยวข้อง' })).json();
  const appr = await decide('dpo', c.id, { action: 'approve' });
  assert.equal(appr.json().status, 'approved');
  assert.equal(appr.json().export_id, null);
  assert.equal((await decide('dpo', c.id, { action: 'complete' })).json().code, 'VAL-002', 'complete needs a note');
  const done = await decide('dpo', c.id, { action: 'complete', note: 'ลบแล้ว 2 รายการ' });
  assert.equal(done.json().status, 'completed');
  assert.equal((await decide('dpo', c.id, { action: 'reject', note: 'x' })).json().code, 'VAL-002', 'a closed request stays closed');

  const o = (await file('teacher', { request_type: 'objection' })).json();
  assert.equal((await decide('dpo', o.id, { action: 'reject' })).json().code, 'VAL-002', 'reject needs a reason');
  const rej = await decide('dpo', o.id, { action: 'reject', note: 'จำเป็นต่อการประเมินตามกฎหมาย' });
  assert.equal(rej.json().status, 'rejected');
  assert.equal((await get('teacher', o.id)).json().decision_note, 'จำเป็นต่อการประเมินตามกฎหมาย', 'the person sees the reason');
  const audit = await prisma.auditEvent.findFirst({ where: { entityId: o.id, action: 'subject_request_reject' } });
  assert.equal(audit.actorUserId, user.dpo.id);
  assert.ok(!JSON.stringify(audit).includes('จำเป็นต่อ'), 'the note stays on the row');

  // Overdue is computed: an open request past its due date says so.
  const late = (await file('teacher', { request_type: 'restriction' })).json();
  await prisma.subjectRequest.update({ where: { id: late.id }, data: { receivedAt: new Date(Date.now() - 40 * 86400000), dueAt: new Date(Date.now() - 86400000) } });
  assert.equal((await get('dpo', late.id)).json().overdue, true);
});

test('the area admin appoints and lists the DPO; nobody else can', async () => {
  const email = `dsr-newdpo-${randomUUID()}@x.io`;
  const r = await app.inject({ method: 'POST', url: `/api/v1/areas/${area.id}/dpos`, headers: h('areaAdmin'), payload: { email, display_name: 'DPO ใหม่' } });
  assert.equal(r.statusCode, 201, r.body);
  assert.ok(r.json().invite_token);
  assert.equal(r.json().dpo.email, email);
  const appointed = await prisma.userAccount.findUniqueOrThrow({ where: { email } });
  created.addUser(appointed);
  const m = await prisma.schoolMembership.findFirstOrThrow({ where: { userId: appointed.id } });
  assert.equal(m.role, 'dpo');
  assert.equal(m.membershipScope, 'area');
  assert.equal(m.areaId, area.id);

  const again = await app.inject({ method: 'POST', url: `/api/v1/areas/${area.id}/dpos`, headers: h('areaAdmin'), payload: { email, display_name: 'x' } });
  assert.equal(again.json().code, 'RES-003');
  const list = await app.inject({ method: 'GET', url: `/api/v1/areas/${area.id}/dpos`, headers: h('areaAdmin') });
  assert.ok(list.json().some((d) => d.email === email));
  assert.equal((await app.inject({ method: 'GET', url: `/api/v1/areas/${otherArea.id}/dpos`, headers: h('areaAdmin') })).json().code, 'RES-001');
  assert.equal((await app.inject({ method: 'POST', url: `/api/v1/areas/${area.id}/dpos`, headers: h('dpo'), payload: { email: 'z@x.io', display_name: 'z' } })).json().code, 'PERM-001');
  assert.equal((await app.inject({ method: 'GET', url: `/api/v1/areas/${area.id}/dpos`, headers: h('teacher') })).json().code, 'PERM-001');

  // The DPO reads no school data: evidence, members and coverage are all PERM-001.
  for (const url of ['/api/v1/evidence', '/api/v1/members', `/api/v1/areas/${area.id}/schools`]) {
    const res = await app.inject({ method: 'GET', url, headers: h('dpo', { 'x-school-id': school.id }) });
    assert.equal(res.json().code, 'PERM-001', url);
  }
});
