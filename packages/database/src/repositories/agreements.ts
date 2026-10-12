// PerformanceAgreement (แบบ PA1) + AgreementChallenge (ประเด็นท้าทาย) — CCR-015.
//
// These two models existed in the schema since DB-001 with zero references
// anywhere in apps/ or packages/. That absence was SEIP-BLOCK-002: it made
// submitMyScores unreachable (no agreement -> no workload declaration ->
// SCORE-004), and it meant the committee scored indicators C.1/C.2.1/C.2.2 —
// 40% of a teacher's result — without ever seeing the method and targets those
// indicators rate.
//
// School-scoped by construction like evidence and cycles: schoolId is the first
// parameter of every read and folds into the WHERE (SEC-TEN-1).
import type { Prisma } from '@prisma/client';
import { prisma } from '../client.js';
import { writeAuditEvent } from '../audit.js';

const CHALLENGE_SELECT = {
  id: true,
  indicatorId: true,
  title: true,
  methodPlan: true,
  quantitativeTarget: true,
  qualitativeTarget: true,
  targetGroup: true,
  periodNote: true,
} as const;

const AGREEMENT_SELECT = {
  id: true,
  schoolId: true,
  cycleId: true,
  personnelId: true,
  formVariant: true,
  status: true,
  submittedAt: true,
  challenges: { select: CHALLENGE_SELECT },
} as const;

export interface ChallengeInput {
  title: string;
  methodPlan: string;
  quantitativeTarget?: string | null;
  qualitativeTarget?: string | null;
  targetGroup?: string | null;
  periodNote?: string | null;
}

export interface ListAgreementsFilter {
  cycleId?: string;
  status?: 'draft' | 'submitted' | 'acknowledged';
  /** 'own' grant: restrict to this personnel row. */
  personnelId?: string;
  /** 'committee' grant: restrict to evaluatees this user actually sits for. */
  committeeEvaluatorUserId?: string;
}

export async function listAgreements(schoolId: string, f: ListAgreementsFilter = {}) {
  const where: Prisma.PerformanceAgreementWhereInput = {
    schoolId,
    cycleId: f.cycleId,
    status: f.status,
    personnelId: f.personnelId,
    ...(f.committeeEvaluatorUserId
      ? {
          // An evaluator may read the agreement of anyone whose committee they
          // sit on — the same relation listAssignmentsForRound uses, so the two
          // grants cannot drift apart.
          personnel: {
            assignments: { some: { committee: { some: { evaluatorUserId: f.committeeEvaluatorUserId } } } },
          },
        }
      : {}),
  };
  return prisma.performanceAgreement.findMany({
    where,
    select: AGREEMENT_SELECT,
    orderBy: [{ submittedAt: 'desc' }, { id: 'asc' }],
  });
}

/** Scoped by schoolId so a valid id from another school misses and the route
 * returns RES-001 rather than confirming the row exists (SEC-TEN-2). */
export async function getAgreement(schoolId: string, agreementId: string) {
  return prisma.performanceAgreement.findFirst({
    where: { id: agreementId, schoolId },
    select: AGREEMENT_SELECT,
  });
}

/** The lookup that replaces the client-supplied `agreement_id` removed from
 * AssignmentCreate in contract 3.0.0. PerformanceAgreement is unique per
 * (cycle, personnel), so this is exact — there is nothing for a caller to
 * choose, which is precisely why the field is gone. */
export async function findAgreementForCycleAndPersonnel(cycleId: string, personnelId: string) {
  return prisma.performanceAgreement.findUnique({
    where: { cycleId_personnelId: { cycleId, personnelId } },
    select: { id: true, status: true },
  });
}

export type CreateAgreementResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'duplicate' };

