// getCoverage: per-indicator counts for a person, school or area — and who may ask.
process.env.NODE_ENV = 'test';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '../../../prisma/client.mjs';
import { hash as argonHash } from '@node-rs/argon2';
import { buildServer } from '../dist/server.js';
import { cleanupSchools, trackSchools } from '../../../tests/helpers/db-cleanup.mjs';

const created = trackSchools();
const prisma = createPrismaClient();
let app, area, otherArea, school, otherSchool, fw, categoryId;
const token = {};
const person = {};
const userId = {};
const personnelId = {};

async function userWith(key, role, sch, { personnel = true, areaScope = null } = {}) {
  const password = `cov-${key}-pass-1234`;
  const user = await prisma.userAccount.create({
    data: { person: { create: { displayName: key } }, email: `cov-${key.toLowerCase()}-${randomUUID()}@x.io`, displayName: key, status: 'active', passwordHash: await argonHash(password) },
  });
  if (areaScope) {
    created.addUser(user);
    await prisma.schoolMembership.create({ data: { userId: user.id, areaId: areaScope, role, membershipScope: 'area', effectiveFrom: new Date('2020-01-01'), status: 'active' } });
  } else {
    await prisma.schoolMembership.create({ data: { userId: user.id, schoolId: sch.id, role, membershipScope: 'school', effectiveFrom: new Date('2020-01-01'), status: 'active' } });
  }
  if (personnel) {
    personnelId[key] = (await prisma.personnelProfile.create({ data: { schoolId: sch.id, userId: user.id, personId: user.personId, fullName: key, positionRole: 'teacher', rankLevelCode: 'cov_kru' } })).id;
  }
  userId[key] = user.id;
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: user.email, password } });
  assert.equal(login.statusCode, 200, login.body);
  token[key] = login.json().access_token;
  person[key] = user.personId;
}

const h = (key, sch = school) => ({ authorization: `Bearer ${token[key]}`, 'x-school-id': sch.id });
const cov = (key, type, id, sch) => app.inject({
  method: 'GET', url: `/api/v1/coverage?subject_type=${type}&subject_id=${id}&framework_version_id=${fw.id}`, headers: h(key, sch),
});

before(async () => {
  ({ app } = await buildServer());
  await app.ready();
  area = await prisma.area.create({ data: { code: `cov-area-${randomUUID()}`, name: 'Area' } });
  otherArea = await prisma.area.create({ data: { code: `cov-area2-${randomUUID()}`, name: 'Other' } });
  school = created.add(await prisma.school.create({ data: { code: `cov-s-${randomUUID()}`, name: 'S', areaId: area.id } }));
  otherSchool = created.add(await prisma.school.create({ data: { code: `cov-o-${randomUUID()}`, name: 'O', areaId: otherArea.id } }));
  await prisma.rankLevel.upsert({ where: { code: 'cov_kru' }, create: { code: 'cov_kru', roleFamily: 'teacher', labelTh: 'ครู', sortOrder: 2 }, update: {} });
  fw = await prisma.frameworkVersion.findFirstOrThrow({ where: { roleFamily: 'teacher', status: 'active' }, include: { indicators: true } });
  categoryId = (await prisma.evidenceCategory.findFirstOrThrow()).id;
  await userWith('teacher', 'teacher', school);
  await userWith('peer', 'teacher', school);
  await userWith('director', 'director', school);
  await userWith('stranger', 'teacher', otherSchool);
  await userWith('areaAdmin', 'area_admin', school, { personnel: false, areaScope: area.id });
  await userWith('otherAreaAdmin', 'area_admin', otherSchool, { personnel: false, areaScope: otherArea.id });
  await userWith('evaluator', 'evaluator', otherSchool, { personnel: false }); // a committee member from another school
  await userWith('offCommittee', 'evaluator', school, { personnel: false });

  // The teacher maps one note to T-1.2 and T-2.4; the director validates T-1.2.
  const ev = await app.inject({
    method: 'POST', url: '/api/v1/evidence', headers: { ...h('teacher'), 'idempotency-key': randomUUID() },
    payload: { category_id: categoryId, title: 'n', kind: 'note', note_text: 'x', client_uuid: randomUUID(), contains_learners: 'no' },
  });
  for (const code of ['T-1.2', 'T-2.4']) {
    const ind = fw.indicators.find((i) => i.code === code);
    const m = await app.inject({ method: 'POST', url: `/api/v1/evidence/${ev.json().id}/mappings`, headers: { ...h('teacher'), 'idempotency-key': randomUUID() }, payload: { indicator_id: ind.id } });
    assert.equal(m.statusCode, 201, m.body);
    if (code === 'T-1.2') {
      const v = await app.inject({ method: 'PATCH', url: `/api/v1/mappings/${m.json().id}`, headers: { ...h('director'), 'if-match': `"${m.json().version}"` }, payload: { action: 'validate' } });
      assert.equal(v.statusCode, 200, v.body);
    }
  }
});

