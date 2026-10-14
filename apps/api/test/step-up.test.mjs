// ADR-0014 step-up: Keycloak access tokens and permissions.yaml `min_acr`.
//
// Runs against the real dev Keycloak (docker compose: keycloak; CI starts the
// same image and realm). Tokens come from tests/helpers/keycloak.mjs: LoA 1 by
// password, LoA 2 by the browser flow with a TOTP code — the same flow a person
// goes through.
//
// Skipped locally when KEYCLOAK_ISSUER is unset; in CI (CI=true) a missing
// issuer fails instead, so the gate cannot pass by skipping.
process.env.NODE_ENV = 'test';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { createPrismaClient } from '../../../prisma/client.mjs';
import { hash as argonHash } from '@node-rs/argon2';
import { buildServer } from '../dist/server.js';
import { cleanupSchools, trackSchools } from '../../../tests/helpers/db-cleanup.mjs';
import { bearer, postEvidence, postMapping, actOnMapping } from '../../../tests/helpers/api-evidence.mjs';
import {
  KEYCLOAK_ISSUER, createUser, deleteUser, passwordToken, mfaToken, claimsOf,
  mobileSignIn, mobileRefresh, revokeOfflineSessions,
} from '../../../tests/helpers/keycloak.mjs';

const skip = !KEYCLOAK_ISSUER && !process.env.CI ? 'KEYCLOAK_ISSUER not set (docker compose up -d keycloak)' : false;

const created = trackSchools();
const prisma = createPrismaClient();
const kcUsers = [];
let enforced, relaxed, noKeycloak;
let school, roundId, categoryId, indicatorIds = [];
const people = {};
const areaUserIds = [];
let area;

async function serverWith(env) {
  const saved = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try {
    const { app } = await buildServer();
    await app.ready();
    return app;
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

async function person(role, { personnel = false } = {}) {
  const password = `stepup-${randomUUID()}`;
  const user = await prisma.userAccount.create({
    data: {
      person: { create: { displayName: role } }, email: `stepup-${role}-${randomUUID()}@x.io`,
      displayName: role, status: 'active', passwordHash: await argonHash(password),
    },
  });
  if (personnel) {
    await prisma.personnelProfile.create({
      data: { schoolId: school.id, userId: user.id, personId: user.personId, fullName: role, positionRole: 'teacher', rankLevelCode: 'stepup_kru' },
    });
  }
  await prisma.schoolMembership.create({
    data: role === 'area_admin'
      ? { userId: user.id, areaId: area.id, role, membershipScope: 'area', effectiveFrom: new Date('2020-01-01'), status: 'active' }
      : { userId: user.id, schoolId: school.id, role, membershipScope: 'school', effectiveFrom: new Date('2020-01-01'), status: 'active' },
  });
  if (role === 'area_admin') areaUserIds.push(user.id);
  const kc = await createUser(user.id);
  kcUsers.push(kc);
  const own = (await enforced.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: user.email, password } })).json().access_token;
  return { user, kc, own, pwd: await passwordToken(kc), mfa: await mfaToken(kc) };
}

