// Committee assignments + per-evaluator scoring. EvaluationAssignment carries
// schoolId directly, but roundId-scoped routes still resolve through
// getRoundForAction (cycles.ts) since a round itself has none.
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  getRoundForAction,
  listAssignmentsForRound, createAssignmentWithCommittee, getAssignmentDetail,
  getCommitteeMembership, countCommitteeMembers,
  getWorkloadDeclaration, upsertWorkloadDeclaration,
  replaceIndicatorScores, getIndicatorScores, upsertRoundResult, getRoundResultsForAssignment,
  getPersonnelById, countExistingUserIds, getFrameworkById, getFrameworkDetail, writeAuditEvent,
} from '@seip/database';
import { ApiError, forbiddenAreaWrite, forbiddenRole } from '@seip/backend-shared';
import { resolveGrant, requireOwnership } from '../lib/permission-guard.js';

function serializeCommitteeMember(m: { evaluatorUserId: string; committeeRole: string; seatNumber: number }) {
  return { evaluator_user_id: m.evaluatorUserId, committee_role: m.committeeRole, seat_number: m.seatNumber };
}

function serializeAssignment(a: { id: string; roundId: string; evaluateePersonnelId: string; agreementId: string | null; status: string; committee: { evaluatorUserId: string; committeeRole: string; seatNumber: number }[] }) {
  return {
    id: a.id, round_id: a.roundId, evaluatee_personnel_id: a.evaluateePersonnelId,
    agreement_id: a.agreementId, status: a.status, committee: a.committee.map(serializeCommitteeMember),
  };
}

