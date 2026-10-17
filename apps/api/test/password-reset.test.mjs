// FR-099 / CCR-022: a school admin issues a one-time reset; the member sets a new
// password with it; every earlier session ends, here and in SEIP ID, and the
// SEIP ID password becomes the new one.
process.env.NODE_ENV = 'test';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { hash as argonHash } from '@node-rs/argon2';
import { createPrismaClient } from '../../../prisma/client.mjs';
import { buildServer } from '../dist/server.js';
import { cleanupSchools, trackSchools } from '../../../tests/helpers/db-cleanup.mjs';
import { KEYCLOAK_ISSUER, createUser, deleteUser, mobileSignIn, mobileRefresh, passwordToken } from '../../../tests/helpers/keycloak.mjs';

const kcSkip = !KEYCLOAK_ISSUER && !process.env.CI ? 'KEYCLOAK_ISSUER not set' : false;
const PROVISIONER_SECRET = 'seip-provisioner-dev-secret-not-for-real-use'; // gitleaks:allow — dev realm

const created = trackSchools();
const prisma = createPrismaClient();
const kcUsers = [];
let app, school, admin;

async function account(role, { password = `pr-${randomUUID()}` } = {}) {
  const user = await prisma.userAccount.create({
    data: { person: { create: { displayName: role } }, email: `pr-${randomUUID()}@x.io`, displayName: role, status: 'active', passwordHash: password ? await argonHash(password) : null },
  });
  const membership = await prisma.schoolMembership.create({
    data: { userId: user.id, schoolId: school.id, role, membershipScope: 'school', effectiveFrom: new Date('2020-01-01'), status: 'active' },
  });
  return { user, membership, password };
}
const login = (email, password) => app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
const issue = (token, membershipId) => app.inject({
  method: 'POST', url: `/api/v1/members/${membershipId}/password-reset`, headers: { authorization: `Bearer ${token}` },
});
const redeem = (reset_token, password) => app.inject({ method: 'POST', url: '/api/v1/auth/password-reset', payload: { reset_token, password } });

before(async () => {
  if (KEYCLOAK_ISSUER) {
    process.env.KEYCLOAK_ISSUER = KEYCLOAK_ISSUER;
    process.env.KEYCLOAK_ADMIN_CLIENT_SECRET = PROVISIONER_SECRET;
  }
  ({ app } = await buildServer());
  await app.ready();
  school = created.add(await prisma.school.create({ data: { code: `pr-${randomUUID()}`, name: 'Reset' } }));
  const a = await account('school_admin');
  admin = (await login(a.user.email, a.password)).json().access_token;
  admin = { token: admin, membershipId: a.membership.id };
});

after(async () => {
  for (const u of kcUsers) await deleteUser(u);
  await cleanupSchools(prisma, created.ids(), created.userIds(), created.frameworkIds());
  await app.close();
  await prisma.$disconnect();
});

test('a reset sets the new password once, ends earlier sessions, and is audited', async () => {
  const t = await account('teacher');
  const old = (await login(t.user.email, t.password)).json();

  const issued = await issue(admin.token, t.membership.id);
  assert.equal(issued.statusCode, 201, issued.body);
  const { reset_token, expires_at } = issued.json();
  assert.ok(new Date(expires_at) - Date.now() <= 30 * 60_000 + 1000);

  assert.equal((await redeem(reset_token, 'short')).statusCode, 400);
  const fresh = `new-${randomUUID()}`;
  assert.equal((await redeem(reset_token, fresh)).statusCode, 204);
  assert.equal((await redeem(reset_token, fresh)).json().code, 'AUTH-008', 'single use');
  assert.equal((await redeem('not-a-token', fresh)).json().code, 'AUTH-008');

  assert.equal((await login(t.user.email, t.password)).statusCode, 401, 'old password gone');
  assert.equal((await login(t.user.email, fresh)).statusCode, 200);
  const refreshed = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refresh_token: old.refresh_token } });
  assert.equal(refreshed.statusCode, 401, 'earlier refresh token revoked');

  const audit = await prisma.auditEvent.findMany({ where: { entityId: t.user.id, action: { in: ['password_reset_issued', 'password_reset_completed'] } } });
  assert.equal(audit.length, 2);
});

test('a newer reset cancels the older; an expired one is refused', async () => {
  const t = await account('teacher');
  const first = (await issue(admin.token, t.membership.id)).json().reset_token;
  const second = (await issue(admin.token, t.membership.id)).json().reset_token;
  assert.equal((await redeem(first, `x-${randomUUID()}`)).json().code, 'AUTH-008');
  await prisma.passwordReset.updateMany({ where: { userId: t.user.id, usedAt: null }, data: { createdAt: new Date(Date.now() - 31 * 60_000), expiresAt: new Date(Date.now() - 60_000) } });
  assert.equal((await redeem(second, `x-${randomUUID()}`)).json().code, 'AUTH-008');
});

test('not for your own account, an invited account, another school, or a teacher', async () => {
  assert.equal((await issue(admin.token, admin.membershipId)).json().code, 'VAL-002');
  const invited = await account('teacher', { password: null });
  assert.equal((await issue(admin.token, invited.membership.id)).json().code, 'VAL-002');
  assert.equal((await issue(admin.token, randomUUID())).json().code, 'RES-001');
  const t = await account('teacher');
  const teacherToken = (await login(t.user.email, t.password)).json().access_token;
  assert.equal((await issue(teacherToken, admin.membershipId)).json().code, 'PERM-001');
});

test('SEIP ID gets the new password and its sessions, the app included, end', { skip: kcSkip }, async () => {
  const t = await account('teacher');
  const kc = await createUser(t.user.id, { email: t.user.email });
  kcUsers.push(kc);
  await prisma.userAccount.update({ where: { id: t.user.id }, data: { kcLinkedAt: new Date() } });
  const phone = await mobileSignIn(kc);
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${phone.access_token}`, 'user-agent': 'SEIP-Mobile/1.0 (android)' } })).statusCode, 200);

  const fresh = `kc-${randomUUID()}`;
  assert.equal((await redeem((await issue(admin.token, t.membership.id)).json().reset_token, fresh)).statusCode, 204);

  const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${phone.access_token}` } });
  assert.equal(me.statusCode, 401, 'the app is refused at once');
  assert.equal(await mobileRefresh(phone.refresh_token), null, 'and cannot renew');
  // Only the new password is tried: failed attempts here would count towards
  // the realm's brute-force lockout and could lock the account mid-test.
  assert.ok(await passwordToken({ ...kc, password: fresh }), 'SEIP ID takes the new password');
});
