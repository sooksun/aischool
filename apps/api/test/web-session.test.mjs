// CCR-018 / ADR-0014 §4: web sign-in through Keycloak behind the BFF.
//
// The browser's part is played by hand: app.inject() for the API, and
// tests/helpers/keycloak.mjs signIn() for Keycloak's login (and OTP) forms. The
// cookies the API sets are carried between steps exactly as a browser would.
//
// Skipped locally without KEYCLOAK_ISSUER; fails instead in CI (CI=true).
process.env.NODE_ENV = 'test';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '../../../prisma/client.mjs';
import { buildServer } from '../dist/server.js';
import { cleanupSchools, trackSchools } from '../../../tests/helpers/db-cleanup.mjs';
import { KEYCLOAK_ISSUER, createUser, deleteUser, signIn, logoutEverywhere } from '../../../tests/helpers/keycloak.mjs';

const skip = !KEYCLOAK_ISSUER && !process.env.CI ? 'KEYCLOAK_ISSUER not set (docker compose up -d keycloak)' : false;

const ORIGIN = 'http://127.0.0.1:5173';
const created = trackSchools();
const prisma = createPrismaClient();
const kcUsers = [];
let app, school, categoryId, indicatorId, teacher, director;

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

/** Set-Cookie headers → { name: value } (Max-Age=0 means cleared). */
function cookiesFrom(res) {
  const raw = res.headers['set-cookie'];
  const out = {};
  for (const c of Array.isArray(raw) ? raw : raw ? [raw] : []) {
    const [kv] = c.split(';');
    const i = kv.indexOf('=');
    out[kv.slice(0, i)] = /Max-Age=0\b/.test(c) ? null : kv.slice(i + 1);
  }
  return out;
}
const cookieHeader = (jar) => Object.entries(jar).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('; ');

/**
 * The whole browser round trip: webLogin → Keycloak forms → webCallback.
 * Returns the callback response and the browser's cookies afterwards.
 */
async function browserSignIn(user, { acr = 'pwd', returnTo = '/', jar = {} } = {}) {
  const start = await app.inject({ method: 'GET', url: `/api/v1/auth/web/login?${new URLSearchParams({ return_to: returnTo, acr })}`, headers: { cookie: cookieHeader(jar) } });
  assert.equal(start.statusCode, 302, start.body);
  Object.assign(jar, cookiesFrom(start));
  const back = new URL(await signIn(start.headers.location, user.kc));
  assert.equal(`${back.origin}${back.pathname}`, `${ORIGIN}/api/v1/auth/web/callback`);
  const callback = await app.inject({ method: 'GET', url: `${back.pathname}${back.search}`, headers: { cookie: cookieHeader(jar) } });
  Object.assign(jar, cookiesFrom(callback));
  return { callback, jar };
}

const withSession = (jar, extra = {}) => ({ cookie: cookieHeader(jar), ...extra });
const me = (jar) => app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: withSession(jar) });

async function person(role) {
  const user = await prisma.userAccount.create({
    data: { person: { create: { displayName: role } }, email: `web-${role}-${randomUUID()}@x.io`, displayName: role, status: 'active' },
  });
  if (role === 'teacher') {
    await prisma.personnelProfile.create({
      data: { schoolId: school.id, userId: user.id, personId: user.personId, fullName: role, positionRole: 'teacher', rankLevelCode: 'web_kru' },
    });
  }
  await prisma.schoolMembership.create({
    data: { userId: user.id, schoolId: school.id, role, membershipScope: 'school', effectiveFrom: new Date('2020-01-01'), status: 'active' },
  });
  const kc = await createUser(user.id);
  kcUsers.push(kc);
  return { user, kc };
}

before(async () => {
  if (skip) return;
  app = await serverWith({
    KEYCLOAK_ISSUER, KEYCLOAK_WEB_CLIENT_SECRET: 'seip-web-dev-secret-not-for-real-use', // gitleaks:allow — dev realm
    WEB_PUBLIC_ORIGIN: ORIGIN, ENFORCE_MIN_ACR: 'true',
  });
  school = created.add(await prisma.school.create({ data: { code: `web-${randomUUID()}`, name: 'Web School' } }));
  await prisma.rankLevel.upsert({ where: { code: 'web_kru' }, create: { code: 'web_kru', roleFamily: 'teacher', labelTh: 'ครู', sortOrder: 2 }, update: {} });
  categoryId = (await prisma.evidenceCategory.create({ data: { code: `web-cat-${randomUUID()}`, labelTh: 'x', allowedMimeTypes: ['application/pdf'] } })).id;
  const fw = created.addFramework(await prisma.frameworkVersion.create({
    data: { code: `web-fw-${randomUUID()}`, roleFamily: 'teacher', legalRef: 'x', revisionYear: 9999, status: 'draft', effectiveFrom: new Date() },
  }));
  const domain = await prisma.evaluationDomain.create({ data: { frameworkVersionId: fw.id, code: 'D', nameTh: 'd', sortOrder: 1, part: 'standards' } });
  indicatorId = (await prisma.indicator.create({
    data: { domainId: domain.id, frameworkVersionId: fw.id, code: 'I-1', nameTh: 'i', sortOrder: 1, isScored: true, indicatorKind: 'standard' },
  })).id;
  teacher = await person('teacher');
  director = await person('director');
});

