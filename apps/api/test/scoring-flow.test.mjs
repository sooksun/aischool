// End-to-end cycles + committee-scoring test (SEIP-API-002). Builds its own small
// synthetic framework (2 standard + 1 challenge + 1 workload-gate indicator) rather
// than the real seeded ว9/ว10 data, so the expected part1/part2/total percentages
// are exactly predictable — mirrors evidence-flow.test.mjs's fixture style.
process.env.NODE_ENV = 'test';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { hash as argonHash } from '@node-rs/argon2';
import { buildServer } from '../dist/server.js';

const prisma = new PrismaClient();
let app;
let school, frameworkId;
let standardIndicatorAId, standardIndicatorBId, challengeIndicatorId, workloadIndicatorId;
let director, evaluator2, evaluator3, teacherEvaluatee;
let directorToken, evaluator2Token, evaluator3Token, teacherToken;
let teacherPersonnelId;

before(async () => {
  ({ app } = await buildServer());
  await app.ready();

  school = await prisma.school.create({ data: { code: `score-${randomUUID()}`, name: 'Scoring School' } });
  await prisma.rankLevel.upsert({
    where: { code: 'score_kru' }, create: { code: 'score_kru', roleFamily: 'teacher', labelTh: 'ครู', sortOrder: 2 }, update: {},
  });

  const fw = await prisma.frameworkVersion.create({
    data: { code: `score-fw-${randomUUID()}`, roleFamily: 'teacher', legalRef: 'x', revisionYear: 9999, status: 'draft', effectiveFrom: new Date() },
  });
  frameworkId = fw.id;
  await prisma.scoreWeight.createMany({ data: [
    { frameworkVersionId: fw.id, weightKey: 'part1_total', weightValue: 60 },
    { frameworkVersionId: fw.id, weightKey: 'part2_total', weightValue: 40 },
  ] });
  const standardDomain = await prisma.evaluationDomain.create({ data: { frameworkVersionId: fw.id, code: `SD-${randomUUID()}`, nameTh: 'std', sortOrder: 1, part: 'standards' } });
  const challengeDomain = await prisma.evaluationDomain.create({ data: { frameworkVersionId: fw.id, code: `CD-${randomUUID()}`, nameTh: 'chg', sortOrder: 2, part: 'challenge' } });

  const a = await prisma.indicator.create({ data: { domainId: standardDomain.id, frameworkVersionId: fw.id, code: `S-A-${randomUUID()}`, nameTh: 'a', sortOrder: 1, isScored: true, indicatorKind: 'standard' } });
  const b = await prisma.indicator.create({ data: { domainId: standardDomain.id, frameworkVersionId: fw.id, code: `S-B-${randomUUID()}`, nameTh: 'b', sortOrder: 2, isScored: true, indicatorKind: 'standard' } });
  const c = await prisma.indicator.create({ data: { domainId: challengeDomain.id, frameworkVersionId: fw.id, code: `C-${randomUUID()}`, nameTh: 'c', sortOrder: 1, isScored: true, indicatorKind: 'challenge', maxPoints: 40 } });
  const w = await prisma.indicator.create({ data: { domainId: standardDomain.id, frameworkVersionId: fw.id, code: `W-${randomUUID()}`, nameTh: 'w', sortOrder: 0, isScored: false, indicatorKind: 'workload_gate' } });
  standardIndicatorAId = a.id; standardIndicatorBId = b.id; challengeIndicatorId = c.id; workloadIndicatorId = w.id;

  async function makeUser(label, role) {
    const password = `${label}-password-1234`;
    const user = await prisma.userAccount.create({
      data: { email: `score-${label}-${randomUUID()}@x.io`, displayName: label, status: 'active', passwordHash: await argonHash(password) },
    });
    await prisma.schoolMembership.create({
      data: { userId: user.id, schoolId: school.id, role, membershipScope: 'school', effectiveFrom: new Date('2020-01-01'), status: 'active' },
    });
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: user.email, password } });
    assert.equal(login.statusCode, 200);
    return { user, token: login.json().access_token };
  }

  ({ user: director, token: directorToken } = await makeUser('director', 'director'));
  ({ user: evaluator2, token: evaluator2Token } = await makeUser('eval2', 'evaluator'));
  ({ user: evaluator3, token: evaluator3Token } = await makeUser('eval3', 'evaluator'));

  const teacherPassword = 'teacher-password-1234';
  teacherEvaluatee = await prisma.userAccount.create({
    data: { email: `score-teacher-${randomUUID()}@x.io`, displayName: 'Teacher', status: 'active', passwordHash: await argonHash(teacherPassword) },
  });
  const personnel = await prisma.personnelProfile.create({
    data: { schoolId: school.id, userId: teacherEvaluatee.id, fullName: 'Teacher', positionRole: 'teacher', rankLevelCode: 'score_kru' },
  });
  teacherPersonnelId = personnel.id;
  await prisma.schoolMembership.create({
    data: { userId: teacherEvaluatee.id, schoolId: school.id, role: 'teacher', membershipScope: 'school', effectiveFrom: new Date('2020-01-01'), status: 'active' },
  });
  const teacherLogin = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: teacherEvaluatee.email, password: teacherPassword } });
  teacherToken = teacherLogin.json().access_token;
});

