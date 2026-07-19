// CCR-015 / SEIP-BLOCK-002 — performance agreements and ประเด็นท้าทาย.
//
// Two defects are under test here. The blocking one: without an agreement no
// score could be submitted at all (no agreement -> no workload declaration ->
// SCORE-004). The quieter one: the committee scored indicators C.1/C.2.1/C.2.2 —
// 40% of a teacher's result — without ever being shown the method and targets
// those indicators rate. The last test in this file is the one that matters for
// the second: it asserts an evaluator can actually read the challenge text.
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
let school, otherSchool, frameworkId, cycleId;
let teacherPersonnelId, otherTeacherPersonnelId;
let teacherToken, directorToken, otherTeacherToken, evaluatorToken, adminToken;
let directorUserId, evaluatorUserId;

const PASSWORD = 'agreement-test-password-1234';

function auth(t) { return { authorization: `Bearer ${t}` }; }

async function makeUser({ role, withPersonnel, schoolId }) {
  const email = `agr-${role}-${randomUUID()}@x.io`;
  const user = await prisma.userAccount.create({
    data: { email, displayName: role, status: 'active', passwordHash: await argonHash(PASSWORD) },
  });
  await prisma.schoolMembership.create({
    data: { userId: user.id, schoolId, role, membershipScope: 'school', effectiveFrom: new Date('2020-01-01'), status: 'active' },
  });
  let personnelId = null;
  if (withPersonnel) {
    const p = await prisma.personnelProfile.create({
      data: { schoolId, userId: user.id, fullName: `${role} name`, positionRole: 'teacher', rankLevelCode: 'apply_adapt', status: 'active' },
    });
    personnelId = p.id;
  }
  resetLoginRateLimiterState();
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: PASSWORD } });
  assert.equal(login.statusCode, 200, login.body);
  return { userId: user.id, personnelId, token: login.json().access_token };
}

before(async () => {
  ({ app } = await buildServer());
  await app.ready();

  school = await prisma.school.create({ data: { code: `agr-${randomUUID()}`, name: 'Agreement School' } });
  otherSchool = await prisma.school.create({ data: { code: `agr-o-${randomUUID()}`, name: 'Other School' } });

  const fw = await prisma.frameworkVersion.findFirst({ where: { code: 'v9-2564-teacher' }, select: { id: true } });
  assert.ok(fw, 'taxonomy seed required — run npm run db:seed');
  frameworkId = fw.id;

  const teacher = await makeUser({ role: 'teacher', withPersonnel: true, schoolId: school.id });
  teacherPersonnelId = teacher.personnelId;
  teacherToken = teacher.token;

  const other = await makeUser({ role: 'teacher', withPersonnel: true, schoolId: school.id });
  otherTeacherPersonnelId = other.personnelId;
  otherTeacherToken = other.token;

  const director = await makeUser({ role: 'director', withPersonnel: false, schoolId: school.id });
  directorToken = director.token;
  directorUserId = director.userId;

  const evaluator = await makeUser({ role: 'evaluator', withPersonnel: false, schoolId: school.id });
  evaluatorToken = evaluator.token;
  evaluatorUserId = evaluator.userId;

  // school_admin is the ONLY role that may file on someone else's behalf:
  // permissions.yaml gives createAgreement `own` to teacher/deputy/director and
  // `school` to school_admin. A director filing for a teacher is PERM-001 by
  // design — under ว9/ว10 the evaluatee writes their own ข้อตกลง, and the
  // director's job is to acknowledge it, not to author it.
  adminToken = (await makeUser({ role: 'school_admin', withPersonnel: false, schoolId: school.id })).token;

  const cycle = await app.inject({
    method: 'POST', url: '/api/v1/cycles', headers: auth(directorToken),
    payload: { framework_version_id: frameworkId, fiscal_year: 3010, evaluation_kind: 'pa', title: 'agreement cycle', starts_on: '2026-01-01', ends_on: '2026-12-31' },
  });
  assert.equal(cycle.statusCode, 201, cycle.body);
  cycleId = cycle.json().id;
});

after(async () => {
  await app.close();
  await prisma.$disconnect();
});

