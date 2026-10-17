// CCR-019 / FR-091: bulk onboarding. Every row is an inviteMember — same checks,
// same transaction — and passes or fails on its own; a dry run writes nothing.
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
let app, school, adminToken, teacherToken, existingEmail;

async function account(role) {
  const password = `import-${randomUUID()}`;
  const user = await prisma.userAccount.create({
    data: { person: { create: { displayName: role } }, email: `import-${role}-${randomUUID()}@x.io`, displayName: role, status: 'active', passwordHash: await argonHash(password) },
  });
  await prisma.schoolMembership.create({
    data: { userId: user.id, schoolId: school.id, role, membershipScope: 'school', effectiveFrom: new Date('2020-01-01'), status: 'active' },
  });
  const token = (await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: user.email, password } })).json().access_token;
  return { user, token };
}

before(async () => {
  ({ app } = await buildServer());
  await app.ready();
  school = created.add(await prisma.school.create({ data: { code: `import-${randomUUID()}`, name: 'Import School' } }));
  adminToken = (await account('school_admin')).token;
  const teacher = await account('teacher');
  teacherToken = teacher.token;
  existingEmail = teacher.user.email;
});

after(async () => {
  await cleanupSchools(prisma, created.ids(), created.userIds(), created.frameworkIds());
  await app.close();
  await prisma.$disconnect();
});

const run = (token, body) => app.inject({ method: 'POST', url: '/api/v1/members/import', headers: { authorization: `Bearer ${token}` }, payload: body });
const teacherRow = (email, extra = {}) => ({
  email, display_name: 'ครูนำเข้า', role: 'teacher',
  personnel: { full_name: 'ครูนำเข้า ทดสอบ', position_role: 'teacher', rank_level_code: 'apply_adapt' }, ...extra,
});

test('dry run: every row checked, nothing written, each error reported against its row', async () => {
  const ok = `ok-${randomUUID()}@x.io`;
  const res = await run(adminToken, {
    dry_run: true,
    rows: [
      teacherRow(ok),
      { email: 'not-an-email', display_name: 'x', role: 'teacher' },
      teacherRow(ok.toUpperCase()), // same person twice in one file
      teacherRow(existingEmail),
      { email: `area-${randomUUID()}@x.io`, display_name: 'x', role: 'area_admin' },
      teacherRow(`rank-${randomUUID()}@x.io`, { personnel: { full_name: 'x', position_role: 'administrator', rank_level_code: 'apply_adapt' } }),
    ],
  });
  assert.equal(res.statusCode, 200, res.body);
  const r = res.json();
  assert.equal(r.dry_run, true);
  assert.deepEqual(r.results.map((x) => [x.row, x.status, x.error?.code ?? null]), [
    [1, 'would_invite', null],
    [2, 'rejected', 'VAL-001'],
    [3, 'rejected', 'VAL-002'],
    [4, 'rejected', 'RES-003'],
    [5, 'rejected', 'VAL-002'],
    [6, 'rejected', 'VAL-003'],
  ]);
  assert.equal(r.results[1].error.details[0].field, 'email');
  assert.equal(await prisma.userAccount.count({ where: { email: ok } }), 0, 'a dry run writes nothing');
});

test('import: good rows are invited with a one-time token, bad rows are skipped', async () => {
  const a = `a-${randomUUID()}@x.io`;
  const b = `b-${randomUUID()}@x.io`;
  const res = await run(adminToken, { rows: [teacherRow(a), { email: 'bad', display_name: '', role: 'teacher' }, teacherRow(b)] });
  assert.equal(res.statusCode, 200, res.body);
  const [ra, rbad, rb] = res.json().results;
  assert.equal(ra.status, 'invited');
  assert.equal(ra.member.email, a);
  assert.equal(ra.member.user_status, 'invited');
  assert.ok(ra.invite_token);
  assert.equal(rbad.status, 'rejected');
  assert.equal(rb.status, 'invited');
  assert.notEqual(ra.invite_token, rb.invite_token);

  // The token works exactly like one from inviteMember.
  const accept = await app.inject({ method: 'POST', url: '/api/v1/auth/accept-invite', payload: { invite_token: ra.invite_token, password: 'imported-teacher-pass-1234' } });
  assert.equal(accept.statusCode, 204);

  // Importing the same list again: both are now current members.
  const again = await run(adminToken, { rows: [teacherRow(a), teacherRow(b)] });
  assert.deepEqual(again.json().results.map((x) => x.error?.code), ['RES-003', 'RES-003']);
});

test('only school_admin may import (PERM-001), and the size limit holds', async () => {
  const denied = await run(teacherToken, { rows: [teacherRow(`t-${randomUUID()}@x.io`)] });
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.json().code, 'PERM-001');

  const tooMany = await run(adminToken, { dry_run: true, rows: Array.from({ length: 501 }, (_, i) => teacherRow(`n${i}-${randomUUID()}@x.io`)) });
  assert.equal(tooMany.statusCode, 400);
  assert.equal(tooMany.json().code, 'VAL-001');
});
