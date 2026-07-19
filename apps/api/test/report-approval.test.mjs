// CCR-016 / SEIP-BLOCK-003 — report approval, the last blocker.
//
// prisma.approval had zero references anywhere: report.generate flipped a report
// draft -> pending_approval and nothing moved it again, so `approved`, `issued`
// and `superseded` were unreachable and the whole ApprovalDecision enum was
// unused. SEIP could evaluate a teacher end to end and produce the document, but
// nobody could sign it.
//
// The test that matters most is not the happy path — it is
// "approval is refused while the round is still open". Nothing checks round
// state at report creation or generation, and scores only freeze on close
// (SCORE-002), so without that rule an approved document could be contradicted
// by its own data afterwards.
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
let school, frameworkId, cycleId;
let directorToken, director2Token, teacherToken, teacherPersonnelId, directorPersonnelId;

const PASSWORD = 'approval-test-password-1234';

function auth(t) { return { authorization: `Bearer ${t}` }; }

async function makeUser({ role, withPersonnel, schoolId }) {
  const email = `apr-${role}-${randomUUID()}@x.io`;
  const user = await prisma.userAccount.create({
    data: { email, displayName: role, status: 'active', passwordHash: await argonHash(PASSWORD) },
  });
  await prisma.schoolMembership.create({
    data: { userId: user.id, schoolId, role, membershipScope: 'school', effectiveFrom: new Date('2020-01-01'), status: 'active' },
  });
  let personnelId = null;
  if (withPersonnel) {
    const p = await prisma.personnelProfile.create({
      data: { schoolId, userId: user.id, fullName: role, positionRole: 'teacher', rankLevelCode: 'apply_adapt', status: 'active' },
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

  school = await prisma.school.create({ data: { code: `apr-${randomUUID()}`, name: 'Approval School' } });
  const fw = await prisma.frameworkVersion.findFirst({ where: { code: 'v9-2564-teacher' }, select: { id: true } });
  assert.ok(fw, 'taxonomy seed required — run npm run db:seed');
  frameworkId = fw.id;

  const teacher = await makeUser({ role: 'teacher', withPersonnel: true, schoolId: school.id });
  teacherPersonnelId = teacher.personnelId;
  teacherToken = teacher.token;

  const director = await makeUser({ role: 'director', withPersonnel: true, schoolId: school.id });
  directorToken = director.token;
  directorPersonnelId = director.personnelId;

  director2Token = (await makeUser({ role: 'director', withPersonnel: false, schoolId: school.id })).token;

  const cycle = await app.inject({
    method: 'POST', url: '/api/v1/cycles', headers: auth(directorToken),
    payload: { framework_version_id: frameworkId, fiscal_year: 3020, evaluation_kind: 'pa', title: 'approval cycle', starts_on: '2026-01-01', ends_on: '2026-12-31' },
  });
  assert.equal(cycle.statusCode, 201, cycle.body);
  cycleId = cycle.json().id;
});

after(async () => {
  await app.close();
  await prisma.$disconnect();
});

/**
 * A report sitting at pending_approval. The payload is written directly because
 * generation is the worker's job and is covered by reports-and-ai.test.mjs — this
 * file is about what happens to a report AFTER it is generated.
 */
async function makePendingReport({ subjectPersonnelId = teacherPersonnelId, roundId = null } = {}) {
  const created = await app.inject({
    method: 'POST', url: '/api/v1/reports', headers: auth(directorToken),
    payload: {
      cycle_id: cycleId,
      subject_personnel_id: subjectPersonnelId,
      template_code: 'PA2_s',
      ...(roundId ? { round_id: roundId } : {}),
    },
  });
  assert.equal(created.statusCode, 201, created.body);
  await prisma.report.update({
    where: { id: created.json().id },
    data: {
      status: 'pending_approval',
      // A full ReportPayloadV1: the PDF builder rejects anything
      // isReportPayloadReady() does not accept (RPT-002), so a stub payload would
      // only prove that the guard works.
      payload: {
        schema_version: 1,
        generation_status: 'ready',
        template_code: 'PA2_s',
        subject: {
          personnel_id: subjectPersonnelId,
          full_name: 'Approval Subject',
          position_role: 'teacher',
          rank_level_code: 'apply_adapt',
        },
        cycle: {
          id: cycleId,
          title: 'approval cycle',
          fiscal_year: 3020,
          evaluation_kind: 'pa',
          framework_code: 'v9-2564-teacher',
          framework_legal_ref: 'ศธ 0206.3/ว 9',
        },
        round: null,
        confirmed_mappings: [],
        assignments: [],
        generated_at: new Date().toISOString(),
      },
    },
  });
  return created.json().id;
}

async function makeRound(status) {
  const round = await app.inject({
    method: 'POST', url: `/api/v1/cycles/${cycleId}/rounds`, headers: auth(directorToken),
    payload: { round_number: Math.floor(Math.random() * 900) + 10, purpose: 'approval test', period_start: '2026-02-01', period_end: '2026-11-30' },
  });
  assert.equal(round.statusCode, 201, round.body);
  if (status !== 'planned') {
    await prisma.evaluationRound.update({ where: { id: round.json().id }, data: { status } });
  }
  return round.json().id;
}

// ── the rule this CCR exists for ──

test('a report cannot be approved while its round is still open', async () => {
  // Scores stay editable until the round closes (SCORE-002). Approving earlier
  // would timestamp a signature against numbers that can still change, and the
  // approved document would end up contradicting its own data.
  const roundId = await makeRound('open');
  const reportId = await makePendingReport({ roundId });

  const denied = await app.inject({
    method: 'POST', url: `/api/v1/reports/${reportId}/approve`, headers: auth(directorToken),
  });
  assert.equal(denied.statusCode, 422, denied.body);
  assert.equal(denied.json().code, 'RPT-003');

  const untouched = await prisma.report.findUnique({ where: { id: reportId }, select: { status: true } });
  assert.equal(untouched.status, 'pending_approval', 'a refused approval must not move the report');
  assert.equal(await prisma.approval.count({ where: { reportId } }), 0, 'and must not record a decision');
});

test('once the round closes, the same report approves', async () => {
  const roundId = await makeRound('open');
  const reportId = await makePendingReport({ roundId });

  assert.equal(
    (await app.inject({ method: 'POST', url: `/api/v1/reports/${reportId}/approve`, headers: auth(directorToken) })).statusCode,
    422,
  );

  await prisma.evaluationRound.update({ where: { id: roundId }, data: { status: 'closed' } });

  const ok = await app.inject({
    method: 'POST', url: `/api/v1/reports/${reportId}/approve`, headers: auth(directorToken),
    payload: { comment: 'ผลการประเมินครบถ้วน' },
  });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.json().status, 'approved');
  assert.equal(ok.json().approvals.length, 1);
  assert.equal(ok.json().approvals[0].decision, 'approved');
  assert.equal(ok.json().approvals[0].step_code, 'director');
  assert.ok(ok.json().approvals[0].decided_at);
});

test('a cycle-level report with no round skips the round check', async () => {
  // round_id is null: there is no round to freeze, so the rule does not apply and
  // failing closed on it would strand the report forever.
  const reportId = await makePendingReport();
  const ok = await app.inject({
    method: 'POST', url: `/api/v1/reports/${reportId}/approve`, headers: auth(directorToken),
  });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.json().status, 'approved');
});

