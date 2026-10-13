// FR-099a / CCR-023: a person confirms their profile or asks for a correction;
// the school admin edits it, which clears the note, and a change of position or
// rank asks the person to confirm again.
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
let app, school, teacher, admin, profileId;

async function account(role, personnel) {
  const password = `pp-${randomUUID()}`;
  const user = await prisma.userAccount.create({
    data: { person: { create: { displayName: role } }, email: `pp-${randomUUID()}@x.io`, displayName: role, status: 'active', passwordHash: await argonHash(password) },
  });
  await prisma.schoolMembership.create({ data: { userId: user.id, schoolId: school.id, role, membershipScope: 'school', effectiveFrom: new Date('2020-01-01'), status: 'active' } });
  let profile = null;
  if (personnel) {
    profile = await prisma.personnelProfile.create({
      data: { schoolId: school.id, userId: user.id, personId: user.personId, fullName: 'ครูทดสอบ', positionRole: 'teacher', rankLevelCode: 'pp_kru' },
    });
  }
  const token = (await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: user.email, password } })).json().access_token;
  return { user, token, profile };
}
const call = (token, method, url, payload) => app.inject({ method, url: `/api/v1${url}`, headers: { authorization: `Bearer ${token}` }, payload });

before(async () => {
  ({ app } = await buildServer());
  await app.ready();
  school = created.add(await prisma.school.create({ data: { code: `pp-${randomUUID()}`, name: 'Profile' } }));
  for (const [code, family] of [['pp_kru', 'teacher'], ['pp_chamnan', 'teacher'], ['pp_admin', 'administrator']]) {
    await prisma.rankLevel.upsert({ where: { code }, create: { code, roleFamily: family, labelTh: code, sortOrder: 9 }, update: {} });
  }
  teacher = await account('teacher', true);
  admin = await account('school_admin', false);
  profileId = teacher.profile.id;
});

after(async () => {
  await cleanupSchools(prisma, created.ids(), created.userIds(), created.frameworkIds());
  await app.close();
  await prisma.$disconnect();
});

test('/auth/me shows an unconfirmed profile; confirming it records the time', async () => {
  const me = (await call(teacher.token, 'GET', '/auth/me')).json();
  assert.equal(me.personnel.confirmed_at, null);
  assert.equal(me.personnel.full_name, 'ครูทดสอบ');
  const ok = await call(teacher.token, 'POST', '/me/personnel/confirm');
  assert.equal(ok.statusCode, 200, ok.body);
  assert.ok(ok.json().confirmed_at);
  assert.ok((await call(teacher.token, 'GET', '/auth/me')).json().personnel.confirmed_at);
});

test('a correction request unconfirms and reaches the admin; the admin edit clears it and asks to confirm again', async () => {
  const asked = await call(teacher.token, 'POST', '/me/personnel/correction', { note: 'ได้วิทยฐานะชำนาญการแล้ว 1 ต.ค. 2569' });
  assert.equal(asked.statusCode, 200, asked.body);
  assert.equal(asked.json().confirmed_at, null);
  const list = (await call(admin.token, 'GET', '/personnel')).json();
  assert.equal(list.find((p) => p.id === profileId).correction_note, 'ได้วิทยฐานะชำนาญการแล้ว 1 ต.ค. 2569');

  const edited = await call(admin.token, 'PATCH', `/personnel/${profileId}`, { rank_level_code: 'pp_chamnan', rank_since: '2026-10-01' });
  assert.equal(edited.statusCode, 200, edited.body);
  assert.deepEqual(
    { rank: edited.json().rank_level_code, since: edited.json().rank_since, note: edited.json().correction_note, confirmed: edited.json().confirmed_at },
    { rank: 'pp_chamnan', since: '2026-10-01', note: null, confirmed: null },
  );
  assert.ok(await prisma.auditEvent.findFirst({ where: { entityType: 'PersonnelProfile', entityId: profileId, action: 'updated' } }));

  await call(teacher.token, 'POST', '/me/personnel/confirm');
  const renamed = await call(admin.token, 'PATCH', `/personnel/${profileId}`, { full_name: 'ครูทดสอบ ใจดี' });
  assert.ok(renamed.json().confirmed_at, 'a rename alone keeps the confirmation');
});

test('a rank outside the position family is VAL-003; another school or a teacher cannot edit', async () => {
  assert.equal((await call(admin.token, 'PATCH', `/personnel/${profileId}`, { rank_level_code: 'pp_admin' })).json().code, 'VAL-003');
  assert.equal((await call(admin.token, 'PATCH', `/personnel/${randomUUID()}`, { full_name: 'x' })).json().code, 'RES-001');
  assert.equal((await call(teacher.token, 'PATCH', `/personnel/${profileId}`, { full_name: 'x' })).json().code, 'PERM-001');
  assert.equal((await call(admin.token, 'POST', '/me/personnel/confirm')).json().code, 'RES-001', 'no profile of their own');
  assert.equal((await call(teacher.token, 'POST', '/me/personnel/correction', { note: '' })).statusCode, 400);
});
