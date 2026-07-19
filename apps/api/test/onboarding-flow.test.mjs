// CCR-014 / SEIP-BLOCK-001 — onboarding through the HTTP API.
//
// The point of this file is what it does NOT do: after the operator-side
// bootstrap (which is a CLI by design, decision 1), it creates a teacher who can
// log in using ONLY HTTP calls. Every other suite in this repo manufactures its
// identity rows through Prisma, which is exactly why a fully green test run
// coexisted with a system nobody could log into — see
// docs/qa/QUALITY-GATES.md § Coverage caveats.
//
// Prisma is used here for two things only: standing up the school/admin that the
// bootstrap CLI would create, and asserting stored state the API deliberately
// never returns (password hashes, invite token hashes).
process.env.NODE_ENV = 'test';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { hash as argonHash } from '@node-rs/argon2';
import { buildServer } from '../dist/server.js';
import { resetLoginRateLimiterState } from '../dist/lib/login-rate-limit.js';

const prisma = new PrismaClient();
let app;
let school;
let otherSchool;
let adminEmail;
let otherAdminEmail;
const adminPassword = 'bootstrap-admin-password-1234';

before(async () => {
  ({ app } = await buildServer());
  await app.ready();

  // Stand-in for `node scripts/ops/provision-school.mjs` + `bootstrap-admin.mjs`.
  school = await prisma.school.create({ data: { code: `onb-${randomUUID()}`, name: 'Onboarding School' } });
  otherSchool = await prisma.school.create({ data: { code: `onb-other-${randomUUID()}`, name: 'Other School' } });

  adminEmail = `onb-admin-${randomUUID()}@x.io`;
  const admin = await prisma.userAccount.create({
    data: { email: adminEmail, displayName: 'Admin', status: 'active', passwordHash: await argonHash(adminPassword) },
  });
  await prisma.schoolMembership.create({
    data: { userId: admin.id, schoolId: school.id, role: 'school_admin', membershipScope: 'school', effectiveFrom: new Date('2020-01-01'), status: 'active' },
  });

  // A second admin at a DIFFERENT school, for the tenancy tests.
  otherAdminEmail = `onb-other-admin-${randomUUID()}@x.io`;
  const otherAdmin = await prisma.userAccount.create({
    data: { email: otherAdminEmail, displayName: 'Other Admin', status: 'active', passwordHash: await argonHash(adminPassword) },
  });
  await prisma.schoolMembership.create({
    data: { userId: otherAdmin.id, schoolId: otherSchool.id, role: 'school_admin', membershipScope: 'school', effectiveFrom: new Date('2020-01-01'), status: 'active' },
  });
});

after(async () => {
  await app.close();
  await prisma.$disconnect();
});

async function login(email, password) {
  resetLoginRateLimiterState();
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  return res;
}

async function adminToken() {
  const res = await login(adminEmail, adminPassword);
  assert.equal(res.statusCode, 200);
  return res.json().access_token;
}

function auth(token) {
  return { authorization: `Bearer ${token}` };
}

// ── the acceptance criterion ──

test('a teacher can be onboarded and log in using only the HTTP API', async () => {
  const token = await adminToken();
  const teacherEmail = `onb-teacher-${randomUUID()}@x.io`;

  const invited = await app.inject({
    method: 'POST',
    url: '/api/v1/members',
    headers: auth(token),
    payload: {
      email: teacherEmail,
      display_name: 'ครูทดสอบ',
      role: 'teacher',
      personnel: {
        full_name: 'ครูทดสอบ ระบบ',
        position_role: 'teacher',
        rank_level_code: 'apply_adapt',
      },
    },
  });
  assert.equal(invited.statusCode, 201, invited.body);
  const result = invited.json();
  assert.ok(result.invite_token, 'a brand new account must receive an invite token');
  assert.equal(result.member.user_status, 'invited');
  assert.equal(result.member.personnel.full_name, 'ครูทดสอบ ระบบ');

  // SEC-AUTH-3: an invited account cannot authenticate yet.
  const tooEarly = await login(teacherEmail, 'whatever-password-here');
  assert.equal(tooEarly.statusCode, 401, 'an invited account must not be able to log in');

  const accepted = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/accept-invite',
    payload: { invite_token: result.invite_token, password: 'teacher-chosen-password-1234' },
  });
  assert.equal(accepted.statusCode, 204, accepted.body);

  const loggedIn = await login(teacherEmail, 'teacher-chosen-password-1234');
  assert.equal(loggedIn.statusCode, 200, 'the teacher must be able to log in with the password they chose');

  const me = await app.inject({
    method: 'GET',
    url: '/api/v1/auth/me',
    headers: auth(loggedIn.json().access_token),
  });
  assert.equal(me.statusCode, 200);
  const identity = me.json();
  assert.equal(identity.email, teacherEmail);
  assert.equal(identity.personnel.rank_level_code, 'apply_adapt');
  assert.equal(identity.memberships[0].role, 'teacher');
});

