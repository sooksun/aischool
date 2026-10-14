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
    await prisma.personnelProfile.create({ data: { schoolId: sch.id, userId: user.id, personId: user.personId, fullName: key, positionRole: 'teacher', rankLevelCode: 'cov_kru' } });
  }
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
