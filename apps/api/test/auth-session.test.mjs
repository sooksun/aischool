// CCR-008 session lifecycle: refresh rotation, reuse detection, server-side
// logout. Drives the real HTTP surface (fastify inject) against real Postgres —
// same style as login-rate-limit.test.mjs.
process.env.NODE_ENV = 'test';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { hash as argonHash } from '@node-rs/argon2';
import { hashRefreshToken } from '@seip/auth';
import { buildServer } from '../dist/server.js';

const prisma = new PrismaClient();
let app;
let email;
const password = 'session-test-password-1234';

before(async () => {
  ({ app } = await buildServer());
  await app.ready();

  email = `session-${randomUUID()}@x.io`;
  const user = await prisma.userAccount.create({
    data: { email, displayName: 'Session', status: 'active', passwordHash: await argonHash(password) },
  });
  const school = await prisma.school.create({ data: { code: `session-${randomUUID()}`, name: 'Session School' } });
  await prisma.schoolMembership.create({
    data: { userId: user.id, schoolId: school.id, role: 'teacher', membershipScope: 'school', effectiveFrom: new Date('2020-01-01'), status: 'active' },
  });
});

after(async () => {
  await app.close();
  await prisma.$disconnect();
});

async function login() {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  assert.equal(res.statusCode, 200);
  return res.json();
}

test('refresh rotates the pair; replaying the rotated token kills the whole family (SEC-AUTH-2)', async () => {
  const pair = await login();

  const rotated = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refresh_token: pair.refresh_token } });
  assert.equal(rotated.statusCode, 200);
  const next = rotated.json();
  assert.ok(next.access_token && next.refresh_token);
  assert.notEqual(next.refresh_token, pair.refresh_token, 'rotation must issue a NEW refresh token');

  const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${next.access_token}` } });
  assert.equal(me.statusCode, 200, 'the rotated access token must authenticate');

  // Replay of the OLD (rotated-away) token = theft signal.
  const replay = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refresh_token: pair.refresh_token } });
  assert.equal(replay.statusCode, 401);
  assert.equal(replay.json().code, 'AUTH-001');

  // ...which must have revoked the CURRENT token too (family kill).
  const afterReplay = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refresh_token: next.refresh_token } });
  assert.equal(afterReplay.statusCode, 401, 'reuse detection must revoke every live token for the account');
});

test('logout with a body revokes that refresh token server-side; the short-lived access token ages out by design', async () => {
  const pair = await login();

  const out = await app.inject({
    method: 'POST', url: '/api/v1/auth/logout',
    headers: { authorization: `Bearer ${pair.access_token}` },
    payload: { refresh_token: pair.refresh_token },
  });
  assert.equal(out.statusCode, 204);

  const refreshAfterLogout = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refresh_token: pair.refresh_token } });
  assert.equal(refreshAfterLogout.statusCode, 401, 'a logged-out refresh token must be dead');
  assert.equal(refreshAfterLogout.json().code, 'AUTH-001');

  // Documented CCR-008 trade-off: the access token is not blacklisted.
  const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${pair.access_token}` } });
  assert.equal(me.statusCode, 200);
});

test('logout without a body revokes every live refresh token for the caller (logout everywhere)', async () => {
  const a = await login();
  const b = await login();

  const out = await app.inject({
    method: 'POST', url: '/api/v1/auth/logout',
    headers: { authorization: `Bearer ${a.access_token}` },
  });
  assert.equal(out.statusCode, 204);

  for (const pair of [a, b]) {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refresh_token: pair.refresh_token } });
    assert.equal(res.statusCode, 401, 'every session must be revoked');
  }
});

test('refresh rejects garbage (AUTH-001), expired tokens (AUTH-002), and logout requires auth (401)', async () => {
  const garbage = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refresh_token: 'not-a-real-token' } });
  assert.equal(garbage.statusCode, 401);
  assert.equal(garbage.json().code, 'AUTH-001');

  // An expired-but-unrevoked row, planted directly.
  const user = await prisma.userAccount.findUnique({ where: { email } });
  const rawExpired = `expired-${randomUUID()}`;
  await prisma.refreshToken.create({
    data: { userId: user.id, tokenHash: hashRefreshToken(rawExpired), expiresAt: new Date(Date.now() - 60_000) },
  });
  const expired = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refresh_token: rawExpired } });
  assert.equal(expired.statusCode, 401);
  assert.equal(expired.json().code, 'AUTH-002');

  const noAuth = await app.inject({ method: 'POST', url: '/api/v1/auth/logout' });
  assert.equal(noAuth.statusCode, 401);

  // Someone else's token in the logout body is ignored, never an oracle: still
  // 204, and the victim's token stays alive. The attacker is a DIFFERENT account.
  const victim = await login();
  const attackerEmail = `session-attacker-${randomUUID()}@x.io`;
  const attackerPassword = 'attacker-password-1234';
  await prisma.userAccount.create({
    data: { email: attackerEmail, displayName: 'Attacker', status: 'active', passwordHash: await argonHash(attackerPassword) },
  });
  const attackerLogin = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: attackerEmail, password: attackerPassword } });
  assert.equal(attackerLogin.statusCode, 200);
  const attacker = attackerLogin.json();

  const cross = await app.inject({
    method: 'POST', url: '/api/v1/auth/logout',
    headers: { authorization: `Bearer ${attacker.access_token}` },
    payload: { refresh_token: victim.refresh_token },
  });
  assert.equal(cross.statusCode, 204);
  const victimStillAlive = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refresh_token: victim.refresh_token } });
  assert.equal(victimStillAlive.statusCode, 200, "logout must not be able to revoke another user's token");
});