before(async () => {
  if (skip) return;
  enforced = await serverWith({ KEYCLOAK_ISSUER, ENFORCE_MIN_ACR: 'true' });
  relaxed = await serverWith({ KEYCLOAK_ISSUER, ENFORCE_MIN_ACR: 'false' });
  noKeycloak = await serverWith({ KEYCLOAK_ISSUER: undefined, ENFORCE_MIN_ACR: 'true' });

  area = await prisma.area.create({ data: { code: `stepup-area-${randomUUID()}`, name: 'Step-up Area' } });
  school = created.add(await prisma.school.create({ data: { code: `stepup-${randomUUID()}`, name: 'Step-up School', areaId: area.id } }));
  await prisma.rankLevel.upsert({
    where: { code: 'stepup_kru' }, create: { code: 'stepup_kru', roleFamily: 'teacher', labelTh: 'ครู', sortOrder: 2 }, update: {},
  });
  categoryId = (await prisma.evidenceCategory.create({
    data: { code: `stepup-cat-${randomUUID()}`, labelTh: 'x', allowedMimeTypes: ['application/pdf'] },
  })).id;
  const fw = created.addFramework(await prisma.frameworkVersion.create({
    data: { code: `stepup-fw-${randomUUID()}`, roleFamily: 'teacher', legalRef: 'x', revisionYear: 9999, status: 'draft', effectiveFrom: new Date() },
  }));
  const domain = await prisma.evaluationDomain.create({ data: { frameworkVersionId: fw.id, code: 'D', nameTh: 'd', sortOrder: 1, part: 'standards' } });
  for (let i = 1; i <= 4; i += 1) {
    indicatorIds.push((await prisma.indicator.create({
      data: { domainId: domain.id, frameworkVersionId: fw.id, code: `I-${i}`, nameTh: 'i', sortOrder: i, isScored: true, indicatorKind: 'standard' },
    })).id);
  }
  const cycle = await prisma.evaluationCycle.create({
    data: {
      schoolId: school.id, frameworkVersionId: fw.id, fiscalYear: 9999, evaluationKind: 'pa', title: 'c',
      startsOn: new Date('2026-01-01'), endsOn: new Date('2026-12-31'),
    },
  });
  roundId = (await prisma.evaluationRound.create({
    data: { cycleId: cycle.id, roundNumber: 1, purpose: 'x', periodStart: new Date('2026-01-01'), periodEnd: new Date('2026-12-31') },
  })).id;

  people.teacher = await person('teacher', { personnel: true });
  people.director = await person('director');
  people.admin = await person('school_admin');
  people.areaAdmin = await person('area_admin');
});

after(async () => {
  if (skip) return;
  for (const u of kcUsers) await deleteUser(u);
  await prisma.schoolMembership.deleteMany({ where: { userId: { in: areaUserIds } } });
  await cleanupSchools(prisma, created.ids(), [...created.userIds(), ...areaUserIds], created.frameworkIds());
  await prisma.area.delete({ where: { id: area.id } }).catch(() => {});
  await Promise.all([enforced, relaxed, noKeycloak].map((a) => a?.close()));
  await prisma.$disconnect();
});

/** A fresh owner_confirmed mapping on the teacher's evidence. */
async function mapping(indicatorId) {
  const ev = await postEvidence(enforced, people.teacher.own, { category_id: categoryId, title: `e-${randomUUID()}` });
  assert.equal(ev.statusCode, 201, ev.body);
  const m = await postMapping(enforced, people.teacher.own, ev.json().id, indicatorId);
  assert.equal(m.statusCode, 201, m.body);
  return m.json();
}

test('the realm issues what the API expects: seip_uid, audience, acr pwd / mfa', { skip }, () => {
  const pwd = claimsOf(people.director.pwd);
  const mfa = claimsOf(people.director.mfa);
  assert.equal(pwd.seip_uid, people.director.user.id);
  assert.equal(pwd.aud, 'seip-api');
  assert.equal(pwd.acr, 'pwd');
  assert.equal(mfa.acr, 'mfa');
});

test('validate: a password-only token gets AUTH-006; the second-factor token validates', { skip }, async () => {
  const m = await mapping(indicatorIds[0]);
  for (const token of [people.director.pwd, people.director.own]) {
    const res = await actOnMapping(enforced, token, m.id, m.version, 'validate');
    assert.equal(res.statusCode, 403, res.body);
    assert.equal(res.json().code, 'AUTH-006');
    // FR-095: a refused step-up is an access denial with a known actor.
    const audit = await prisma.auditEvent.findFirst({ where: { requestId: res.json().request_id, action: 'access_denied' } });
    assert.equal(audit?.actorUserId, people.director.user.id);
    assert.equal(audit?.afterState.code, 'AUTH-006');
  }
  const ok = await actOnMapping(enforced, people.director.mfa, m.id, m.version, 'validate');
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.json().status, 'validated');
});