// ── governance ──

test('nobody can approve their own report', async () => {
  // A director is an evaluatee too under ว10, so `director: school` alone would
  // let them sign their own result. The matrix cannot say "except over yourself".
  const reportId = await makePendingReport({ subjectPersonnelId: directorPersonnelId });

  const denied = await app.inject({
    method: 'POST', url: `/api/v1/reports/${reportId}/approve`, headers: auth(directorToken),
  });
  assert.equal(denied.statusCode, 422);
  assert.equal(denied.json().code, 'RPT-003');

  // Another director can.
  const ok = await app.inject({
    method: 'POST', url: `/api/v1/reports/${reportId}/approve`, headers: auth(director2Token),
  });
  assert.equal(ok.statusCode, 200, ok.body);
});

test('a teacher cannot approve or return anything (PERM-001)', async () => {
  const reportId = await makePendingReport();
  for (const action of ['approve', 'return']) {
    const denied = await app.inject({
      method: 'POST', url: `/api/v1/reports/${reportId}/${action}`, headers: auth(teacherToken),
      payload: { comment: 'x' },
    });
    assert.equal(denied.statusCode, 403, `${action}: ${denied.body}`);
    assert.equal(denied.json().code, 'PERM-001');
  }
});

// ── return ──

test('returning sends the report back to draft, and requires a reason', async () => {
  const reportId = await makePendingReport();

  const noReason = await app.inject({
    method: 'POST', url: `/api/v1/reports/${reportId}/return`, headers: auth(directorToken),
    payload: {},
  });
  assert.equal(noReason.statusCode, 400, 'handing a result back with no stated reason gives nobody anything to act on');

  const returned = await app.inject({
    method: 'POST', url: `/api/v1/reports/${reportId}/return`, headers: auth(directorToken),
    payload: { comment: 'ขาดหลักฐานประกอบตัวชี้วัด T-1.2' },
  });
  assert.equal(returned.statusCode, 200, returned.body);
  assert.equal(returned.json().status, 'draft', 'so it can be regenerated');
  assert.equal(returned.json().approvals[0].decision, 'returned');
  assert.equal(returned.json().approvals[0].comment, 'ขาดหลักฐานประกอบตัวชี้วัด T-1.2');
});