after(async () => {
  await app.close();
  await prisma.$disconnect();
});

function auth(token) {
  return { authorization: `Bearer ${token}` };
}

async function makeOpenRound(fiscalYear) {
  const cycleRes = await app.inject({
    method: 'POST', url: '/api/v1/cycles', headers: auth(directorToken),
    payload: { framework_version_id: frameworkId, fiscal_year: fiscalYear, evaluation_kind: 'pa', title: 'PA cycle', starts_on: '2026-01-01', ends_on: '2026-12-31' },
  });
  assert.equal(cycleRes.statusCode, 201, JSON.stringify(cycleRes.json()));
  const cycle = cycleRes.json();

  const roundRes = await app.inject({
    method: 'POST', url: `/api/v1/cycles/${cycle.id}/rounds`, headers: auth(directorToken),
    payload: { round_number: 1, purpose: 'annual', period_start: '2026-02-01', period_end: '2026-11-30' },
  });
  assert.equal(roundRes.statusCode, 201, JSON.stringify(roundRes.json()));
  const round = roundRes.json();

  const openRes = await app.inject({ method: 'PATCH', url: `/api/v1/rounds/${round.id}`, headers: auth(directorToken), payload: { status: 'open' } });
  assert.equal(openRes.statusCode, 200);
  return { cycle, round: openRes.json() };
}

// WorkloadDeclaration's FK requires a real PerformanceAgreement (agreement_id) —
// without one, the workload gate can structurally never be satisfied (SCORE-004
// would fire forever). Every scoring-flow fixture needs one linked.
async function makeAgreement(cycleId) {
  const agreement = await prisma.performanceAgreement.create({
    data: { schoolId: school.id, cycleId, personnelId: teacherPersonnelId, formVariant: 'PA1_s', status: 'submitted' },
  });
  return agreement.id;
}

async function makeAssignment(cycleId, roundId) {
  const agreementId = await makeAgreement(cycleId);
  const res = await app.inject({
    method: 'POST', url: `/api/v1/rounds/${roundId}/assignments`, headers: auth(directorToken),
    payload: {
      evaluatee_personnel_id: teacherPersonnelId,
      agreement_id: agreementId,
      committee: [
        { evaluator_user_id: director.id, committee_role: 'chair', seat_number: 1 },
        { evaluator_user_id: evaluator2.id, committee_role: 'member', seat_number: 2 },
        { evaluator_user_id: evaluator3.id, committee_role: 'member', seat_number: 3 },
      ],
    },
  });
  assert.equal(res.statusCode, 201, JSON.stringify(res.json()));
  return res.json();
}

test('round transitions: planned -> open is legal, planned -> closed is not (CYCLE-001)', async () => {
  const cycleRes = await app.inject({
    method: 'POST', url: '/api/v1/cycles', headers: auth(directorToken),
    payload: { framework_version_id: frameworkId, fiscal_year: 3001, evaluation_kind: 'pa', title: 'transition test', starts_on: '2026-01-01', ends_on: '2026-12-31' },
  });
  const cycle = cycleRes.json();
  const roundRes = await app.inject({
    method: 'POST', url: `/api/v1/cycles/${cycle.id}/rounds`, headers: auth(directorToken),
    payload: { round_number: 1, purpose: 'x', period_start: '2026-02-01', period_end: '2026-11-30' },
  });
  const round = roundRes.json();

  const skipAhead = await app.inject({ method: 'PATCH', url: `/api/v1/rounds/${round.id}`, headers: auth(directorToken), payload: { status: 'closed' } });
  assert.equal(skipAhead.statusCode, 422);
  assert.equal(skipAhead.json().code, 'CYCLE-001');

  const legal = await app.inject({ method: 'PATCH', url: `/api/v1/rounds/${round.id}`, headers: auth(directorToken), payload: { status: 'open' } });
  assert.equal(legal.statusCode, 200);
  assert.equal(legal.json().status, 'open');
});