test('the invite token is single-use and its hash is cleared on accept', async () => {
  const token = await adminToken();
  const email = `onb-once-${randomUUID()}@x.io`;

  const invited = await app.inject({
    method: 'POST', url: '/api/v1/members', headers: auth(token),
    payload: { email, display_name: 'Once', role: 'evaluator' },
  });
  const raw = invited.json().invite_token;

  const first = await app.inject({
    method: 'POST', url: '/api/v1/auth/accept-invite',
    payload: { invite_token: raw, password: 'first-acceptance-password' },
  });
  assert.equal(first.statusCode, 204);

  const stored = await prisma.userAccount.findUnique({
    where: { email },
    select: { inviteTokenHash: true, inviteExpiresAt: true, status: true, passwordHash: true },
  });
  assert.equal(stored.inviteTokenHash, null, 'the token hash must be cleared by accept');
  assert.equal(stored.inviteExpiresAt, null);
  assert.equal(stored.status, 'active');
  assert.ok(stored.passwordHash?.startsWith('$argon2id$'), 'the password must be stored as an argon2id hash');

  const replay = await app.inject({
    method: 'POST', url: '/api/v1/auth/accept-invite',
    payload: { invite_token: raw, password: 'attacker-chosen-password' },
  });
  assert.equal(replay.statusCode, 401, 'a consumed token must not work twice');
  assert.equal(replay.json().code, 'AUTH-005');

  // The original password must still work — a failed replay must not have
  // changed anything.
  const stillWorks = await login(email, 'first-acceptance-password');
  assert.equal(stillWorks.statusCode, 200);
});

test('unknown, malformed and expired tokens are indistinguishable (AUTH-005, no oracle)', async () => {
  const token = await adminToken();
  const email = `onb-exp-${randomUUID()}@x.io`;

  const invited = await app.inject({
    method: 'POST', url: '/api/v1/members', headers: auth(token),
    payload: { email, display_name: 'Expiring', role: 'teacher' },
  });
  const raw = invited.json().invite_token;

  // Expire it behind the API's back.
  await prisma.userAccount.update({
    where: { email },
    data: { inviteExpiresAt: new Date(Date.now() - 1000) },
  });

  const expired = await app.inject({
    method: 'POST', url: '/api/v1/auth/accept-invite',
    payload: { invite_token: raw, password: 'a-perfectly-fine-password' },
  });
  const unknown = await app.inject({
    method: 'POST', url: '/api/v1/auth/accept-invite',
    payload: { invite_token: 'not-a-real-token-at-all', password: 'a-perfectly-fine-password' },
  });

  assert.equal(expired.statusCode, unknown.statusCode);
  assert.equal(expired.json().code, unknown.json().code);
  assert.equal(expired.json().code, 'AUTH-005');
  assert.equal(expired.json().message, unknown.json().message, 'messages must match too, not just codes');
});

test('a password below the policy minimum is rejected before anything is stored', async () => {
  const token = await adminToken();
  const email = `onb-weak-${randomUUID()}@x.io`;
  const invited = await app.inject({
    method: 'POST', url: '/api/v1/members', headers: auth(token),
    payload: { email, display_name: 'Weak', role: 'teacher' },
  });
  const raw = invited.json().invite_token;

  const rejected = await app.inject({
    method: 'POST', url: '/api/v1/auth/accept-invite',
    payload: { invite_token: raw, password: 'short' },
  });
  assert.equal(rejected.statusCode, 400);

  const stored = await prisma.userAccount.findUnique({ where: { email }, select: { passwordHash: true, inviteTokenHash: true } });
  assert.equal(stored.passwordHash, null, 'a rejected password must not be stored');
  assert.ok(stored.inviteTokenHash, 'the invite must remain usable after a rejected attempt');
});

