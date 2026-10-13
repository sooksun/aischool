// FR-093: a person sees each app sign-in and browser session, and revokes one.
// A revoked app is refused at once (its unexpired access token included) and
// cannot renew: the Keycloak offline session is deleted.
//
// Against the real dev realm. Skipped locally without KEYCLOAK_ISSUER; fails
// instead in CI (CI=true).
process.env.NODE_ENV = 'test';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { hash as argonHash } from '@node-rs/argon2';
import { createPrismaClient } from '../../../prisma/client.mjs';
import { buildServer } from '../dist/server.js';
import { cleanupSchools, trackSchools } from '../../../tests/helpers/db-cleanup.mjs';
import { KEYCLOAK_ISSUER, createUser, deleteUser, mobileSignIn, mobileRefresh } from '../../../tests/helpers/keycloak.mjs';

const skip = !KEYCLOAK_ISSUER && !process.env.CI ? 'KEYCLOAK_ISSUER not set (docker compose up -d keycloak)' : false;
const PROVISIONER_SECRET = 'seip-provisioner-dev-secret-not-for-real-use'; // gitleaks:allow — dev realm

const created = trackSchools();
const prisma = createPrismaClient();
const kcUsers = [];
let app, school;

async function person() {
  const password = `dev-${randomUUID()}`;
  const user = await prisma.userAccount.create({
    data: { person: { create: { displayName: 'x' } }, email: `dev-${randomUUID()}@x.io`, displayName: 'x', status: 'active', passwordHash: await argonHash(password) },
  });
  await prisma.schoolMembership.create({
    data: { userId: user.id, schoolId: school.id, role: 'teacher', membershipScope: 'school', effectiveFrom: new Date('2020-01-01'), status: 'active' },
  });
  const kc = await createUser(user.id);
  kcUsers.push(kc);
  return { user, kc, password };
}

const call = (token, method, url, ua = 'SEIP-Mobile/1.4.0 (ios)') => app.inject({
  method, url: `/api/v1${url}`, headers: { authorization: `Bearer ${token}`, 'user-agent': ua },
});

before(async () => {
  if (skip) return;
  process.env.KEYCLOAK_ISSUER = KEYCLOAK_ISSUER;
  process.env.KEYCLOAK_ADMIN_CLIENT_SECRET = PROVISIONER_SECRET;
  ({ app } = await buildServer());
  await app.ready();
  school = created.add(await prisma.school.create({ data: { code: `dev-${randomUUID()}`, name: 'Devices' } }));
});

after(async () => {
  if (skip) return;
  for (const u of kcUsers) await deleteUser(u);
  await cleanupSchools(prisma, created.ids(), created.userIds(), created.frameworkIds());
  await app.close();
  await prisma.$disconnect();
});

test('each app sign-in is listed; revoking one refuses it at once and ends its Keycloak session', { skip }, async () => {
  const p = await person();
  const phone = await mobileSignIn(p.kc);
  const tablet = await mobileSignIn(p.kc);

  const first = await call(phone.access_token, 'GET', '/devices');
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.json().length, 1);
  assert.deepEqual(
    { platform: first.json()[0].platform, app_version: first.json()[0].app_version, current: first.json()[0].current },
    { platform: 'ios', app_version: '1.4.0', current: true },
  );
  const phoneId = first.json()[0].id;

  const both = await call(tablet.access_token, 'GET', '/devices', 'SEIP-Mobile/1.4.0 (android)');
  assert.equal(both.json().length, 2);
  assert.equal(both.json().find((d) => d.id === phoneId).current, false, 'only the calling session is current');

  const revoked = await call(tablet.access_token, 'DELETE', `/devices/${phoneId}`);
  assert.equal(revoked.statusCode, 204, revoked.body);

  const refused = await call(phone.access_token, 'GET', '/auth/me');
  assert.equal(refused.statusCode, 401);
  assert.equal(refused.json().code, 'AUTH-001');
  assert.equal(await mobileRefresh(phone.refresh_token), null, 'the offline session is gone at Keycloak');
  assert.equal((await call(tablet.access_token, 'GET', '/auth/me')).statusCode, 200, 'the other device carries on');
  assert.ok(await prisma.auditEvent.findFirst({ where: { entityType: 'DeviceSession', entityId: phoneId, action: 'revoked' } }));
});

test("another person's session is RES-001, like a missing one", { skip }, async () => {
  const a = await person();
  const b = await person();
  const aPhone = await mobileSignIn(a.kc);
  const bPhone = await mobileSignIn(b.kc);
  const aId = (await call(aPhone.access_token, 'GET', '/devices')).json()[0].id;
  assert.equal((await call(bPhone.access_token, 'DELETE', `/devices/${aId}`)).json().code, 'RES-001');
  assert.equal((await call(bPhone.access_token, 'DELETE', `/devices/${randomUUID()}`)).json().code, 'RES-001');
  assert.equal((await call(aPhone.access_token, 'GET', '/auth/me')).statusCode, 200);
});
