// EvaluationCycle + EvaluationRound. Cycles carry schoolId directly (SEC-TEN-1,
// folded into every query); rounds carry only cycleId, so round-scoped functions
// resolve tenancy through their parent cycle (mirrors mappings.ts's evidence-relation
// pattern for evidence_indicator_mapping).
import { prisma } from '../client.js';
import type { CycleStatus, EvaluationKind, RoundStatus, Prisma } from '@prisma/client';

export interface ListCyclesFilter {
  fiscalYear?: number;
  evaluationKind?: EvaluationKind;
  status?: CycleStatus;
}

export async function listCycles(schoolId: string, f: ListCyclesFilter) {
  return prisma.evaluationCycle.findMany({
    where: { schoolId, fiscalYear: f.fiscalYear, evaluationKind: f.evaluationKind, status: f.status },
    orderBy: [{ fiscalYear: 'desc' }, { evaluationKind: 'asc' }],
  });
}

/** Throws Prisma P2002 (partial unique index `evaluation_cycle_pa_uk`) if a 'pa'
 * cycle already exists for (school, fiscal_year, framework_version) — the error
 * handler's generic P2002 fallback maps that to RES-002, which is accurate here
 * (no dedicated code exists for this narrower case, and inventing one is not
 * worth a contract change for a fallback that already reads correctly). */
export async function createCycle(schoolId: string, data: {
  frameworkVersionId: string;
  fiscalYear: number;
  evaluationKind: EvaluationKind;
  title: string;
  startsOn: Date;
  endsOn: Date;
}) {
  return prisma.evaluationCycle.create({ data: { schoolId, ...data } });
}

export async function getCycleDetail(schoolId: string, cycleId: string) {
  return prisma.evaluationCycle.findFirst({
    where: { id: cycleId, schoolId },
    include: { rounds: { orderBy: { roundNumber: 'asc' } } },
  });
}

/** updateMany + re-fetch, not update-by-id: keeps the tenancy check "by
 * construction" (no separate exists-check with a TOCTOU gap) — same pattern as
 * evidence.ts's updateEvidence. */
export async function updateCycle(schoolId: string, cycleId: string, patch: {
  title?: string;
  status?: CycleStatus;
  startsOn?: Date;
  endsOn?: Date;
}) {
  const result = await prisma.evaluationCycle.updateMany({ where: { id: cycleId, schoolId }, data: patch });
  if (result.count === 0) return null;
  return getCycleDetail(schoolId, cycleId);
}

/** Tenancy + bounds resolution for round creation — a round has no schoolId of its
 * own, only cycleId, so createRound needs its parent cycle's schoolId (for the
 * grant check) and date bounds (CYCLE-003) before it can act. */
export async function getCycleForRound(cycleId: string) {
  return prisma.evaluationCycle.findUnique({
    where: { id: cycleId },
    select: { id: true, schoolId: true, frameworkVersionId: true, startsOn: true, endsOn: true, status: true },
  });
}

export async function createRound(cycleId: string, data: {
  roundNumber: number;
  purpose: string;
  periodStart: Date;
  periodEnd: Date;
}) {
  return prisma.evaluationRound.create({ data: { cycleId, ...data } });
}

/** Tenancy + validation resolution for updateRound, and (via the same shape) for
 * every scoring route keyed off roundId — a round's own row plus its parent
 * cycle's schoolId/frameworkVersionId/bounds in one query. */
export async function getRoundForAction(roundId: string) {
  return prisma.evaluationRound.findUnique({
    where: { id: roundId },
    include: {
      cycle: { select: { id: true, schoolId: true, frameworkVersionId: true, startsOn: true, endsOn: true } },
    },
  });
}

export async function updateRound(roundId: string, patch: Prisma.EvaluationRoundUpdateInput) {
  return prisma.evaluationRound.update({ where: { id: roundId }, data: patch });
}