// ── the account-takeover vector this design exists to close ──

test('inviting an email that already has a password does NOT issue a token', async () => {
  // Without this rule, any school_admin could "invite" any email in the system
  // and receive a credential that resets that account's password.
  const token = await adminToken();

  const victimEmail = `onb-victim-${randomUUID()}@x.io`;
  const victim = await prisma.userAccount.create({
    data: { email: victimEmail, displayName: 'Victim', status: 'active', passwordHash: await argonHash('victim-original-password') },
  });
  const beforeHash = victim.passwordHash;

  const res = await app.inject({
    method: 'POST', url: '/api/v1/members', headers: auth(token),
    payload: { email: victimEmail, display_name: 'Victim', role: 'evaluator' },
  });
  assert.equal(res.statusCode, 201, 'the membership grant itself is legitimate and should succeed');
  assert.equal(res.json().invite_token, null, 'no credential may be issued for an account that already has one');
  assert.equal(res.json().invite_expires_at, null);

  const after = await prisma.userAccount.findUnique({ where: { email: victimEmail }, select: { passwordHash: true, inviteTokenHash: true } });
  assert.equal(after.passwordHash, beforeHash, 'the existing password must be untouched');
  assert.equal(after.inviteTokenHash, null, 'no invite token may be planted on an account that has a password');

  // And the victim's original password still works.
  assert.equal((await login(victimEmail, 'victim-original-password')).statusCode, 200);
});

// ── tenancy ──

test('the school comes from the caller — a body school_id cannot redirect the invite', async () => {
  const token = await adminToken();
  const email = `onb-tenancy-${randomUUID()}@x.io`;

  const res = await app.inject({
    method: 'POST', url: '/api/v1/members', headers: auth(token),
    // school_id is not in MemberInvite at all; if it were ever honoured this
    // membership would land in otherSchool.
    payload: { email, display_name: 'Tenancy', role: 'teacher', school_id: otherSchool.id },
  });
  assert.equal(res.statusCode, 201);
  assert.equal(res.json().member.membership_id.length, 36);

  const membership = await prisma.schoolMembership.findFirst({
    where: { user: { email } },
    select: { schoolId: true },
  });
  assert.equal(membership.schoolId, school.id, 'the membership must land in the CALLER\'s school');
});

test('ending a membership from another school returns RES-001, not a confirmation', async () => {
  const token = await adminToken();
  const email = `onb-cross-${randomUUID()}@x.io`;
  const invited = await app.inject({
    method: 'POST', url: '/api/v1/members', headers: auth(token),
    payload: { email, display_name: 'Cross', role: 'teacher' },
  });
  const membershipId = invited.json().member.membership_id;

  const otherRes = await login(otherAdminEmail, adminPassword);
  const otherToken = otherRes.json().access_token;

  const denied = await app.inject({
    method: 'POST', url: `/api/v1/members/${membershipId}/end`, headers: auth(otherToken),
  });
  assert.equal(denied.statusCode, 404, 'cross-school must be indistinguishable from not-found (SEC-TEN-2)');
  assert.equal(denied.json().code, 'RES-001');

  const untouched = await prisma.schoolMembership.findUnique({ where: { id: membershipId }, select: { effectiveTo: true } });
  assert.equal(untouched.effectiveTo, null, 'the membership must not have been ended');
});