test('return needs step-up too; the owner\'s revoke does not', { skip }, async () => {
  const m = await mapping(indicatorIds[1]);
  const ret = await actOnMapping(enforced, people.director.pwd, m.id, m.version, 'return', 'ขอหลักฐานเพิ่ม');
  assert.equal(ret.json().code, 'AUTH-006');
  const revoke = await actOnMapping(enforced, people.teacher.pwd, m.id, m.version, 'revoke');
  assert.equal(revoke.statusCode, 200, revoke.body);
});

test('the role check comes first: a teacher is told PERM-001, not to step up', { skip }, async () => {
  const res = await enforced.inject({
    method: 'POST', url: '/api/v1/members', headers: bearer(people.teacher.pwd),
    payload: { email: `x-${randomUUID()}@x.io`, display_name: 'x', role: 'teacher' },
  });
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().code, 'PERM-001');
});

// One request per operation-level min_acr entry. The body is deliberately
// incomplete: with the second factor the request gets past the step-up check
// and fails on validation or lookup instead — anything but AUTH-006.
const OPERATION_LEVEL = {
  inviteMember: (token) => ({ method: 'POST', url: '/api/v1/members', headers: bearer(token), payload: {} }),
  importMembers: (token) => ({ method: 'POST', url: '/api/v1/members/import', headers: bearer(token), payload: {} }),
  endMembership: (token) => ({ method: 'POST', url: `/api/v1/members/${randomUUID()}/end`, headers: bearer(token) }),
  updatePersonnel: (token) => ({ method: 'PATCH', url: `/api/v1/personnel/${randomUUID()}`, headers: bearer(token), payload: { full_name: 'x' } }),
  issuePasswordReset: (token) => ({ method: 'POST', url: `/api/v1/members/${randomUUID()}/password-reset`, headers: bearer(token) }),
  createSchool: (token) => ({ method: 'POST', url: `/api/v1/areas/${area.id}/schools`, headers: bearer(token), payload: {} }),
  updateSchool: (token) => ({ method: 'PATCH', url: `/api/v1/schools/${school.id}`, headers: bearer(token), payload: {} }),
  appointSchoolAdmin: (token) => ({ method: 'POST', url: `/api/v1/schools/${school.id}/admins`, headers: bearer(token), payload: {} }),
  createAssignment: (token) => ({ method: 'POST', url: `/api/v1/rounds/${roundId}/assignments`, headers: bearer(token), payload: {} }),
};
const WHO = { inviteMember: 'admin', importMembers: 'admin', endMembership: 'admin', createAssignment: 'director',
  updatePersonnel: 'admin', issuePasswordReset: 'admin', createSchool: 'areaAdmin', updateSchool: 'areaAdmin', appointSchoolAdmin: 'areaAdmin' };

test('every operation-level min_acr operation is gated', { skip }, async () => {
  for (const [op, request] of Object.entries(OPERATION_LEVEL)) {
    const p = people[WHO[op]];
    const low = await enforced.inject(request(p.pwd));
    assert.equal(low.json().code, 'AUTH-006', `${op} with acr 1: ${low.body}`);
    const high = await enforced.inject(request(p.mfa));
    assert.notEqual(high.json().code, 'AUTH-006', `${op} with acr 2`);
  }
});

test('createExport: one\'s own portfolio needs no step-up; another person\'s does (other_person: 2)', { skip }, async () => {
  const create = (token, body) => enforced.inject({
    method: 'POST', url: '/api/v1/exports', headers: { ...bearer(token), 'idempotency-key': randomUUID() }, payload: body,
  });
  const own = await create(people.teacher.pwd, { kind: 'portfolio_portable' });
  assert.equal(own.statusCode, 202, own.body);
  const theirs = { kind: 'portfolio_portable', person_id: people.teacher.user.personId };
  const low = await create(people.admin.pwd, theirs);
  assert.equal(low.json().code, 'AUTH-006', low.body);
  const high = await create(people.admin.mfa, theirs);
  assert.equal(high.statusCode, 202, high.body);
  assert.ok(await prisma.auditEvent.findFirst({ where: { entityId: high.json().id, action: 'export_requested' } }));
});