test('createRound rejects a period outside the cycle bounds (CYCLE-003)', async () => {
  const cycleRes = await app.inject({
    method: 'POST', url: '/api/v1/cycles', headers: auth(directorToken),
    payload: { framework_version_id: frameworkId, fiscal_year: 3002, evaluation_kind: 'pa', title: 'bounds test', starts_on: '2026-03-01', ends_on: '2026-09-30' },
  });
  const cycle = cycleRes.json();
  const badRound = await app.inject({
    method: 'POST', url: `/api/v1/cycles/${cycle.id}/rounds`, headers: auth(directorToken),
    payload: { round_number: 1, purpose: 'x', period_start: '2026-01-01', period_end: '2026-06-30' },
  });
  assert.equal(badRound.statusCode, 422);
  assert.equal(badRound.json().code, 'CYCLE-003');
});

test('full committee scoring flow: 3 evaluators submit -> rollup computed -> overall pass', async () => {
  const { cycle, round } = await makeOpenRound(3003);
  const assignment = await makeAssignment(cycle.id, round.id);

  const nonMember = await app.inject({
    method: 'PUT', url: `/api/v1/assignments/${assignment.id}/my-scores`, headers: auth(teacherToken),
    payload: { indicator_scores: [{ indicator_id: standardIndicatorAId, rubric_level: 4 }] },
  });
  assert.equal(nonMember.statusCode, 403, 'the evaluatee is not a committee member and holds no submitMyScores grant at all');

  const incomplete = await app.inject({
    method: 'PUT', url: `/api/v1/assignments/${assignment.id}/my-scores`, headers: auth(directorToken),
    payload: { workload_met: true, indicator_scores: [{ indicator_id: standardIndicatorAId, rubric_level: 4 }] },
  });
  assert.equal(incomplete.statusCode, 422);
  assert.equal(incomplete.json().code, 'SCORE-005', 'missing standardIndicatorB and the challenge indicator');

  const scores = [
    { indicator_id: standardIndicatorAId, rubric_level: 4 },
    { indicator_id: standardIndicatorBId, rubric_level: 4 },
    { indicator_id: challengeIndicatorId, rubric_level: 3 },
  ];
  // Expected: part1 = avg(4/4, 4/4)*100 = 100; part2 = (3/4)*100 = 75;
  // total = 100*0.6 + 75*0.4 = 90 -> passed_individual_threshold = true.
  const chairSubmit = await app.inject({
    method: 'PUT', url: `/api/v1/assignments/${assignment.id}/my-scores`, headers: auth(directorToken),
    payload: { workload_met: true, indicator_scores: scores },
  });
  assert.equal(chairSubmit.statusCode, 200, JSON.stringify(chairSubmit.json()));
  const chairResult = chairSubmit.json();
  assert.equal(chairResult.part1_percent, 100);
  assert.equal(chairResult.part2_percent, 75);
  assert.equal(chairResult.total_percent, 90);
  assert.equal(chairResult.passed_individual_threshold, true);

  const partial = await app.inject({ method: 'GET', url: `/api/v1/assignments/${assignment.id}/results`, headers: auth(directorToken) });
  assert.equal(partial.json().complete, false, 'only 1 of 3 evaluators has submitted so far');

  const eval2Submit = await app.inject({
    method: 'PUT', url: `/api/v1/assignments/${assignment.id}/my-scores`, headers: auth(evaluator2Token),
    payload: { indicator_scores: scores },
  });
  assert.equal(eval2Submit.statusCode, 200);

  const eval3LowScores = scores.map((s) => ({ ...s, rubric_level: 1 })); // fails threshold on purpose
  const eval3Submit = await app.inject({
    method: 'PUT', url: `/api/v1/assignments/${assignment.id}/my-scores`, headers: auth(evaluator3Token),
    payload: { indicator_scores: eval3LowScores },
  });
  assert.equal(eval3Submit.statusCode, 200);
  assert.equal(eval3Submit.json().total_percent, 25, 'level 1 on every indicator -> 25% everywhere');
  assert.equal(eval3Submit.json().passed_individual_threshold, false);

  const results = await app.inject({ method: 'GET', url: `/api/v1/assignments/${assignment.id}/results`, headers: auth(directorToken) });
  const body = results.json();
  assert.equal(body.complete, true, 'all 3 committee members have now submitted');
  assert.equal(body.workload_gate_met, true);
  assert.equal(body.evaluator_results.length, 3);
  assert.equal(body.overall_pass, false, 'ว9 p.74: pass requires >=70% from EVERY evaluator individually, not the average');

  const assignmentDetail = await app.inject({ method: 'GET', url: `/api/v1/assignments/${assignment.id}`, headers: auth(directorToken) });
  assert.equal(assignmentDetail.json().my_submission_state, 'submitted');
});