test('a teacher cannot invite anyone (PERM-001)', async () => {
  const token = await adminToken();
  const email = `onb-noperm-${randomUUID()}@x.io`;
  const invited = await app.inject({
    method: 'POST', url: '/api/v1/members', headers: auth(token),
    payload: { email, display_name: 'NoPerm', role: 'teacher' },
  });
  await app.inject({
    method: 'POST', url: '/api/v1/auth/accept-invite',
    payload: { invite_token: invited.json().invite_token, password: 'teacher-password-here-1' },
  });
  const teacherToken = (await login(email, 'teacher-password-here-1')).json().access_token;

  const denied = await app.inject({
    method: 'POST', url: '/api/v1/members', headers: auth(teacherToken),
    payload: { email: `x-${randomUUID()}@x.io`, display_name: 'X', role: 'teacher' },
  });
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.json().code, 'PERM-001');

  const listDenied = await app.inject({ method: 'GET', url: '/api/v1/members', headers: auth(teacherToken) });
  assert.equal(listDenied.statusCode, 403, 'listMembers is school_admin-only');
});

// ── validation ──

test('a rank code from the wrong framework family is VAL-003, not a 500', async () => {
  const token = await adminToken();
  const res = await app.inject({
    method: 'POST', url: '/api/v1/members', headers: auth(token),
    payload: {
      email: `onb-rank-${randomUUID()}@x.io`,
      display_name: 'Mismatch',
      role: 'teacher',
      personnel: {
        full_name: 'Mismatch',
        position_role: 'administrator',
        rank_level_code: 'apply_adapt', // a ว9 teacher rank on a ว10 profile
      },
    },
  });
  assert.equal(res.statusCode, 422);
  assert.equal(res.json().code, 'VAL-003');
});

test('re-inviting a current member is RES-002, not a duplicate membership', async () => {
  const token = await adminToken();
  const email = `onb-dupe-${randomUUID()}@x.io`;
  const payload = { email, display_name: 'Dupe', role: 'teacher' };

  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/members', headers: auth(token), payload })).statusCode, 201);

  const second = await app.inject({ method: 'POST', url: '/api/v1/members', headers: auth(token), payload });
  assert.equal(second.statusCode, 409);
  assert.equal(second.json().code, 'RES-003');

  const count = await prisma.schoolMembership.count({ where: { user: { email }, schoolId: school.id } });
  assert.equal(count, 1, 'the overlap rule is application-enforced (MySQL has no partial unique index) — it must hold');
});

test('email is normalised to lowercase so the unique constraint means something', async () => {
  const token = await adminToken();
  const upper = `ONB-CASE-${randomUUID().toUpperCase()}@X.IO`;

  const res = await app.inject({
    method: 'POST', url: '/api/v1/members', headers: auth(token),
    payload: { email: upper, display_name: 'Case', role: 'teacher' },
  });
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(res.json().member.email, upper.toLowerCase());

  // Re-inviting with different casing must collide, not create a second account.
  const again = await app.inject({
    method: 'POST', url: '/api/v1/members', headers: auth(token),
    payload: { email: upper.toLowerCase(), display_name: 'Case', role: 'teacher' },
  });
  assert.equal(again.statusCode, 409);
});

test('area_admin cannot be granted as a school membership (scope CHECK would 500)', async () => {
  const token = await adminToken();
  const res = await app.inject({
    method: 'POST', url: '/api/v1/members', headers: auth(token),
    payload: { email: `onb-area-${randomUUID()}@x.io`, display_name: 'Area', role: 'area_admin' },
  });
  assert.equal(res.statusCode, 422);
  assert.equal(res.json().code, 'VAL-002');
});

// ── offboarding ──

test('endMembership revokes access and is idempotent', async () => {
  const token = await adminToken();
  const email = `onb-end-${randomUUID()}@x.io`;
  const invited = await app.inject({
    method: 'POST', url: '/api/v1/members', headers: auth(token),
    payload: { email, display_name: 'Leaver', role: 'teacher' },
  });
  const membershipId = invited.json().member.membership_id;
  await app.inject({
    method: 'POST', url: '/api/v1/auth/accept-invite',
    payload: { invite_token: invited.json().invite_token, password: 'leaver-password-1234' },
  });

  const ended = await app.inject({ method: 'POST', url: `/api/v1/members/${membershipId}/end`, headers: auth(token) });
  assert.equal(ended.statusCode, 200);
  assert.ok(ended.json().effective_to, 'effective_to must be set');

  const firstDate = ended.json().effective_to;
  const again = await app.inject({ method: 'POST', url: `/api/v1/members/${membershipId}/end`, headers: auth(token) });
  assert.equal(again.statusCode, 200);
  assert.equal(again.json().effective_to, firstDate, 'a second end must not move the date');

  const listed = await app.inject({ method: 'GET', url: '/api/v1/members', headers: auth(token) });
  assert.ok(!listed.json().some((m) => m.membership_id === membershipId), 'an ended membership must drop out of the current list');
});

