// EvaluationAssignment + CommitteeMember + IndicatorScore + RoundResult +
// WorkloadDeclaration. EvaluationAssignment carries schoolId directly
// (entity-dictionary.md), so unlike rounds it needs no relation hop for tenancy.
import { prisma } from '../client.js';
import type { Prisma } from '@prisma/client';

export interface ListAssignmentsFilter {
  /** 'own' grant (teacher/deputy): forces results to the caller's own evaluatee row. */
  evaluateePersonnelId?: string;
  /** 'committee' grant (evaluator/director-as-member): forces results to
   * assignments the caller actually sits on the committee for. */
  committeeEvaluatorUserId?: string;
  page: number;
  pageSize: number;
}

export async function listAssignmentsForRound(roundId: string, f: ListAssignmentsFilter) {
  const where: Prisma.EvaluationAssignmentWhereInput = {
    roundId,
    evaluateePersonnelId: f.evaluateePersonnelId,
    ...(f.committeeEvaluatorUserId ? { committee: { some: { evaluatorUserId: f.committeeEvaluatorUserId } } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.evaluationAssignment.findMany({
      where,
      include: { committee: true },
      orderBy: { id: 'asc' },
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
    }),
    prisma.evaluationAssignment.count({ where }),
  ]);
  return { items, total };
}

export async function createAssignmentWithCommittee(schoolId: string, roundId: string, data: {
  evaluateePersonnelId: string;
  agreementId: string | null;
  committee: { evaluatorUserId: string; committeeRole: 'chair' | 'member'; seatNumber: number }[];
}) {
  return prisma.evaluationAssignment.create({
    data: {
      schoolId,
      roundId,
      evaluateePersonnelId: data.evaluateePersonnelId,
      agreementId: data.agreementId,
      committee: { createMany: { data: data.committee } },
    },
    include: { committee: true },
  });
}

/** Full detail for getAssignment/getAssignmentResults/submitMyScores — the round's
 * status and its cycle's schoolId/frameworkVersionId are needed by all three
 * (grant resolution, SCORE-002's open/scoring check, and the scoring rollup). */
export async function getAssignmentDetail(assignmentId: string) {
  return prisma.evaluationAssignment.findUnique({
    where: { id: assignmentId },
    include: {
      committee: true,
      // CCR-013: IndicatorLevelDescription rows are keyed by (rank_level_code,
      // rubric_level), so a scoring client needs the evaluatee's วิทยฐานะ to pick
      // the right expected-practice text. There is no personnel lookup operation
      // for it to resolve this itself.
      evaluatee: { select: { rankLevelCode: true } },
      round: {
        select: {
          id: true, status: true,
          cycle: { select: { schoolId: true, frameworkVersionId: true } },
        },
      },
    },
  });
}

export async function getCommitteeMembership(assignmentId: string, evaluatorUserId: string) {
  return prisma.committeeMember.findUnique({
    where: { assignmentId_evaluatorUserId: { assignmentId, evaluatorUserId } },
  });
}

export async function countCommitteeMembers(assignmentId: string): Promise<number> {
  return prisma.committeeMember.count({ where: { assignmentId } });
}

// ── workload gate (ภาระงาน — pass/fail, shared per agreement+round, not per-evaluator) ──

export async function getWorkloadDeclaration(agreementId: string, roundId: string) {
  return prisma.workloadDeclaration.findUnique({
    where: { agreementId_roundId: { agreementId, roundId } },
  });
}

export async function upsertWorkloadDeclaration(
  agreementId: string, roundId: string, workloadMet: boolean, declaredByUserId: string,
) {
  return prisma.workloadDeclaration.upsert({
    where: { agreementId_roundId: { agreementId, roundId } },
    create: { agreementId, roundId, workloadMet, declaredByUserId },
    update: { workloadMet, declaredByUserId, declaredAt: new Date() },
  });
}

// ── per-evaluator scores (grain: assignment × indicator × evaluator) ──

/** Full-set replace, not per-row upsert: SCORE-005 requires the complete set on
 * every submission, so there is no partial-update case whose row history is worth
 * preserving. Delete + recreate inside one transaction keeps the (assignment,
 * evaluator) row set atomic even under a resubmit. */
export async function replaceIndicatorScores(assignmentId: string, evaluatorUserId: string, scores: {
  indicatorId: string;
  rubricLevel: number;
  comment: string | null;
}[]) {
  await prisma.$transaction([
    prisma.indicatorScore.deleteMany({ where: { assignmentId, evaluatorUserId } }),
    prisma.indicatorScore.createMany({
      data: scores.map((s) => ({
        assignmentId, evaluatorUserId, indicatorId: s.indicatorId, rubricLevel: s.rubricLevel, comment: s.comment,
      })),
    }),
  ]);
}

export async function getIndicatorScores(assignmentId: string, evaluatorUserId: string) {
  return prisma.indicatorScore.findMany({ where: { assignmentId, evaluatorUserId } });
}

export async function upsertRoundResult(assignmentId: string, evaluatorUserId: string, data: {
  part1Percent: number;
  part2Percent: number;
  totalPercent: number;
  passedWorkloadGate: boolean;
}) {
  return prisma.roundResult.upsert({
    where: { assignmentId_evaluatorUserId: { assignmentId, evaluatorUserId } },
    create: { assignmentId, evaluatorUserId, ...data },
    update: { ...data, computedAt: new Date() },
  });
}

export async function getRoundResultsForAssignment(assignmentId: string) {
  return prisma.roundResult.findMany({ where: { assignmentId }, orderBy: { computedAt: 'asc' } });
}

// ── evaluator:committee grant (evidence.ts / mappings.ts) ──

/** Personnel ids the caller currently sits on a committee for, across ALL their
 * assignments at this school — the join evidence.ts/mappings.ts's 'committee'
 * grant needs (permissions.yaml note: "evaluator:committee resolves through
 * CommitteeMember rows of the target assignment"). Previously deferred (stubbed
 * to always deny) until assignments existed to join against. */
export async function listEvaluateePersonnelIdsForCommitteeMember(
  schoolId: string, evaluatorUserId: string,
): Promise<string[]> {
  const rows = await prisma.evaluationAssignment.findMany({
    where: { schoolId, committee: { some: { evaluatorUserId } } },
    select: { evaluateePersonnelId: true },
    distinct: ['evaluateePersonnelId'],
  });
  return rows.map((r) => r.evaluateePersonnelId);
}