const CHALLENGE = {
  title: 'ยกระดับผลสัมฤทธิ์การอ่าน',
  method_plan: 'ชุดกิจกรรมการอ่านเชิงรุกสัปดาห์ละ 2 คาบ',
  quantitative_target: 'นักเรียนร้อยละ 80 คะแนนเพิ่มขึ้น 10%',
  qualitative_target: 'นักเรียนเลือกหนังสืออ่านเองได้',
};

async function createAgreement(token, personnelId, { challenge = CHALLENGE, cycle = cycleId } = {}) {
  return app.inject({
    method: 'POST', url: '/api/v1/agreements', headers: auth(token),
    payload: { cycle_id: cycle, personnel_id: personnelId, ...(challenge ? { challenge } : {}) },
  });
}

// ── lifecycle ──

test('a teacher files their own agreement with a challenge, submits it, and the director acknowledges', async () => {
  const created = await createAgreement(teacherToken, teacherPersonnelId);
  assert.equal(created.statusCode, 201, created.body);
  const agreement = created.json();
  assert.equal(agreement.status, 'draft');
  // Derived, not supplied: a ว9 teacher files PA1/ส.
  assert.equal(agreement.form_variant, 'PA1_s');
  assert.equal(agreement.challenge.title, CHALLENGE.title);
  assert.equal(agreement.challenge.method_plan, CHALLENGE.method_plan);

  const submitted = await app.inject({
    method: 'POST', url: `/api/v1/agreements/${agreement.id}/submit`, headers: auth(teacherToken),
  });
  assert.equal(submitted.statusCode, 200, submitted.body);
  assert.equal(submitted.json().status, 'submitted');
  assert.ok(submitted.json().submitted_at, 'submitted_at must be stamped');

  const acked = await app.inject({
    method: 'POST', url: `/api/v1/agreements/${agreement.id}/acknowledge`, headers: auth(directorToken),
  });
  assert.equal(acked.statusCode, 200, acked.body);
  assert.equal(acked.json().status, 'acknowledged');
});

test('submitting freezes the content — a submitted agreement cannot be edited', async () => {
  const created = await createAgreement(otherTeacherToken, otherTeacherPersonnelId);
  const id = created.json().id;

  // Editable while draft.
  const edited = await app.inject({
    method: 'PATCH', url: `/api/v1/agreements/${id}`, headers: auth(otherTeacherToken),
    payload: { challenge: { ...CHALLENGE, title: 'แก้ไขระหว่างร่าง' } },
  });
  assert.equal(edited.statusCode, 200);
  assert.equal(edited.json().challenge.title, 'แก้ไขระหว่างร่าง');

  await app.inject({ method: 'POST', url: `/api/v1/agreements/${id}/submit`, headers: auth(otherTeacherToken) });

  // Frozen after. Otherwise an evaluatee could rewrite the targets they are
  // about to be scored against.
  const afterSubmit = await app.inject({
    method: 'PATCH', url: `/api/v1/agreements/${id}`, headers: auth(otherTeacherToken),
    payload: { challenge: { ...CHALLENGE, title: 'แอบแก้หลังส่ง' } },
  });
  assert.equal(afterSubmit.statusCode, 422);
  assert.equal(afterSubmit.json().code, 'AGR-002');

  const reread = await app.inject({ method: 'GET', url: `/api/v1/agreements/${id}`, headers: auth(otherTeacherToken) });
  assert.equal(reread.json().challenge.title, 'แก้ไขระหว่างร่าง', 'the frozen content must be unchanged');
});

test('an agreement with no ประเด็นท้าทาย cannot be submitted', async () => {
  // Submitting one would hand the committee an empty 40% to score — the exact
  // defect this contract version exists to close.
  const u = await makeUser({ role: 'teacher', withPersonnel: true, schoolId: school.id });
  const created = await createAgreement(u.token, u.personnelId, { challenge: null });
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(created.json().challenge, null);

  const submitted = await app.inject({
    method: 'POST', url: `/api/v1/agreements/${created.json().id}/submit`, headers: auth(u.token),
  });
  assert.equal(submitted.statusCode, 422);
  assert.equal(submitted.json().code, 'AGR-002');
});