test('an admin cannot end their own last school_admin membership', async () => {
  const token = await adminToken();
  const members = (await app.inject({ method: 'GET', url: '/api/v1/members', headers: auth(token) })).json();
  const mine = members.find((m) => m.email === adminEmail && m.role === 'school_admin');

  const res = await app.inject({ method: 'POST', url: `/api/v1/members/${mine.membership_id}/end`, headers: auth(token) });
  assert.equal(res.statusCode, 422, 'locking the school out of its own administration must be refused');
  assert.equal(res.json().code, 'VAL-002');
});

test('accepting invites does not consume the login rate-limit budget', async () => {
  // A Thai school reaches the API from one NAT'd public IP. If acceptInvite
  // shared the login bucket, an admin onboarding a batch of teachers would
  // throttle logins for the whole staff. Found exactly that way: the e2e suite
  // began returning AUTH-004 for every spec once the onboarding spec ran too.
  const { LoginRateLimiter, installLoginRateLimiterForTests, getInviteRateLimiter } =
    await import('../dist/lib/login-rate-limit.js');

  const tiny = new LoginRateLimiter({ windowMs: 60_000, maxPerIp: 3, maxPerEmail: 3 });
  const restore = installLoginRateLimiterForTests(tiny);
  getInviteRateLimiter().reset();
  try {
    // Burn well past the login budget on accept-invite attempts.
    for (let i = 0; i < 10; i++) {
      const res = await app.inject({
        method: 'POST', url: '/api/v1/auth/accept-invite',
        payload: { invite_token: `nope-${i}`, password: 'a-perfectly-fine-password' },
      });
      assert.equal(res.json().code, 'AUTH-005', 'these should fail on the token, not the limiter');
    }

    // Login must still be available — its bucket was never touched.
    const res = await app.inject({
      method: 'POST', url: '/api/v1/auth/login',
      payload: { email: adminEmail, password: adminPassword },
    });
    assert.equal(res.statusCode, 200, 'onboarding traffic must not lock out logins');
  } finally {
    restore();
  }
});

// ── listPersonnel: the operation that retires the raw UUIDs ──

test('listPersonnel resolves the UUIDs that four screens used to render raw', async () => {
  const token = await adminToken();
  const email = `onb-list-${randomUUID()}@x.io`;
  await app.inject({
    method: 'POST', url: '/api/v1/members', headers: auth(token),
    payload: {
      email, display_name: 'Listed', role: 'teacher',
      personnel: { full_name: 'ครูที่มีชื่อ', position_role: 'teacher', rank_level_code: 'apply_adapt', employee_code: 'EMP-42' },
    },
  });

  const res = await app.inject({ method: 'GET', url: '/api/v1/personnel', headers: auth(token) });
  assert.equal(res.statusCode, 200);
  const rows = res.json();
  const found = rows.find((p) => p.full_name === 'ครูที่มีชื่อ');
  assert.ok(found, 'the invited personnel must be listable');
  assert.equal(found.employee_code, 'EMP-42');
  assert.equal(found.position_role, 'teacher');

  // Every row must be from the caller's school only.
  const ids = rows.map((r) => r.id);
  const foreign = await prisma.personnelProfile.count({ where: { id: { in: ids }, schoolId: { not: school.id } } });
  assert.equal(foreign, 0, 'listPersonnel must not leak personnel from another school');
});

test('listPersonnel filters by framework family', async () => {
  const token = await adminToken();
  const res = await app.inject({ method: 'GET', url: '/api/v1/personnel?position_role=administrator', headers: auth(token) });
  assert.equal(res.statusCode, 200);
  assert.ok(res.json().every((p) => p.position_role === 'administrator'));
});
