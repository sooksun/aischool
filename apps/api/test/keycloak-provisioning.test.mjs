// ADR-0014: every SEIP account gets its Keycloak user, so it can sign in with
// SEIP ID. The API provisions at accept-invite and at password login — the two
// moments it holds the password — through the seip-provisioner service account.
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
import {
  KEYCLOAK_ISSUER, createUser, deleteUser, deleteUsersLinkedTo, linkedUsers, passwordToken, claimsOf,
} from '../../../tests/helpers/keycloak.mjs';

const skip = !KEYCLOAK_ISSUER && !process.env.CI ? 'KEYCLOAK_ISSUER not set (docker compose up -d keycloak)' : false;
const PROVISIONER_SECRET = 'seip-provisioner-dev-secret-not-for-real-use'; // gitleaks:allow — dev realm

const created = trackSchools();
const prisma = createPrismaClient();
const linked = new Set();
const strays = [];
let app, school, adminToken;

async function serverWith(env) {
  const saved = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try {
    const { app: a } = await buildServer();
    await a.ready();
    return a;
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

const login = (a, email, password) => a.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });

async function legacyUser(role = 'teacher') {
  const password = `legacy-${randomUUID()}`;
  const user = await prisma.userAccount.create({
    data: { person: { create: { displayName: role } }, email: `kcprov-${role}-${randomUUID()}@x.io`, displayName: role, status: 'active', passwordHash: await argonHash(password) },
  });
  await prisma.schoolMembership.create({
    data: { userId: user.id, schoolId: school.id, role, membershipScope: 'school', effectiveFrom: new Date('2020-01-01'), status: 'active' },
  });
  linked.add(user.id);
  return { user, password };
}

/** Invite through the API, accept with a chosen password. */
async function onboard(role) {
  const email = `kcprov-new-${role}-${randomUUID()}@x.io`;
  const invited = await app.inject({
    method: 'POST', url: '/api/v1/members', headers: { authorization: `Bearer ${adminToken}` },
    payload: { email, display_name: `ใหม่ ${role}`, role },
  });
  assert.equal(invited.statusCode, 201, invited.body);
  const password = `chosen-${randomUUID()}`;
  const accepted = await app.inject({ method: 'POST', url: '/api/v1/auth/accept-invite', payload: { invite_token: invited.json().invite_token, password } });
  assert.equal(accepted.statusCode, 204, accepted.body);
  const user = await prisma.userAccount.findUnique({ where: { email } });
  linked.add(user.id);
  return { user, email, password };
}

before(async () => {
  if (skip) return;
  app = await serverWith({ KEYCLOAK_ISSUER, KEYCLOAK_ADMIN_CLIENT_SECRET: PROVISIONER_SECRET });
  school = created.add(await prisma.school.create({ data: { code: `kcprov-${randomUUID()}`, name: 'Provisioning School' } }));
  const admin = await legacyUser('school_admin');
  adminToken = (await login(app, admin.user.email, admin.password)).json().access_token;
});

after(async () => {
  if (skip) return;
  for (const id of linked) await deleteUsersLinkedTo(id);
  for (const u of strays) await deleteUser(u);
  await cleanupSchools(prisma, created.ids(), created.userIds(), created.frameworkIds());
  await app?.close();
  await prisma.$disconnect();
});

test('accept-invite creates the Keycloak user, and SEIP ID sign-in works with the chosen password', { skip }, async () => {
  const { user, email, password } = await onboard('teacher');
  const [kc] = await linkedUsers(user.id);
  assert.ok(kc, 'a realm user carries this seip_uid');
  assert.equal(kc.email, email);
  assert.equal(kc.emailVerified, true);
  assert.deepEqual(kc.requiredActions, [], 'a teacher is not asked for a second factor');
  assert.ok((await prisma.userAccount.findUnique({ where: { id: user.id } })).kcLinkedAt);

  const token = await passwordToken({ email, password });
  assert.equal(claimsOf(token).seip_uid, user.id);
  const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${token}` } });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().id, user.id);
});

test('a role behind a second factor (ADR-0014 §6) must enrol TOTP at first SEIP ID sign-in', { skip }, async () => {
  const { user } = await onboard('director');
  const [kc] = await linkedUsers(user.id);
  assert.deepEqual(kc.requiredActions, ['CONFIGURE_TOTP']);
});

test('an existing account is provisioned at its next password login, once', { skip }, async () => {
  const { user, password } = await legacyUser('teacher');
  assert.equal((await linkedUsers(user.id)).length, 0);
  assert.equal((await login(app, user.email, password)).statusCode, 200);
  const [first] = await linkedUsers(user.id);
  assert.ok(first);
  assert.equal((await login(app, user.email, password)).statusCode, 200);
  const again = await linkedUsers(user.id);
  assert.equal(again.length, 1);
  assert.equal(again[0].id, first.id, 'the second login does not recreate or touch it');
});

test('Keycloak unreachable or refusing: login still succeeds and the link waits for the next login', { skip }, async () => {
  const { user, password } = await legacyUser('teacher');
  const broken = await serverWith({ KEYCLOAK_ISSUER, KEYCLOAK_ADMIN_CLIENT_SECRET: 'wrong-secret' });
  try {
    assert.equal((await login(broken, user.email, password)).statusCode, 200);
  } finally {
    await broken.close();
  }
  assert.equal((await prisma.userAccount.findUnique({ where: { id: user.id } })).kcLinkedAt, null);
  assert.equal((await linkedUsers(user.id)).length, 0);

  assert.equal((await login(app, user.email, password)).statusCode, 200);
  assert.equal((await linkedUsers(user.id)).length, 1, 'provisioned once Keycloak answers');
});

test('an email already taken in Keycloak by another account is left alone', { skip }, async () => {
  const { user, password } = await legacyUser('teacher');
  // Someone else's realm user with this email (seip_uid of a different account).
  const squatter = await createUser(randomUUID(), { email: user.email });
  strays.push(squatter);
  assert.equal((await login(app, user.email, password)).statusCode, 200);
  assert.equal((await linkedUsers(user.id)).length, 0);
  assert.equal((await prisma.userAccount.findUnique({ where: { id: user.id } })).kcLinkedAt, null);
});