after(async () => {
  await cleanupSchools(prisma, created.ids(), created.userIds(), created.frameworkIds());
  await prisma.area.deleteMany({ where: { id: { in: [area.id, otherArea.id] } } }).catch(() => {});
  await app.close();
  await prisma.$disconnect();
});

const row = (body, code) => body.indicators.find((i) => i.indicator_code === code);

test('a teacher sees their own coverage per indicator; workload-gate rows are not listed', async () => {
  const res = await cov('teacher', 'person', person.teacher);
  assert.equal(res.statusCode, 200, res.body);
  const body = res.json();
  assert.equal(body.people_count, null);
  assert.deepEqual([row(body, 'T-1.2').validated, row(body, 'T-1.2').owner_confirmed], [1, 0]);
  assert.deepEqual([row(body, 'T-2.4').validated, row(body, 'T-2.4').owner_confirmed], [0, 1]);
  assert.equal(row(body, 'T-1.1').validated + row(body, 'T-1.1').owner_confirmed, 0);
  assert.ok(!body.indicators.some((i) => i.indicator_code.startsWith('T-W')));
});

test('the director sees a staff member and the school (counts only); a peer and a stranger cannot', async () => {
  assert.equal((await cov('director', 'person', person.teacher)).statusCode, 200);
  const s = await cov('director', 'school', school.id);
  assert.equal(s.statusCode, 200, s.body);
  assert.equal(s.json().people_count, 3, 'teacher, peer, director');
  assert.equal(row(s.json(), 'T-1.2').validated, 1);

  const peer = await cov('peer', 'person', person.teacher);
  assert.equal(peer.statusCode, 404);
  assert.equal(peer.json().code, 'RES-001');
  const stranger = await cov('stranger', 'person', person.teacher, otherSchool);
  assert.equal(stranger.statusCode, 404);
  const teacherSchool = await cov('teacher', 'school', school.id);
  assert.equal(teacherSchool.statusCode, 403);
  assert.equal(teacherSchool.json().code, 'PERM-001');
});

test('the area admin sees their own area and its schools, never another area', async () => {
  const a = await cov('areaAdmin', 'area', area.id, school);
  assert.equal(a.statusCode, 200, a.body);
  assert.equal(row(a.json(), 'T-2.4').owner_confirmed, 1);
  assert.equal((await cov('areaAdmin', 'school', school.id)).statusCode, 200);
  const other = await cov('otherAreaAdmin', 'area', area.id, otherSchool);
  assert.equal(other.statusCode, 404);
  const teacherArea = await cov('teacher', 'area', area.id);
  assert.equal(teacherArea.statusCode, 403);
});