test('one agreement per (cycle, personnel) — a second is AGR-001', async () => {
  // Filed by school_admin, the one role with a `school` grant — this also proves
  // the on-behalf path works, not just the self-service one.
  const p = (await makeUser({ role: 'teacher', withPersonnel: true, schoolId: school.id })).personnelId;
  const first = await createAgreement(adminToken, p);
  assert.equal(first.statusCode, 201, first.body);
  const second = await createAgreement(adminToken, p);
  assert.equal(second.statusCode, 409);
  assert.equal(second.json().code, 'AGR-001');

  const count = await prisma.performanceAgreement.count({ where: { cycleId, personnelId: p } });
  assert.equal(count, 1);
});

test('a director cannot file an agreement on a teacher behalf — only school_admin may', async () => {
  // The evaluatee writes their own ข้อตกลง; the director acknowledges it. Making
  // this explicit because it is the asymmetry that broke three tests while
  // writing this file, and it is deliberate rather than an oversight.
  const p = (await makeUser({ role: 'teacher', withPersonnel: true, schoolId: school.id })).personnelId;
  const denied = await createAgreement(directorToken, p);
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.json().code, 'PERM-001');
});

// ── the governance rules ──

test('an evaluatee cannot acknowledge their own agreement', async () => {
  // A director is an evaluatee too under ว10, so this cannot be expressed in the
  // permissions matrix — it is a route rule, and it is the difference between a
  // signature and a self-signature.
  const self = await makeUser({ role: 'director', withPersonnel: true, schoolId: school.id });
  const created = await createAgreement(self.token, self.personnelId);
  await app.inject({ method: 'POST', url: `/api/v1/agreements/${created.json().id}/submit`, headers: auth(self.token) });

  const denied = await app.inject({
    method: 'POST', url: `/api/v1/agreements/${created.json().id}/acknowledge`, headers: auth(self.token),
  });
  assert.equal(denied.statusCode, 422);
  assert.equal(denied.json().code, 'AGR-002');

  // Another director can.
  const ok = await app.inject({
    method: 'POST', url: `/api/v1/agreements/${created.json().id}/acknowledge`, headers: auth(directorToken),
  });
  assert.equal(ok.statusCode, 200);
});

test('a teacher cannot file an agreement for somebody else', async () => {
  const denied = await createAgreement(teacherToken, otherTeacherPersonnelId);
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.json().code, 'PERM-001');
});

test('a teacher sees only their own agreements in the list', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/v1/agreements', headers: auth(teacherToken) });
  assert.equal(res.statusCode, 200);
  assert.ok(res.json().length > 0);
  assert.ok(
    res.json().every((a) => a.personnel_id === teacherPersonnelId),
    "own-scoped list must not leak colleagues' agreements",
  );
});

test('cross-school agreement access returns RES-001, not a confirmation', async () => {
  const outsider = await makeUser({ role: 'director', withPersonnel: false, schoolId: otherSchool.id });
  const mine = await app.inject({ method: 'GET', url: '/api/v1/agreements', headers: auth(teacherToken) });
  const someId = mine.json()[0].id;

  const denied = await app.inject({
    method: 'GET', url: `/api/v1/agreements/${someId}`, headers: auth(outsider.token),
  });
  assert.equal(denied.statusCode, 404);
  assert.equal(denied.json().code, 'RES-001');
});

test('a teacher filing against a ว10 cycle is VAL-003, not a wrong-rubric score later', async () => {
  const adminFw = await prisma.frameworkVersion.findFirst({ where: { code: 'v10-2564-administrator' }, select: { id: true } });
  const adminCycle = await app.inject({
    method: 'POST', url: '/api/v1/cycles', headers: auth(directorToken),
    payload: { framework_version_id: adminFw.id, fiscal_year: 3011, evaluation_kind: 'pa', title: 'admin cycle', starts_on: '2026-01-01', ends_on: '2026-12-31' },
  });
  const p = (await makeUser({ role: 'teacher', withPersonnel: true, schoolId: school.id })).personnelId;

  const res = await createAgreement(adminToken, p, { cycle: adminCycle.json().id });
  assert.equal(res.statusCode, 422);
  assert.equal(res.json().code, 'VAL-003');
});

// ── the reason this contract version exists ──

