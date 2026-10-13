// CCR-020 / FR-019: /auth/me lists the memberships in effect now, with the
// school's name, so a person at several schools can pick one by name — and an
// ended membership no longer offers screens the API would refuse.
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
let app, schoolA, schoolB, schoolOld, token;

before(async () => {
  ({ app } = await buildServer());
  await app.ready();
  schoolA = created.add(await prisma.school.create({ data: { code: `ctxA-${randomUUID()}`, name: 'โรงเรียนเอ' } }));
  schoolB = created.add(await prisma.school.create({ data: { code: `ctxB-${randomUUID()}`, name: 'โรงเรียนบี' } }));
  schoolOld = created.add(await prisma.school.create({ data: { code: `ctxO-${randomUUID()}`, name: 'โรงเรียนเดิม' } }));
  const password = `ctx-${randomUUID()}`;
  const user = await prisma.userAccount.create({
    data: { person: { create: { displayName: 'x' } }, email: `ctx-${randomUUID()}@x.io`, displayName: 'x', status: 'active', passwordHash: await argonHash(password) },
  });
  const m = (schoolId, extra = {}) => prisma.schoolMembership.create({
    data: { userId: user.id, schoolId, role: 'teacher', membershipScope: 'school', effectiveFrom: new Date('2020-01-01'), status: 'active', ...extra },
  });
  await m(schoolA.id);
  await m(schoolB.id);
  await m(schoolOld.id, { effectiveTo: new Date('2021-01-01'), status: 'ended' }); // transferred away
  token = (await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: user.email, password } })).json().access_token;
});

after(async () => {
  await cleanupSchools(prisma, created.ids(), created.userIds(), created.frameworkIds());
  await app.close();
  await prisma.$disconnect();
});

test('/auth/me lists current memberships only, each with its school name', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${token}` } });
  assert.equal(res.statusCode, 200);
  const schools = res.json().memberships.map((m) => [m.school_id, m.school_name]).sort();
  assert.deepEqual(schools, [[schoolA.id, 'โรงเรียนเอ'], [schoolB.id, 'โรงเรียนบี']].sort());
});

test('with two schools, a write needs X-School-Id (VAL-002 without it); the ended school is refused (PERM-002)', async () => {
  const body = { category_id: randomUUID(), title: 'x', kind: 'file', contains_learners: 'unknown', client_uuid: randomUUID() };
  const post = (schoolId) => app.inject({
    method: 'POST', url: '/api/v1/evidence',
    headers: { authorization: `Bearer ${token}`, 'idempotency-key': randomUUID(), ...(schoolId ? { 'x-school-id': schoolId } : {}) },
    payload: body,
  });
  const none = await post(null);
  assert.equal(none.json().code, 'VAL-002');
  assert.match(none.json().message, /school context/);
  const chosen = await post(schoolB.id);
  assert.equal(chosen.json().code, 'VAL-002');
  assert.match(chosen.json().message, /category/, 'past the school check: only the random category is wrong');
  assert.equal((await post(schoolOld.id)).json().code, 'PERM-002');
});