test('committee view: the seated evaluator (from another school) and the director see confirmed evidence per indicator, no AI fields', async () => {
  const cycle = await prisma.evaluationCycle.create({
    data: { schoolId: school.id, frameworkVersionId: fw.id, fiscalYear: 2569, evaluationKind: 'pa', title: 'c', startsOn: new Date('2026-01-01'), endsOn: new Date('2026-12-31') },
  });
  const round = await prisma.evaluationRound.create({
    data: { cycleId: cycle.id, roundNumber: 1, purpose: 'x', periodStart: new Date('2026-01-01'), periodEnd: new Date('2026-06-30'), status: 'open' },
  });
  const a = await prisma.evaluationAssignment.create({ data: { schoolId: school.id, roundId: round.id, evaluateePersonnelId: personnelId.teacher } });
  await prisma.committeeMember.create({ data: { assignmentId: a.id, evaluatorUserId: userId.evaluator, committeeRole: 'chair', seatNumber: 1 } });
  const url = `/api/v1/assignments/${a.id}/evidence`;

  const seated = await app.inject({ method: 'GET', url, headers: h('evaluator', otherSchool) });
  assert.equal(seated.statusCode, 200, seated.body);
  const items = seated.json().items;
  assert.deepEqual(items.map((i) => fw.indicators.find((x) => x.id === i.indicator_id).code), ['T-1.2', 'T-2.4']);
  assert.ok(items.every((i) => i.evidence.owner_person_id === person.teacher));
  assert.ok(!JSON.stringify(items).includes('rationale') && !JSON.stringify(items).includes('calibrated'));

  assert.equal((await app.inject({ method: 'GET', url, headers: h('director') })).statusCode, 200);
  const filtered = await app.inject({ method: 'GET', url: `${url}?indicator_id=${items[1].indicator_id}`, headers: h('director') });
  assert.equal(filtered.json().items.length, 1);

  const off = await app.inject({ method: 'GET', url, headers: h('offCommittee') });
  assert.equal(off.statusCode, 403);
  assert.equal(off.json().code, 'PERM-003');
  const stranger = await app.inject({ method: 'GET', url, headers: h('stranger', otherSchool) });
  assert.equal(stranger.statusCode, 404);
  const teacher = await app.inject({ method: 'GET', url, headers: h('teacher') });
  assert.equal(teacher.statusCode, 403, 'the evaluatee has no grant on the committee view');

  // FR-062b: once the round closes, the committee's access ends; the director's does not.
  await prisma.evaluationRound.update({ where: { id: round.id }, data: { status: 'closed' } });
  const closed = await app.inject({ method: 'GET', url, headers: h('evaluator', otherSchool) });
  assert.equal(closed.statusCode, 403);
  assert.equal(closed.json().code, 'PERM-003');
  assert.equal((await app.inject({ method: 'GET', url, headers: h('director') })).statusCode, 200);
});