test('coverage: every min_acr entry in permissions.yaml is exercised here or phase-gated', () => {
  const doc = yaml.load(readFileSync(new URL('../../../docs/contracts/permissions.yaml', import.meta.url), 'utf8'));
  const phaseGated = new Set([]); // routes/phase-gated.ts holds no min_acr operation now
  const actionLevel = new Set(['actOnMapping', 'createExport']); // validate / return, and other_person, tested above
  for (const op of Object.keys(doc.min_acr)) {
    assert.ok(op in OPERATION_LEVEL || actionLevel.has(op) || phaseGated.has(op), `min_acr ${op} has no step-up test`);
  }
});

test('not enforced (ENFORCE_MIN_ACR=false): a password-only token validates', { skip }, async () => {
  const m = await mapping(indicatorIds[2]);
  const res = await actOnMapping(relaxed, people.director.pwd, m.id, m.version, 'validate');
  assert.equal(res.statusCode, 200, res.body);
});

test('identity: unknown account, unlinked user, and a realm the API does not trust', { skip }, async () => {
  const me = (app, token) => app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(token) });

  assert.equal((await me(enforced, people.teacher.pwd)).statusCode, 200);

  const stranger = await createUser(randomUUID());
  kcUsers.push(stranger);
  const unknown = await me(enforced, await passwordToken(stranger));
  assert.equal(unknown.statusCode, 401);
  assert.equal(unknown.json().code, 'AUTH-003', 'a seip_uid with no account is not a user');

  const unlinked = await createUser(null, { linked: false });
  kcUsers.push(unlinked);
  const noLink = await me(enforced, await passwordToken(unlinked));
  assert.equal(noLink.json().code, 'AUTH-001');

  const untrusted = await me(noKeycloak, people.teacher.pwd);
  assert.equal(untrusted.statusCode, 401);
  assert.equal(untrusted.json().code, 'AUTH-001', 'without KEYCLOAK_ISSUER an RS256 token is just invalid');
});

test('mobile (ADR-0014 §5): a PKCE offline session works with the API, and revoking it ends it', { skip }, async () => {
  const me = (token) => enforced.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(token) });
  const first = await mobileSignIn(people.teacher.kc);
  assert.equal(claimsOf(first.refresh_token).typ, 'Offline', 'a per-device offline session');
  assert.equal((await me(first.access_token)).statusCode, 200);

  const renewed = await mobileRefresh(first.refresh_token);
  assert.ok(renewed, 'the app renews its 60 s access token');
  assert.equal((await me(renewed.access_token)).statusCode, 200);

  // Device revocation (P2 revokeDeviceSession) deletes the device's offline
  // session; the next renewal (at most 60 s away, the access token's lifetime)
  // is refused. Keycloak's admin "sign out everywhere" is NOT a substitute:
  // measured 2026-10-13, a renewed offline token sometimes survives it and
  // sometimes does not (it survived locally 4/4, was refused in CI).
  assert.ok(await revokeOfflineSessions(people.teacher.kc) >= 1);
  assert.equal(await mobileRefresh(renewed.refresh_token), null);
});

test('a second factor stops counting STEP_UP_MAX_AGE_S after sign-in, even though refresh keeps acr "mfa"', { skip }, async () => {
  const session = await mobileSignIn(people.director.kc, 'mfa');
  const refreshed = await mobileRefresh(session.refresh_token);
  const claims = claimsOf(refreshed.access_token);
  assert.equal(claims.acr, 'mfa', 'Keycloak carries acr through a refresh (why the API must not trust it forever)');
  assert.equal(claims.auth_time, claimsOf(session.access_token).auth_time, 'auth_time stays the sign-in time');
  // The aging itself is unit-tested (packages/auth oidc.test.ts) and covered for
  // web sessions in web-session.test.mjs; a 15-minute wait has no place here.
});
