// CCR-021 / FR-090: an area admin lists, opens, renames and closes the schools of
// their own สพท. and appoints each school's first school_admin. Another area is
// RES-001; a school role is PERM-001; a closed school ends its members' access.
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
const extraUsers = [];
let app, area, otherArea, school, otherSchool, adminToken, teacherToken;

async function account(membership) {
  const password = `area-${randomUUID()}`;
  const user = await prisma.userAccount.create({
    data: { person: { create: { displayName: 'x' } }, email: `area-${randomUUID()}@x.io`, displayName: 'x', status: 'active', passwordHash: await argonHash(password) },
  });
  extraUsers.push(user.id);
  await prisma.schoolMembership.create({ data: { userId: user.id, effectiveFrom: new Date('2020-01-01'), status: 'active', ...membership } });
  return (await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: user.email, password } })).json().access_token;
}

const call = (token, method, url, payload) => app.inject({
  method, url: `/api/v1${url}`, headers: { authorization: `Bearer ${token}`, 'idempotency-key': randomUUID() }, payload,
});

before(async () => {
  ({ app } = await buildServer());
  await app.ready();
  area = await prisma.area.create({ data: { code: `area-${randomUUID()}`, name: 'สพป.ทดสอบ' } });
  otherArea = await prisma.area.create({ data: { code: `area-${randomUUID()}`, name: 'สพป.อื่น' } });
  school = created.add(await prisma.school.create({ data: { code: `as-${randomUUID()}`, name: 'โรงเรียนในเขต', areaId: area.id } }));
  otherSchool = created.add(await prisma.school.create({ data: { code: `as-${randomUUID()}`, name: 'โรงเรียนเขตอื่น', areaId: otherArea.id } }));
  adminToken = await account({ areaId: area.id, role: 'area_admin', membershipScope: 'area' });
  teacherToken = await account({ schoolId: school.id, role: 'teacher', membershipScope: 'school' });
});

after(async () => {
  const mine = await prisma.school.findMany({ where: { areaId: { in: [area.id, otherArea.id] } }, select: { id: true } });
  await prisma.schoolMembership.deleteMany({ where: { userId: { in: extraUsers }, schoolId: null } });
  await cleanupSchools(prisma, [...new Set([...created.ids(), ...mine.map((s) => s.id)])], [...created.userIds(), ...extraUsers], created.frameworkIds());
  await prisma.area.deleteMany({ where: { id: { in: [area.id, otherArea.id] } } });
  await app.close();
  await prisma.$disconnect();
});

test('the area admin lists and opens schools in their own area only', async () => {
  const list = await call(adminToken, 'GET', `/areas/${area.id}/schools`);
  assert.equal(list.statusCode, 200);
  assert.deepEqual(list.json().map((s) => s.id), [school.id]);

  const code = `new-${randomUUID()}`;
  const made = await call(adminToken, 'POST', `/areas/${area.id}/schools`, { code, name: 'โรงเรียนใหม่' });
  assert.equal(made.statusCode, 201);
  assert.equal(made.json().area_id, area.id);
  assert.equal(made.json().status, 'active');
  const audit = await prisma.auditEvent.findFirst({ where: { entityType: 'School', entityId: made.json().id, action: 'created' } });
  assert.ok(audit, 'opening a school is audited');

  const dup = await call(adminToken, 'POST', `/areas/${area.id}/schools`, { code, name: 'ซ้ำ' });
  assert.equal(dup.json().code, 'RES-002');
});

test('another area or its school does not exist for this caller (RES-001); school roles get PERM-001', async () => {
  assert.equal((await call(adminToken, 'GET', `/areas/${otherArea.id}/schools`)).json().code, 'RES-001');
  assert.equal((await call(adminToken, 'GET', `/areas/${randomUUID()}/schools`)).json().code, 'RES-001');
  assert.equal((await call(adminToken, 'PATCH', `/schools/${otherSchool.id}`, { name: 'x' })).json().code, 'RES-001');
  assert.equal((await call(adminToken, 'POST', `/schools/${otherSchool.id}/admins`, { email: 'a@x.io', display_name: 'a' })).json().code, 'RES-001');
  assert.equal((await call(teacherToken, 'GET', `/areas/${area.id}/schools`)).json().code, 'PERM-001');
  assert.equal((await call(teacherToken, 'PATCH', `/schools/${school.id}`, { name: 'x' })).json().code, 'PERM-001');
});

test('appointing a school admin issues an invite that signs in as school_admin', async () => {
  const email = `sa-${randomUUID()}@x.io`;
  const res = await call(adminToken, 'POST', `/schools/${school.id}/admins`, { email, display_name: 'ผู้ดูแลโรงเรียน' });
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(res.json().member.role, 'school_admin');
  const password = `sa-${randomUUID()}`;
  const accepted = await app.inject({ method: 'POST', url: '/api/v1/auth/accept-invite', payload: { invite_token: res.json().invite_token, password } });
  assert.equal(accepted.statusCode, 204, accepted.body);
  const user = await prisma.userAccount.findUnique({ where: { email } });
  extraUsers.push(user.id);
  const token = (await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } })).json().access_token;
  const members = await call(token, 'GET', '/members');
  assert.equal(members.statusCode, 200, 'the new school_admin manages the school');
});

test('closing a school ends its members\' access; reopening restores it', async () => {
  const before = await call(teacherToken, 'GET', '/auth/me');
  assert.ok(before.json().memberships.some((m) => m.school_id === school.id));

  const closed = await call(adminToken, 'PATCH', `/schools/${school.id}`, { status: 'inactive' });
  assert.equal(closed.json().status, 'inactive');
  assert.ok(await prisma.auditEvent.findFirst({ where: { entityType: 'School', entityId: school.id, action: 'closed' } }));

  const me = await call(teacherToken, 'GET', '/auth/me');
  assert.ok(!me.json().memberships.some((m) => m.school_id === school.id), 'the closed school is no longer offered');
  const evidence = await call(teacherToken, 'GET', '/evidence');
  assert.notEqual(evidence.statusCode, 200, 'nor served');
  assert.equal((await call(adminToken, 'POST', `/schools/${school.id}/admins`, { email: `z-${randomUUID()}@x.io`, display_name: 'z' })).json().code, 'VAL-002');
  assert.equal((await call(adminToken, 'GET', `/areas/${area.id}/schools`)).statusCode, 200, 'the area admin still sees it');

  await call(adminToken, 'PATCH', `/schools/${school.id}`, { status: 'active' });
  assert.ok((await call(teacherToken, 'GET', '/auth/me')).json().memberships.some((m) => m.school_id === school.id));
});