test('CCR-028: the committee comments and asks for more per indicator; the evaluatee reads and replies; text only', async () => {
  const cycle = await prisma.evaluationCycle.create({
    data: { schoolId: school.id, frameworkVersionId: fw.id, fiscalYear: 2570, evaluationKind: 'pa', title: 'c2', startsOn: new Date('2027-01-01'), endsOn: new Date('2027-12-31') },
  });
  const round = await prisma.evaluationRound.create({
    data: { cycleId: cycle.id, roundNumber: 1, purpose: 'x', periodStart: new Date('2027-01-01'), periodEnd: new Date('2027-06-30'), status: 'open' },
  });
  const a = await prisma.evaluationAssignment.create({ data: { schoolId: school.id, roundId: round.id, evaluateePersonnelId: personnelId.teacher } });
  await prisma.committeeMember.create({ data: { assignmentId: a.id, evaluatorUserId: userId.evaluator, committeeRole: 'chair', seatNumber: 1 } });
  const url = `/api/v1/assignments/${a.id}/comments`;
  const ind = fw.indicators.find((i) => i.code === 'T-1.2').id;
  const post = (key, payload, sch) => app.inject({ method: 'POST', url, headers: h(key, sch), payload });

  const ask = await post('evaluator', { indicator_id: ind, kind: 'request_info', body: 'ขอดูแผนการสอนฉบับเต็มครับ' }, otherSchool);
  assert.equal(ask.statusCode, 201, ask.body);
  assert.equal(ask.json().author_role, 'committee');
  const note = await post('director', { indicator_id: ind, kind: 'comment', body: 'หลักฐานชัดเจนดี' });
  assert.equal(note.json().author_role, 'director');

  // The evaluatee reads both and replies; they cannot open a thread themselves.
  const mine = await app.inject({ method: 'GET', url, headers: h('teacher') });
  assert.equal(mine.statusCode, 200);
  assert.deepEqual(mine.json().map((c) => c.kind), ['request_info', 'comment']);
  assert.equal((await post('teacher', { indicator_id: ind, kind: 'comment', body: 'x' })).json().code, 'VAL-002');
  const reply = await post('teacher', { indicator_id: ind, kind: 'reply', body: 'แนบไว้ในหลักฐานแล้วครับ', parent_id: ask.json().id });
  assert.equal(reply.statusCode, 201, reply.body);
  assert.equal(reply.json().author_role, 'evaluatee');
  assert.equal((await post('teacher', { indicator_id: ind, kind: 'reply', body: 'x' })).json().code, 'VAL-002', 'a reply needs its parent');
  const other = fw.indicators.find((i) => i.code === 'T-1.3').id;
  assert.equal((await post('teacher', { indicator_id: other, kind: 'reply', body: 'x', parent_id: ask.json().id })).json().code, 'VAL-002', 'same indicator as the parent');

  // Others: a peer is denied, a stranger learns nothing, the off-committee evaluator is PERM-003, the school admin only reads.
  assert.equal((await app.inject({ method: 'GET', url, headers: h('peer') })).statusCode, 403);
  assert.equal((await app.inject({ method: 'GET', url, headers: h('stranger', otherSchool) })).statusCode, 404);
  assert.equal((await app.inject({ method: 'GET', url, headers: h('offCommittee') })).json().code, 'PERM-003');
  assert.ok(await prisma.outboxEvent.findFirst({ where: { eventType: 'assignment.comment.created', payload: { path: ['comment_id'], equals: reply.json().id } } }));
  const ev = await prisma.outboxEvent.findFirst({ where: { eventType: 'assignment.comment.created', payload: { path: ['comment_id'], equals: ask.json().id } } });
  assert.ok(!JSON.stringify(ev.payload).includes('แผนการสอน'), 'the body never goes into the event');

  // CCR-028 decision A: the request and the comment notify the evaluatee; the
  // reply notifies the evaluator who asked — never the actor, never the body.
  const { notifyFromEvent } = await import('@seip/database');
  const events = await prisma.outboxEvent.findMany({ where: { eventType: 'assignment.comment.created', payload: { path: ['assignment_id'], equals: a.id } } });
  for (const e of events) { await notifyFromEvent(e); await notifyFromEvent(e); } // idempotent
  const notes = await prisma.notification.findMany({ where: { kind: 'committee_comment', entityId: a.id }, orderBy: { createdAt: 'asc' } });
  const to = (key) => notes.filter((n) => n.userId === userId[key]);
  assert.equal(to('teacher').length, 2);
  assert.ok(to('teacher').every((n) => n.route === `/assignments/${a.id}/comments`));
  assert.equal(to('evaluator').length, 1);
  assert.equal(to('evaluator')[0].route, `/assignments/${a.id}/evidence`);
  assert.equal(to('director').length, 0, 'nobody else');
  assert.ok(notes.every((n) => !`${n.titleTh} ${n.bodyTh ?? ''}`.includes('แผนการสอน')));
  const listed = await app.inject({ method: 'GET', url: '/api/v1/notifications', headers: h('teacher') });
  assert.ok(listed.json().items.some((n) => n.kind === 'committee_comment'));

  // FR-062b: the round closes — the committee can no longer comment or read; the evaluatee still reads.
  await prisma.evaluationRound.update({ where: { id: round.id }, data: { status: 'closed' } });
  assert.equal((await post('evaluator', { indicator_id: ind, kind: 'comment', body: 'x' }, otherSchool)).json().code, 'PERM-003');
  assert.equal((await app.inject({ method: 'GET', url, headers: h('teacher') })).json().length, 3);
});