test('scores are rejected once the round closes (SCORE-002), and the evaluatee cannot see results until closed', async () => {
  const { cycle, round } = await makeOpenRound(3004);
  const assignment = await makeAssignment(cycle.id, round.id);

  await app.inject({
    method: 'PUT', url: `/api/v1/assignments/${assignment.id}/my-scores`, headers: auth(directorToken),
    payload: { workload_met: true, indicator_scores: [
      { indicator_id: standardIndicatorAId, rubric_level: 4 }, { indicator_id: standardIndicatorBId, rubric_level: 4 },
      { indicator_id: challengeIndicatorId, rubric_level: 4 },
    ] },
  });

  const teacherResultsBeforeClose = await app.inject({ method: 'GET', url: `/api/v1/assignments/${assignment.id}/results`, headers: auth(teacherToken) });
  assert.equal(teacherResultsBeforeClose.statusCode, 403, 'evaluatee cannot see results while the round is still open');
  assert.equal(teacherResultsBeforeClose.json().code, 'PERM-001');

  await app.inject({ method: 'PATCH', url: `/api/v1/rounds/${round.id}`, headers: auth(directorToken), payload: { status: 'scoring' } });
  await app.inject({ method: 'PATCH', url: `/api/v1/rounds/${round.id}`, headers: auth(directorToken), payload: { status: 'closed' } });

  const lateSubmit = await app.inject({
    method: 'PUT', url: `/api/v1/assignments/${assignment.id}/my-scores`, headers: auth(evaluator2Token),
    payload: { indicator_scores: [{ indicator_id: standardIndicatorAId, rubric_level: 4 }, { indicator_id: standardIndicatorBId, rubric_level: 4 }, { indicator_id: challengeIndicatorId, rubric_level: 4 }] },
  });
  assert.equal(lateSubmit.statusCode, 409);
  assert.equal(lateSubmit.json().code, 'SCORE-002');

  const teacherResultsAfterClose = await app.inject({ method: 'GET', url: `/api/v1/assignments/${assignment.id}/results`, headers: auth(teacherToken) });
  assert.equal(teacherResultsAfterClose.statusCode, 200, 'now visible once the round is closed');
});

test('committee grant on evidence: an assigned evaluator can read their evaluatee\'s evidence, an unassigned one cannot', async () => {
  const { cycle, round } = await makeOpenRound(3005);
  await makeAssignment(cycle.id, round.id);

  const cat = await prisma.evidenceCategory.upsert({
    where: { code: `score-cat-${Date.now()}` }, create: { code: `score-cat-${Date.now()}`, labelTh: 'x', allowedMimeTypes: ['application/pdf'] }, update: {},
  });
  const createEvidence = await app.inject({
    method: 'POST', url: '/api/v1/evidence', headers: auth(teacherToken),
    payload: { category_id: cat.id, title: 'committee visibility test' },
  });
  assert.equal(createEvidence.statusCode, 201);
  const evidence = createEvidence.json();

  const asCommitteeMember = await app.inject({ method: 'GET', url: `/api/v1/evidence/${evidence.id}`, headers: auth(evaluator2Token) });
  assert.equal(asCommitteeMember.statusCode, 200, 'evaluator2 sits on an active committee for this evidence owner');

  const outsider = await (async () => {
    const password = 'outsider-password-1234';
    const user = await prisma.userAccount.create({ data: { email: `score-outsider-${randomUUID()}@x.io`, displayName: 'Outsider', status: 'active', passwordHash: await argonHash(password) } });
    await prisma.schoolMembership.create({ data: { userId: user.id, schoolId: school.id, role: 'evaluator', membershipScope: 'school', effectiveFrom: new Date('2020-01-01'), status: 'active' } });
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: user.email, password } });
    return login.json().access_token;
  })();
  const asOutsider = await app.inject({ method: 'GET', url: `/api/v1/evidence/${evidence.id}`, headers: auth(outsider) });
  assert.equal(asOutsider.statusCode, 403, 'an evaluator not on this evidence owner\'s committee gets PERM-001, not silent access');
  assert.equal(asOutsider.json().code, 'PERM-001');
});