test('the committee can read the challenge they are scoring (AssignmentDetail.challenge)', async () => {
  const evaluatee = await makeUser({ role: 'teacher', withPersonnel: true, schoolId: school.id });
  const created = await createAgreement(evaluatee.token, evaluatee.personnelId);
  await app.inject({ method: 'POST', url: `/api/v1/agreements/${created.json().id}/submit`, headers: auth(evaluatee.token) });

  const round = await app.inject({
    method: 'POST', url: `/api/v1/cycles/${cycleId}/rounds`, headers: auth(directorToken),
    payload: { round_number: 1, purpose: 'challenge visibility', period_start: '2026-02-01', period_end: '2026-11-30' },
  });
  assert.equal(round.statusCode, 201, round.body);

  const eval2 = await makeUser({ role: 'evaluator', withPersonnel: false, schoolId: school.id });
  const assignment = await app.inject({
    method: 'POST', url: `/api/v1/rounds/${round.json().id}/assignments`, headers: auth(directorToken),
    payload: {
      // NOTE: no agreement_id — removed in contract 3.0.0, derived server-side.
      evaluatee_personnel_id: evaluatee.personnelId,
      committee: [
        { evaluator_user_id: evaluatorUserId, committee_role: 'chair', seat_number: 1 },
        { evaluator_user_id: directorUserId, committee_role: 'member', seat_number: 2 },
        { evaluator_user_id: eval2.userId, committee_role: 'member', seat_number: 3 },
      ],
    },
  });
  assert.equal(assignment.statusCode, 201, assignment.body);
  assert.ok(assignment.json().agreement_id, 'the server must have derived the agreement from (cycle, evaluatee)');
  assert.equal(assignment.json().agreement_id, created.json().id, 'and it must be the RIGHT agreement');

  const detail = await app.inject({
    method: 'GET', url: `/api/v1/assignments/${assignment.json().id}`, headers: auth(evaluatorToken),
  });
  assert.equal(detail.statusCode, 200, detail.body);
  const challenge = detail.json().challenge;
  assert.ok(challenge, 'an evaluator must be able to see the challenge — scoring 40% blind is the defect CCR-015 closes');
  assert.equal(challenge.title, CHALLENGE.title);
  assert.equal(challenge.method_plan, CHALLENGE.method_plan, 'C.1 rates this text');
  assert.equal(challenge.quantitative_target, CHALLENGE.quantitative_target, 'C.2.1 rates against this target');
  assert.equal(challenge.qualitative_target, CHALLENGE.qualitative_target, 'C.2.2 rates against this target');
});

test('an assignment for someone with no agreement still creates, and reports a null challenge', async () => {
  // Assignments may legitimately precede the PA1. The UI must be able to tell
  // "no challenge filed" from "challenge left blank", so this is null rather
  // than an empty object.
  const noAgreement = await makeUser({ role: 'teacher', withPersonnel: true, schoolId: school.id });
  const round = await app.inject({
    method: 'POST', url: `/api/v1/cycles/${cycleId}/rounds`, headers: auth(directorToken),
    payload: { round_number: 2, purpose: 'no agreement', period_start: '2026-02-01', period_end: '2026-11-30' },
  });
  const eval2 = await makeUser({ role: 'evaluator', withPersonnel: false, schoolId: school.id });
  const assignment = await app.inject({
    method: 'POST', url: `/api/v1/rounds/${round.json().id}/assignments`, headers: auth(directorToken),
    payload: {
      evaluatee_personnel_id: noAgreement.personnelId,
      committee: [
        { evaluator_user_id: evaluatorUserId, committee_role: 'chair', seat_number: 1 },
        { evaluator_user_id: directorUserId, committee_role: 'member', seat_number: 2 },
        { evaluator_user_id: eval2.userId, committee_role: 'member', seat_number: 3 },
      ],
    },
  });
  assert.equal(assignment.statusCode, 201, assignment.body);
  assert.equal(assignment.json().agreement_id, null);

  const detail = await app.inject({
    method: 'GET', url: `/api/v1/assignments/${assignment.json().id}`, headers: auth(directorToken),
  });
  assert.equal(detail.json().challenge, null);
});