function serializeEvaluatorResult(r: { assignmentId: string; evaluatorUserId: string; part1Percent: unknown; part2Percent: unknown; totalPercent: unknown; passedIndividualThreshold: boolean | null; computedAt: Date }) {
  return {
    assignment_id: r.assignmentId, evaluator_user_id: r.evaluatorUserId,
    part1_percent: Number(r.part1Percent), part2_percent: Number(r.part2Percent), total_percent: Number(r.totalPercent),
    passed_individual_threshold: r.passedIndividualThreshold,
    computed_at: r.computedAt.toISOString(),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Weighted-average percent for one framework "part" (standard indicators ->
 * part1; challenge indicators -> part2). Standard indicators carry no individual
 * maxPoints (seed data: null), so they default to weight=1 each — an equal-weight
 * average. Challenge indicators DO carry maxPoints (20/10/10, seed data), so they
 * weight naturally by point value. One formula covers both cases without a branch. */
function computePartPercent(items: { rubricLevel: number; maxPoints: number | null }[]): number {
  if (items.length === 0) return 0;
  const totalWeight = items.reduce((s, i) => s + (i.maxPoints ?? 1), 0);
  const earned = items.reduce((s, i) => s + (i.maxPoints ?? 1) * (i.rubricLevel / 4), 0);
  return (earned / totalWeight) * 100;
}

export const scoringRoutes: FastifyPluginAsync = async (app) => {
  app.get('/rounds/:roundId/assignments', { config: { operationId: 'listAssignments' } }, async (request) => {
    const auth = request.auth!;
    const { roundId } = z.object({ roundId: z.string().uuid() }).parse(request.params);

    const round = await getRoundForAction(roundId);
    if (!round) throw new ApiError('RES-001', 'Round not found');
    const grant = await resolveGrant('listAssignments', auth, round.cycle.schoolId);

    const q = z.object({
      page: z.coerce.number().int().min(1).default(1),
      page_size: z.coerce.number().int().min(1).max(100).default(20),
    }).parse(request.query);

    let evaluateePersonnelId: string | undefined;
    let committeeEvaluatorUserId: string | undefined;
    if (grant === 'own') evaluateePersonnelId = auth.personnel?.id;
    else if (grant === 'committee') committeeEvaluatorUserId = auth.userId;

    const { items, total } = await listAssignmentsForRound(roundId, {
      evaluateePersonnelId, committeeEvaluatorUserId, page: q.page, pageSize: q.page_size,
    });
    return { items: items.map(serializeAssignment), meta: { page: q.page, page_size: q.page_size, total } };
  });

  app.post('/rounds/:roundId/assignments', { config: { operationId: 'createAssignment' } }, async (request, reply) => {
    const auth = request.auth!;
    const { roundId } = z.object({ roundId: z.string().uuid() }).parse(request.params);

    const round = await getRoundForAction(roundId);
    if (!round) throw new ApiError('RES-001', 'Round not found');
    const grant = await resolveGrant('createAssignment', auth, round.cycle.schoolId);
    if (grant === 'area-r') throw forbiddenAreaWrite();

    const body = z.object({
      evaluatee_personnel_id: z.string().uuid(),
      agreement_id: z.string().uuid().nullable().optional(),
      committee: z.array(z.object({
        evaluator_user_id: z.string().uuid(),
        committee_role: z.enum(['chair', 'member']),
        seat_number: z.number().int().min(1).max(3),
      })).length(3),
    }).parse(request.body);

    const seatNumbers = [...body.committee.map((c) => c.seat_number)].sort();
    if (JSON.stringify(seatNumbers) !== JSON.stringify([1, 2, 3])) {
      throw new ApiError('VAL-002', 'committee seat_number must be exactly 1, 2 and 3, one each');
    }
    const evaluatorIds = new Set(body.committee.map((c) => c.evaluator_user_id));
    if (evaluatorIds.size !== 3) throw new ApiError('VAL-002', 'committee evaluator_user_id values must be distinct');
    if (body.committee.filter((c) => c.committee_role === 'chair').length !== 1) {
      throw new ApiError('VAL-002', 'committee must have exactly one chair (ว9/ว10: ผอ.สถานศึกษา as chair + 2 members)');
    }
    const existingUserCount = await countExistingUserIds([...evaluatorIds]);
    if (existingUserCount !== 3) throw new ApiError('VAL-002', 'One or more committee evaluator_user_id values do not exist');

    const evaluatee = await getPersonnelById(body.evaluatee_personnel_id);
    if (!evaluatee || evaluatee.schoolId !== round.cycle.schoolId) {
      throw new ApiError('VAL-002', 'Unknown evaluatee_personnel_id');
    }
    const framework = await getFrameworkById(round.cycle.frameworkVersionId);
    if (!framework) throw new ApiError('SYS-001', "round's framework vanished");
    if (evaluatee.positionRole !== framework.roleFamily) {
      throw new ApiError('VAL-003', "evaluatee's position role does not match this round's framework");
    }

    const assignment = await createAssignmentWithCommittee(round.cycle.schoolId, roundId, {
      evaluateePersonnelId: body.evaluatee_personnel_id,
      agreementId: body.agreement_id ?? null,
      committee: body.committee.map((c) => ({
        evaluatorUserId: c.evaluator_user_id, committeeRole: c.committee_role, seatNumber: c.seat_number,
      })),
    });

    await writeAuditEvent({
      schoolId: round.cycle.schoolId, actorUserId: auth.userId, action: 'created', entityType: 'EvaluationAssignment',
      entityId: assignment.id, after: assignment, requestId: request.id,
    });
    reply.status(201).send(serializeAssignment(assignment));
  });

  app.get('/assignments/:assignmentId', { config: { operationId: 'getAssignment' } }, async (request) => {
    const auth = request.auth!;
    const { assignmentId } = z.object({ assignmentId: z.string().uuid() }).parse(request.params);

    const assignment = await getAssignmentDetail(assignmentId);
    if (!assignment) throw new ApiError('RES-001', 'Assignment not found');
    const grant = await resolveGrant('getAssignment', auth, assignment.schoolId);
    if (grant === 'own') requireOwnership(auth, assignment.evaluateePersonnelId);

    // Committee membership drives my_submission_state regardless of WHICH grant
    // let the caller read this assignment — a director's grant here is 'school',
    // but they may separately also sit on this specific committee as chair.
    const membership = await getCommitteeMembership(assignmentId, auth.userId);
    if (grant === 'committee' && !membership) throw new ApiError('PERM-003', 'Not a committee member of this assignment');
    const mySubmissionState = membership
      ? ((await getIndicatorScores(assignmentId, auth.userId)).length > 0 ? 'submitted' : 'not_submitted')
      : 'not_member';

    const workloadRow = assignment.agreementId
      ? await getWorkloadDeclaration(assignment.agreementId, assignment.round.id)
      : null;

    return {
      ...serializeAssignment(assignment),
      workload_gate_declared: Boolean(workloadRow),
      workload_met: workloadRow?.workloadMet ?? null,
      my_submission_state: mySubmissionState,
    };
  });

  app.put('/assignments/:assignmentId/my-scores', { config: { operationId: 'submitMyScores' } }, async (request) => {
    const auth = request.auth!;
    const { assignmentId } = z.object({ assignmentId: z.string().uuid() }).parse(request.params);

    const assignment = await getAssignmentDetail(assignmentId);
    if (!assignment) throw new ApiError('RES-001', 'Assignment not found');
    await resolveGrant('submitMyScores', auth, assignment.schoolId);
    // The matrix grant (evaluator:committee, director:committee) is always
    // 'committee' for this op — both roles are narrowed to "must actually sit on
    // THIS assignment's committee," which only an explicit membership row proves.
    const membership = await getCommitteeMembership(assignmentId, auth.userId);
    if (!membership) throw new ApiError('PERM-003', 'Not a committee member of this assignment');

    if (assignment.round.status !== 'open' && assignment.round.status !== 'scoring') {
      throw new ApiError('SCORE-002', 'Round is not open for scoring');
    }
    const committeeCount = await countCommitteeMembers(assignmentId);
    if (committeeCount !== 3) throw new ApiError('SCORE-001', 'Committee incomplete — scoring requires exactly 3 members');

    const body = z.object({
      workload_met: z.boolean().nullable().optional(),
      indicator_scores: z.array(z.object({
        indicator_id: z.string().uuid(),
        rubric_level: z.number().int().min(1).max(4),
        comment: z.string().max(2000).nullable().optional(),
      })).min(1),
    }).parse(request.body);

    // Workload gate: only the chair's declaration is honored — the row is shared
    // per (agreement, round), not per-evaluator (ผอ. owns ภาระงาน sign-off), so a
    // non-chair's value would silently clobber the chair's.
    if (body.workload_met !== null && body.workload_met !== undefined && membership.committeeRole === 'chair') {
      if (!assignment.agreementId) {
        throw new ApiError('VAL-002', 'Assignment has no linked agreement — workload gate cannot be declared');
      }
      await upsertWorkloadDeclaration(assignment.agreementId, assignment.round.id, body.workload_met, auth.userId);
    }
    const workloadRow = assignment.agreementId
      ? await getWorkloadDeclaration(assignment.agreementId, assignment.round.id)
      : null;
    if (!workloadRow) throw new ApiError('SCORE-004', 'Workload gate not declared before score submission');

    // SCORE-005: the submitted set must exactly equal every is_scored indicator of
    // the round's framework — no partial submissions, no stale leftovers.
    const framework = await getFrameworkDetail(assignment.round.cycle.frameworkVersionId, false);
    if (!framework) throw new ApiError('SYS-001', "round's framework vanished");
    const scorable = framework.domains.flatMap((d) => d.indicators).filter((i) => i.isScored);
    const byIndicatorId = new Map(scorable.map((i) => [i.id, i]));

    const submittedIds = body.indicator_scores.map((s) => s.indicator_id);
    if (new Set(submittedIds).size !== submittedIds.length) {
      throw new ApiError('VAL-002', 'Duplicate indicator_id in submission');
    }
    for (const id of submittedIds) {
      if (!byIndicatorId.has(id)) throw new ApiError('VAL-003', `indicator ${id} does not belong to this round's framework`);
    }
    if (submittedIds.length !== byIndicatorId.size) {
      throw new ApiError('SCORE-005', `Score set incomplete — expected ${byIndicatorId.size} scored indicators, got ${submittedIds.length}`);
    }

    await replaceIndicatorScores(assignmentId, auth.userId, body.indicator_scores.map((s) => ({
      indicatorId: s.indicator_id, rubricLevel: s.rubric_level, comment: s.comment ?? null,
    })));

    // Rollup: part1 (standard, equal-weight average) / part2 (challenge,
    // maxPoints-weighted) / total = part1*part1_weight% + part2*part2_weight%
    // (ScoreWeight part1_total=60, part2_total=40 — framework data, not a constant).
    const standardScores: { rubricLevel: number; maxPoints: number | null }[] = [];
    const challengeScores: { rubricLevel: number; maxPoints: number | null }[] = [];
    for (const s of body.indicator_scores) {
      const ind = byIndicatorId.get(s.indicator_id)!;
      const maxPoints = ind.maxPoints ? Number(ind.maxPoints) : null;
      (ind.indicatorKind === 'challenge' ? challengeScores : standardScores).push({ rubricLevel: s.rubric_level, maxPoints });
    }
    const part1Percent = computePartPercent(standardScores);
    const part2Percent = computePartPercent(challengeScores);
    const weights = Object.fromEntries(framework.weights.map((w) => [w.weightKey, Number(w.weightValue)]));
    const part1Weight = weights.part1_total ?? 60;
    const part2Weight = weights.part2_total ?? 40;
    const totalPercent = part1Percent * (part1Weight / 100) + part2Percent * (part2Weight / 100);

    const result = await upsertRoundResult(assignmentId, auth.userId, {
      part1Percent: round2(part1Percent), part2Percent: round2(part2Percent), totalPercent: round2(totalPercent),
      passedWorkloadGate: workloadRow.workloadMet,
    });

    await writeAuditEvent({
      schoolId: assignment.schoolId, actorUserId: auth.userId, action: 'scores_submitted',
      entityType: 'EvaluationAssignment', entityId: assignmentId, requestId: request.id,
    });
    return serializeEvaluatorResult(result);
  });

  app.get('/assignments/:assignmentId/results', { config: { operationId: 'getAssignmentResults' } }, async (request) => {
    const auth = request.auth!;
    const { assignmentId } = z.object({ assignmentId: z.string().uuid() }).parse(request.params);

    const assignment = await getAssignmentDetail(assignmentId);
    if (!assignment) throw new ApiError('RES-001', 'Assignment not found');
    const grant = await resolveGrant('getAssignmentResults', auth, assignment.schoolId);

    if (grant === 'own') {
      requireOwnership(auth, assignment.evaluateePersonnelId);
      // permissions.yaml note: the evaluatee sees their own results only once the
      // round is closed — prevents mid-scoring visibility even after all 3 submit.
      if (assignment.round.status !== 'closed') throw forbiddenRole();
    } else if (grant === 'committee') {
      const membership = await getCommitteeMembership(assignmentId, auth.userId);
      if (!membership) throw new ApiError('PERM-003', 'Not a committee member of this assignment');
    }

    const [results, committeeCount] = await Promise.all([
      getRoundResultsForAssignment(assignmentId),
      countCommitteeMembers(assignmentId),
    ]);
    const complete = committeeCount > 0 && results.length >= committeeCount;

    const workloadRow = assignment.agreementId
      ? await getWorkloadDeclaration(assignment.agreementId, assignment.round.id)
      : null;
    const workloadGateMet = workloadRow?.workloadMet ?? null;

    const overallPass = complete
      ? workloadGateMet === true && results.every((r) => r.passedIndividualThreshold === true)
      : null;

    return {
      assignment_id: assignmentId,
      workload_gate_met: workloadGateMet,
      evaluator_results: results.map(serializeEvaluatorResult),
      complete,
      overall_pass: overallPass,
    };
  });
};