test('createAssignment enforces exactly one chair and 3 distinct evaluators (VAL-002)', async () => {
  const { round } = await makeOpenRound(3006);
  const noChair = await app.inject({
    method: 'POST', url: `/api/v1/rounds/${round.id}/assignments`, headers: auth(directorToken),
    payload: {
      evaluatee_personnel_id: teacherPersonnelId,
      committee: [
        { evaluator_user_id: director.id, committee_role: 'member', seat_number: 1 },
        { evaluator_user_id: evaluator2.id, committee_role: 'member', seat_number: 2 },
        { evaluator_user_id: evaluator3.id, committee_role: 'member', seat_number: 3 },
      ],
    },
  });
  assert.equal(noChair.statusCode, 422);
  assert.equal(noChair.json().code, 'VAL-002');

  const duplicateEvaluator = await app.inject({
    method: 'POST', url: `/api/v1/rounds/${round.id}/assignments`, headers: auth(directorToken),
    payload: {
      evaluatee_personnel_id: teacherPersonnelId,
      committee: [
        { evaluator_user_id: director.id, committee_role: 'chair', seat_number: 1 },
        { evaluator_user_id: director.id, committee_role: 'member', seat_number: 2 },
        { evaluator_user_id: evaluator3.id, committee_role: 'member', seat_number: 3 },
      ],
    },
  });
  assert.equal(duplicateEvaluator.statusCode, 422);
  assert.equal(duplicateEvaluator.json().code, 'VAL-002');
});

test('committee seats require an eligible membership at the school, and the evaluatee can never sit on their own committee (2026-07-18 audit fix)', async () => {
  const { round } = await makeOpenRound(3007);
  const committeeWith = (thirdSeatUserId) => ({
    evaluatee_personnel_id: teacherPersonnelId,
    committee: [
      { evaluator_user_id: director.id, committee_role: 'chair', seat_number: 1 },
      { evaluator_user_id: evaluator2.id, committee_role: 'member', seat_number: 2 },
      { evaluator_user_id: thirdSeatUserId, committee_role: 'member', seat_number: 3 },
    ],
  });

  // A real account with NO membership at this school (exists, so the pre-existing
  // existence check passes — exactly the gap the audit found).
  const foreign = await prisma.userAccount.create({
    data: { email: `score-foreign-${randomUUID()}@x.io`, displayName: 'Foreign', status: 'active', passwordHash: 'x' },
  });
  const crossSchool = await app.inject({
    method: 'POST', url: `/api/v1/rounds/${round.id}/assignments`, headers: auth(directorToken),
    payload: committeeWith(foreign.id),
  });
  assert.equal(crossSchool.statusCode, 422, 'an account from outside the school must not be seatable');
  assert.equal(crossSchool.json().code, 'VAL-002');

  // A member of THIS school whose role (teacher) can never submit scores.
  const wrongRole = await app.inject({
    method: 'POST', url: `/api/v1/rounds/${round.id}/assignments`, headers: auth(directorToken),
    payload: committeeWith(teacherEvaluatee.id),
  });
  assert.equal(wrongRole.statusCode, 422, 'a teacher-role member must not be seatable');
  assert.equal(wrongRole.json().code, 'VAL-002');

  // Self-scoring: give the evaluatee an evaluator membership too (dual-role staff
  // are real) — role-eligible now, but still their own evaluatee.
  await prisma.schoolMembership.create({
    data: { userId: teacherEvaluatee.id, schoolId: school.id, role: 'evaluator', membershipScope: 'school', effectiveFrom: new Date('2020-01-01'), status: 'active' },
  });
  const selfScoring = await app.inject({
    method: 'POST', url: `/api/v1/rounds/${round.id}/assignments`, headers: auth(directorToken),
    payload: committeeWith(teacherEvaluatee.id),
  });
  assert.equal(selfScoring.statusCode, 422, 'the evaluatee must never sit on their own committee');
  assert.equal(selfScoring.json().code, 'VAL-002');
  assert.match(selfScoring.json().message, /own committee/);

  // Sanity: a fully-eligible committee on the same round still succeeds.
  const valid = await app.inject({
    method: 'POST', url: `/api/v1/rounds/${round.id}/assignments`, headers: auth(directorToken),
    payload: committeeWith(evaluator3.id),
  });
  assert.equal(valid.statusCode, 201, `eligible committee must still create: ${valid.body}`);
});