test('a returned report can be regenerated and then approved, and the trail keeps both decisions', async () => {
  const reportId = await makePendingReport();
  await app.inject({
    method: 'POST', url: `/api/v1/reports/${reportId}/return`, headers: auth(directorToken),
    payload: { comment: 'แก้ไขก่อน' },
  });

  // Stand-in for the worker regenerating it.
  await prisma.report.update({ where: { id: reportId }, data: { status: 'pending_approval' } });

  const approved = await app.inject({
    method: 'POST', url: `/api/v1/reports/${reportId}/approve`, headers: auth(directorToken),
  });
  assert.equal(approved.statusCode, 200, approved.body);
  assert.equal(approved.json().status, 'approved');

  const trail = approved.json().approvals;
  assert.equal(trail.length, 2, 'the trail is append-only — a return is not erased by a later approval');
  assert.equal(trail[0].decision, 'returned', 'oldest first');
  assert.equal(trail[1].decision, 'approved');
});

// ── state machine ──

test('approving twice loses the compare-and-swap rather than recording two signatures', async () => {
  const reportId = await makePendingReport();

  const [first, second] = await Promise.all([
    app.inject({ method: 'POST', url: `/api/v1/reports/${reportId}/approve`, headers: auth(directorToken) }),
    app.inject({ method: 'POST', url: `/api/v1/reports/${reportId}/approve`, headers: auth(director2Token) }),
  ]);

  const codes = [first.statusCode, second.statusCode].sort();
  assert.deepEqual(codes, [200, 422], 'exactly one may win');
  assert.equal(await prisma.approval.count({ where: { reportId, decision: 'approved' } }), 1);
});

test('a draft report is not awaiting approval (RPT-003)', async () => {
  const created = await app.inject({
    method: 'POST', url: '/api/v1/reports', headers: auth(directorToken),
    payload: { cycle_id: cycleId, subject_personnel_id: teacherPersonnelId, template_code: 'PA2_s' },
  });
  const denied = await app.inject({
    method: 'POST', url: `/api/v1/reports/${created.json().id}/approve`, headers: auth(directorToken),
  });
  assert.equal(denied.statusCode, 422);
  assert.equal(denied.json().code, 'RPT-003');
});

// ── trail visibility ──

test('the subject can read who signed their own report', async () => {
  const reportId = await makePendingReport();
  await app.inject({ method: 'POST', url: `/api/v1/reports/${reportId}/approve`, headers: auth(directorToken) });

  const trail = await app.inject({
    method: 'GET', url: `/api/v1/reports/${reportId}/approvals`, headers: auth(teacherToken),
  });
  assert.equal(trail.statusCode, 200, trail.body);
  assert.equal(trail.json().length, 1);
  assert.equal(trail.json()[0].decision, 'approved');
});

test('the approval event reaches the outbox', async () => {
  const reportId = await makePendingReport();
  await app.inject({ method: 'POST', url: `/api/v1/reports/${reportId}/approve`, headers: auth(directorToken) });

  const events = await prisma.outboxEvent.findMany({
    where: { eventType: 'report.approved' },
    orderBy: { occurredAt: 'desc' },
    take: 20,
  });
  const mine = events.find((e) => e.payload?.report_id === reportId);
  assert.ok(mine, 'report.approved must be emitted — it left the events.yaml deferred: block in CCR-016');
  assert.ok(mine.payload.approver_user_id, 'and must name the approver so a notification could');
  // Returning is deliberately NOT an event: an internal drafting step nothing
  // downstream needs to react to.
  const returned = await prisma.outboxEvent.count({ where: { eventType: 'report.returned' } });
  assert.equal(returned, 0);
});

// ── the PDF must not look signed when it is not ──

test('the PDF states whether the report has been approved', async () => {
  const pendingId = await makePendingReport();
  const before = await app.inject({
    method: 'GET', url: `/api/v1/reports/${pendingId}/pdf`, headers: auth(directorToken),
  });
  assert.equal(before.statusCode, 200, before.body);
  assert.ok(before.rawPayload.subarray(0, 5).toString() === '%PDF-', 'still a valid PDF');
  const beforeLen = before.rawPayload.length;

  await app.inject({ method: 'POST', url: `/api/v1/reports/${pendingId}/approve`, headers: auth(directorToken) });

  const after = await app.inject({
    method: 'GET', url: `/api/v1/reports/${pendingId}/pdf`, headers: auth(directorToken),
  });
  assert.equal(after.statusCode, 200);
  // The two documents must differ: an unapproved report and an approved one
  // cannot render identically, or a printout says nothing about endorsement.
  assert.notEqual(after.rawPayload.length, beforeLen, 'the approval stamp must change the document');
});
