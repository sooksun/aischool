// CCR-025 / FR-097 (OQ-31): a school administrator's agreement (ว10) is
// acknowledged by the area admin — not by anyone inside the school — and the
// area admin acknowledges nothing else.
process.env.NODE_ENV = 'test';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { hash as argonHash } from '@node-rs/argon2';
import { createPrismaClient } from '../../../prisma/client.mjs';
import { buildServer } from '../dist/server.js';
import { cleanupSchools, trackSchools } from '../../../tests/helpers/db-cleanup.mjs';

const created = trackSchools();
const prisma = createPrismaClient();
const areaUsers = [];
let app, area, school, director, otherDirector, admin, areaAdmin, teacher, adminCycle, teacherCycle;
const CHALLENGE = { title: 'ยกระดับการอ่าน', method_plan: 'x', quantitative_target: 'x', qualitative_target: 'x' };

async function account(role, { personnel } = {}) {
  const password = `aa-${randomUUID()}`;
  const user = await prisma.userAccount.create({
    data: { person: { create: { displayName: role } }, email: `aa-${randomUUID()}@x.io`, displayName: role, status: 'active', passwordHash: await argonHash(password) },
  });
  if (role === 'area_admin') {
    areaUsers.push(user.id);
    await prisma.schoolMembership.create({ data: { userId: user.id, areaId: area.id, role, membershipScope: 'area', effectiveFrom: new Date('2020-01-01'), status: 'active' } });
  } else {
    await prisma.schoolMembership.create({ data: { userId: user.id, schoolId: school.id, role, membershipScope: 'school', effectiveFrom: new Date('2020-01-01'), status: 'active' } });
  }
  let personnelId = null;
  if (personnel) {
    personnelId = (await prisma.personnelProfile.create({
      data: { schoolId: school.id, userId: user.id, personId: user.personId, fullName: role, positionRole: personnel, rankLevelCode: personnel === 'administrator' ? 'admin_apply_adapt' : 'apply_adapt' },
    })).id;
  }
  const token = (await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: user.email, password } })).json().access_token;
  return { token, personnelId };
}
const h = (t) => ({ authorization: `Bearer ${t}`, 'x-school-id': school.id });
const post = (t, url, payload) => app.inject({ method: 'POST', url: `/api/v1${url}`, headers: h(t), payload });

async function submitted(who, cycleId) {
  const a = await post(who.token, '/agreements', { cycle_id: cycleId, personnel_id: who.personnelId, challenge: CHALLENGE });
  assert.equal(a.statusCode, 201, a.body);
  assert.equal((await post(who.token, `/agreements/${a.json().id}/submit`)).statusCode, 200);
  return a.json().id;
}

before(async () => {
  ({ app } = await buildServer());
  await app.ready();
  area = await prisma.area.create({ data: { code: `aa-${randomUUID()}`, name: 'สพป.ทดสอบ' } });
  school = created.add(await prisma.school.create({ data: { code: `aa-${randomUUID()}`, name: 'โรงเรียน', areaId: area.id } }));
  director = await account('director', { personnel: 'administrator' });
  otherDirector = await account('director');
  admin = await account('school_admin');
  areaAdmin = await account('area_admin');
  teacher = await account('teacher', { personnel: 'teacher' });
  const fw = async (code) => (await prisma.frameworkVersion.findFirst({ where: { code }, select: { id: true } })).id;
  const cycle = async (code, year) => (await post(otherDirector.token, '/cycles', {
    framework_version_id: await fw(code), fiscal_year: year, evaluation_kind: 'pa', title: code, starts_on: '2026-01-01', ends_on: '2026-12-31',
  })).json().id;
  adminCycle = await cycle('v10-2564-administrator', 3020);
  teacherCycle = await cycle('v9-2564-teacher', 3021);
});

after(async () => {
  await prisma.schoolMembership.deleteMany({ where: { userId: { in: areaUsers } } });
  await cleanupSchools(prisma, created.ids(), [...created.userIds(), ...areaUsers], created.frameworkIds());
  await prisma.area.delete({ where: { id: area.id } }).catch(() => {});
  await app.close();
  await prisma.$disconnect();
});

test("a director's agreement: the school cannot acknowledge it, the area admin can", async () => {
  assert.ok(adminCycle && teacherCycle);
  const id = await submitted(director, adminCycle);
  for (const who of [admin, otherDirector]) {
    const denied = await post(who.token, `/agreements/${id}/acknowledge`);
    assert.equal(denied.json().code, 'PERM-001', denied.body);
  }
  const ok = await post(areaAdmin.token, `/agreements/${id}/acknowledge`);
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.json().status, 'acknowledged');
});

test("a teacher's agreement stays with the school; the area admin is read-only there", async () => {
  const id = await submitted(teacher, teacherCycle);
  assert.equal((await post(areaAdmin.token, `/agreements/${id}/acknowledge`)).json().code, 'PERM-004');
  assert.equal((await post(otherDirector.token, `/agreements/${id}/acknowledge`)).statusCode, 200);
});