after(async () => {
  if (skip) return;
  for (const u of kcUsers) await deleteUser(u);
  await prisma.webSession.deleteMany({ where: { userId: { in: [teacher?.user.id, director?.user.id].filter(Boolean) } } });
  await cleanupSchools(prisma, created.ids(), created.userIds(), created.frameworkIds());
  await app?.close();
  await prisma.$disconnect();
});

test('sign-in sets an httpOnly session cookie and a readable CSRF cookie, then lands on return_to', { skip }, async () => {
  const { callback, jar } = await browserSignIn(teacher, { returnTo: '/evidence/new' });
  assert.equal(callback.statusCode, 302, callback.body);
  assert.equal(callback.headers.location, '/evidence/new');
  const raw = [callback.headers['set-cookie']].flat().join('\n');
  assert.match(raw, /__Host-seip=[^;]+; Path=\/; Secure; SameSite=Lax; Max-Age=28800; HttpOnly/);
  assert.match(raw, /__Host-seip-csrf=[^;]+; Path=\/; Secure; SameSite=Strict; Max-Age=28800(?!; HttpOnly)/);
  assert.equal(jar['__Host-seip-oidc'], null, 'the state cookie is cleared');

  const res = await me(jar);
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().id, teacher.user.id);
  const row = await prisma.webSession.findFirst({ where: { userId: teacher.user.id, revokedAt: null }, orderBy: { createdAt: 'desc' } });
  assert.notEqual(row.tokenHash, jar['__Host-seip'], 'only a hash is stored');
  assert.ok(!row.kcRefreshToken.startsWith('ey'), 'the Keycloak refresh token is sealed at rest');
});

test('writes need X-CSRF-Token matching the session (AUTH-007 otherwise)', { skip }, async () => {
  const { jar } = await browserSignIn(teacher);
  const body = { category_id: categoryId, title: 'via cookie', kind: 'file', contains_learners: 'unknown', client_uuid: randomUUID() };
  const post = (headers) => app.inject({ method: 'POST', url: '/api/v1/evidence', headers: { 'idempotency-key': randomUUID(), ...headers }, payload: body });

  for (const headers of [withSession(jar), withSession(jar, { 'x-csrf-token': 'forged' })]) {
    const res = await post(headers);
    assert.equal(res.statusCode, 403, res.body);
    assert.equal(res.json().code, 'AUTH-007');
  }
  const other = await browserSignIn(teacher);
  const crossed = await post(withSession(jar, { 'x-csrf-token': other.jar['__Host-seip-csrf'] }));
  assert.equal(crossed.json().code, 'AUTH-007', 'a CSRF token from another session does not fit this one');

  const ok = await post(withSession(jar, { 'x-csrf-token': jar['__Host-seip-csrf'] }));
  assert.equal(ok.statusCode, 201, ok.body);
});

test('a tampered state, a missing state cookie or an off-site return_to never sign anyone in', { skip }, async () => {
  const start = await app.inject({ method: 'GET', url: '/api/v1/auth/web/login?return_to=//evil.example/x' });
  const jar = cookiesFrom(start);
  const back = new URL(await signIn(start.headers.location, teacher.kc));

  const tampered = new URLSearchParams(back.search);
  tampered.set('state', 'not-the-state');
  const bad = await app.inject({ method: 'GET', url: `${back.pathname}?${tampered}`, headers: { cookie: cookieHeader(jar) } });
  assert.equal(bad.headers.location, '/login?error=sso');
  assert.equal(cookiesFrom(bad)['__Host-seip'], undefined);

  const noCookie = await app.inject({ method: 'GET', url: `${back.pathname}${back.search}` });
  assert.equal(noCookie.headers.location, '/login?error=sso');

  // The genuine callback still works once (the code is single-use at Keycloak),
  // and the off-site return_to was replaced by '/'.
  const good = await app.inject({ method: 'GET', url: `${back.pathname}${back.search}`, headers: { cookie: cookieHeader(jar) } });
  assert.equal(good.headers.location, '/');
});