export async function createAgreement(input: {
  schoolId: string;
  cycleId: string;
  personnelId: string;
  formVariant: string;
  challenge?: ChallengeInput;
  /** The framework's วิธีดำเนินการ indicator; required only when a challenge is given. */
  challengeIndicatorId?: string;
  actorUserId: string;
  requestId?: string;
}): Promise<CreateAgreementResult> {
  return prisma.$transaction(async (tx) => {
    const clash = await tx.performanceAgreement.findUnique({
      where: { cycleId_personnelId: { cycleId: input.cycleId, personnelId: input.personnelId } },
      select: { id: true },
    });
    if (clash) return { ok: false, reason: 'duplicate' } as const;

    const agreement = await tx.performanceAgreement.create({
      data: {
        schoolId: input.schoolId,
        cycleId: input.cycleId,
        personnelId: input.personnelId,
        formVariant: input.formVariant,
        status: 'draft',
        ...(input.challenge && input.challengeIndicatorId
          ? { challenges: { create: { indicatorId: input.challengeIndicatorId, ...input.challenge } } }
          : {}),
      },
      select: { id: true, schoolId: true, cycleId: true, personnelId: true, status: true },
    });

    await writeAuditEvent(
      {
        schoolId: input.schoolId,
        actorUserId: input.actorUserId,
        action: 'agreement_created',
        entityType: 'PerformanceAgreement',
        entityId: agreement.id,
        after: agreement,
        requestId: input.requestId,
      },
      tx,
    );
    return { ok: true, id: agreement.id } as const;
  });
}

/** Replaces the challenge wholesale rather than patching fields: the challenge is
 * one statement, and a partial update would let a target drift out of step with
 * the method it belongs to. Draft-only — the route checks status first. */
export async function upsertChallenge(
  agreementId: string,
  challengeIndicatorId: string,
  challenge: ChallengeInput,
) {
  const existing = await prisma.agreementChallenge.findFirst({
    where: { agreementId },
    select: { id: true },
  });
  if (existing) {
    return prisma.agreementChallenge.update({
      where: { id: existing.id },
      data: { indicatorId: challengeIndicatorId, ...challenge },
      select: CHALLENGE_SELECT,
    });
  }
  return prisma.agreementChallenge.create({
    data: { agreementId, indicatorId: challengeIndicatorId, ...challenge },
    select: CHALLENGE_SELECT,
  });
}

/**
 * draft -> submitted, or submitted -> acknowledged.
 *
 * updateMany with the expected `from` status in the WHERE, not read-then-write:
 * two concurrent submits (a double-clicked button) must not both succeed, and the
 * loser has to see AGR-002 rather than silently overwrite `submittedAt`. Same
 * compare-and-swap shape as the outbox claim.
 */
export async function transitionAgreement(
  schoolId: string,
  agreementId: string,
  from: 'draft' | 'submitted',
  to: 'submitted' | 'acknowledged',
  actorUserId: string,
  requestId?: string,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.performanceAgreement.updateMany({
      where: { id: agreementId, schoolId, status: from },
      data: { status: to, ...(to === 'submitted' ? { submittedAt: new Date() } : {}) },
    });
    if (claimed.count === 0) return false;

    await writeAuditEvent(
      {
        schoolId,
        actorUserId,
        action: to === 'submitted' ? 'agreement_submitted' : 'agreement_acknowledged',
        entityType: 'PerformanceAgreement',
        entityId: agreementId,
        before: { id: agreementId, schoolId, status: from },
        after: { id: agreementId, schoolId, status: to },
        requestId,
      },
      tx,
    );
    return true;
  });
}

/** The framework's single วิธีดำเนินการ indicator — the anchor a challenge is
 * filed under (CCR-015 decision 1). Selected by kind and lowest sort order rather
 * than by hard-coded code, because ADR-0003 makes the taxonomy data: a future
 * framework version may rename T-C.1 without changing what it means. */
export async function findChallengeAnchorIndicator(frameworkVersionId: string) {
  return prisma.indicator.findFirst({
    where: { frameworkVersionId, indicatorKind: 'challenge' },
    select: { id: true, code: true },
    orderBy: { sortOrder: 'asc' },
  });
}
