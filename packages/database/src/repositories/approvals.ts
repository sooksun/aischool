// Report approval (CCR-016 / SEIP-BLOCK-003) — the last of the three blockers the
// 2026-07-19 audit opened.
//
// `prisma.approval` had zero references anywhere: the worker flipped a report
// draft → pending_approval and nothing moved it again, so `approved`, `issued`
// and `superseded` were all unreachable and the whole ApprovalDecision enum was
// unused. SEIP could evaluate a teacher end to end and produce the document, but
// nobody could sign it.
//
// School-scoped by construction, like every other repository here.
import { prisma } from '../client.js';
import { writeAuditEvent } from '../audit.js';
import { enqueueOutboxEvent } from './outbox.js';

/** Only decisions that are actually taken get a row. `pending` is a column
 * default nothing writes, and `rejected` is deliberately unimplemented — see
 * CCR-016 decision 2 and the returnReport contract description. */
export type RecordedDecision = 'approved' | 'returned';

/** SEIP has one approval step. The column stays truthful rather than empty, and
 * a second step later is additive: another value here plus an ordering rule. */
export const APPROVAL_STEP_DIRECTOR = 'director';

export async function listApprovals(reportId: string) {
  return prisma.approval.findMany({
    where: { reportId },
    select: {
      id: true,
      reportId: true,
      approverUserId: true,
      stepCode: true,
      decision: true,
      comment: true,
      decidedAt: true,
    },
    // Oldest first: this is a trail, and a trail reads forwards.
    orderBy: [{ decidedAt: 'asc' }],
  });
}

export type DecisionResult = { ok: true } | { ok: false; reason: 'not_pending' };

/**
 * Records a decision and moves the report, atomically.
 *
 * `updateMany` gated on `status: 'pending_approval'` rather than read-then-write:
 * two directors clicking approve at the same moment must not both write an
 * Approval row against one transition. The loser matches 0 rows and gets RPT-003.
 * Same compare-and-swap shape as the outbox claim and transitionAgreement.
 *
 * The Approval row, the status change, the audit row and (for approvals) the
 * outbox event all commit together — rolling back has to un-say the signature
 * too, or the trail would record an endorsement that never happened.
 */
export async function decideOnReport(input: {
  schoolId: string;
  reportId: string;
  decision: RecordedDecision;
  approverUserId: string;
  comment: string | null;
  requestId?: string;
}): Promise<DecisionResult> {
  const nextStatus = input.decision === 'approved' ? 'approved' : 'draft';

  return prisma.$transaction(async (tx) => {
    const claimed = await tx.report.updateMany({
      where: { id: input.reportId, schoolId: input.schoolId, status: 'pending_approval' },
      data: { status: nextStatus },
    });
    if (claimed.count === 0) return { ok: false, reason: 'not_pending' } as const;

    const approval = await tx.approval.create({
      data: {
        schoolId: input.schoolId,
        reportId: input.reportId,
        approverUserId: input.approverUserId,
        stepCode: APPROVAL_STEP_DIRECTOR,
        decision: input.decision,
        comment: input.comment,
        decidedAt: new Date(),
      },
      select: { id: true, reportId: true, decision: true, stepCode: true },
    });

    await writeAuditEvent(
      {
        schoolId: input.schoolId,
        actorUserId: input.approverUserId,
        action: input.decision === 'approved' ? 'report_approved' : 'report_returned',
        entityType: 'Approval',
        entityId: approval.id,
        after: approval,
        requestId: input.requestId,
      },
      tx,
    );

    if (input.decision === 'approved') {
      const report = await tx.report.findUniqueOrThrow({
        where: { id: input.reportId },
        select: { cycleId: true, subjectPersonnelId: true },
      });
      // Returning a report is deliberately not an event — it is an internal step
      // in a document's drafting, and an event with no consumer is a promise
      // nobody keeps (events.yaml note).
      await enqueueOutboxEvent(
        {
          eventType: 'report.approved',
          schoolId: input.schoolId,
          actorUserId: input.approverUserId,
          payload: {
            report_id: input.reportId,
            cycle_id: report.cycleId,
            subject_personnel_id: report.subjectPersonnelId,
            approver_user_id: input.approverUserId,
            step_code: APPROVAL_STEP_DIRECTOR,
          },
        },
        tx,
      );
    }

    return { ok: true } as const;
  });
}

/**
 * The round a report was generated from, if any.
 *
 * Approval needs this because scores only freeze when a round closes
 * (SCORE-002), and nothing checks round state at report creation or generation.
 * Approving a report built on still-open scores would timestamp a signature
 * against numbers that can still change — the document would end up contradicting
 * its own data with nothing to show for it.
 *
 * Null `roundId` means a cycle-level report: there is no round to freeze, so the
 * caller skips the check rather than failing closed on a rule that does not apply.
 */
export async function getReportRoundStatus(reportId: string): Promise<string | null> {
  const report = await prisma.report.findUnique({
    where: { id: reportId },
    select: { round: { select: { status: true } } },
  });
  return report?.round?.status ?? null;
}