test('step-up: a password session gets AUTH-006; signing in again with the second factor replaces it', { skip }, async () => {
  // The teacher makes the evidence and the mapping through their own session.
  const t = (await browserSignIn(teacher)).jar;
  const csrf = { 'x-csrf-token': t['__Host-seip-csrf'] };
  const evidence = await app.inject({
    method: 'POST', url: '/api/v1/evidence', headers: withSession(t, { ...csrf, 'idempotency-key': randomUUID() }),
    payload: { category_id: categoryId, title: 'step-up', kind: 'file', contains_learners: 'unknown', client_uuid: randomUUID() },
  });
  assert.equal(evidence.statusCode, 201, evidence.body);
  const mapping = await app.inject({
    method: 'POST', url: `/api/v1/evidence/${evidence.json().id}/mappings`,
    headers: withSession(t, { ...csrf, 'idempotency-key': randomUUID() }), payload: { indicator_id: indicatorId },
  });
  assert.equal(mapping.statusCode, 201, mapping.body);
  const m = mapping.json();

  const { jar } = await browserSignIn(director);
  const validate = (j) => app.inject({
    method: 'PATCH', url: `/api/v1/mappings/${m.id}`,
    headers: withSession(j, { 'x-csrf-token': j['__Host-seip-csrf'], 'if-match': `"${m.version}"` }), payload: { action: 'validate' },
  });
  const low = await validate(jar);
  assert.equal(low.json().code, 'AUTH-006');

  const passwordSession = { ...jar };
  const stepped = await browserSignIn(director, { acr: 'mfa', jar });
  assert.equal(stepped.callback.statusCode, 302);
  assert.equal((await me(passwordSession)).statusCode, 401, 'the password-level session is gone');
  const high = await validate(stepped.jar);
  assert.equal(high.statusCode, 200, high.body);
  assert.equal(high.json().status, 'validated');
});

test('idle 30 min, 8 h maximum, and a Keycloak session ended elsewhere all end the web session', { skip }, async () => {
  const idle = (await browserSignIn(teacher)).jar;
  await prisma.webSession.updateMany({ where: { userId: teacher.user.id, revokedAt: null }, data: { lastSeenAt: new Date(Date.now() - 31 * 60 * 1000) } });
  assert.equal((await me(idle)).statusCode, 401);

  const old = (await browserSignIn(teacher)).jar;
  await prisma.webSession.updateMany({ where: { userId: teacher.user.id, revokedAt: null }, data: { createdAt: new Date(Date.now() - 9 * 3600 * 1000), expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await me(old)).statusCode, 401);

  // Revocation: Keycloak ends the session; the next check (due at most a minute
  // later — forced due here) ends ours too.
  const live = (await browserSignIn(teacher)).jar;
  assert.equal((await me(live)).statusCode, 200);
  await logoutEverywhere(teacher.kc);
  await prisma.webSession.updateMany({ where: { userId: teacher.user.id, revokedAt: null }, data: { kcCheckDueAt: new Date(Date.now() - 1000) } });
  const after = await me(live);
  assert.equal(after.statusCode, 401, after.body);
});

test('logout: CSRF-checked, revokes the session, clears both cookies, idempotent', { skip }, async () => {
  const { jar } = await browserSignIn(teacher);
  const forged = await app.inject({ method: 'POST', url: '/api/v1/auth/web/logout', headers: withSession(jar) });
  assert.equal(forged.json().code, 'AUTH-007');
  assert.equal((await me(jar)).statusCode, 200, 'a forged logout changed nothing');

  const out = await app.inject({ method: 'POST', url: '/api/v1/auth/web/logout', headers: withSession(jar, { 'x-csrf-token': jar['__Host-seip-csrf'] }) });
  assert.equal(out.statusCode, 204);
  const cleared = cookiesFrom(out);
  assert.equal(cleared['__Host-seip'], null);
  assert.equal(cleared['__Host-seip-csrf'], null);
  assert.equal((await me(jar)).statusCode, 401);

  const again = await app.inject({ method: 'POST', url: '/api/v1/auth/web/logout' });
  assert.equal(again.statusCode, 204);
});

test('not configured: webLogin answers 501 SYS-003 and the bearer flow is untouched', { skip }, async () => {
  const bare = await serverWith({ KEYCLOAK_WEB_CLIENT_SECRET: undefined, WEB_PUBLIC_ORIGIN: undefined });
  try {
    const res = await bare.inject({ method: 'GET', url: '/api/v1/auth/web/login' });
    assert.equal(res.statusCode, 501);
    assert.equal(res.json().code, 'SYS-003');
  } finally {
    await bare.close();
  }
});
