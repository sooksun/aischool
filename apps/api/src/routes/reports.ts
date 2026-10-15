// Structured PA reports (list/create/get) + on-demand PDF (getReportPdf).
// Payload generation is async via report.generate worker job — HTTP only creates
// the draft + enqueues; PDF is built from payload when ready (SEIP-PDF).
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  listReports,
  getReportDetail,
  createReportDraft,
  isReportTemplateCode,
  getCycleForRound,
  getRoundForAction,
  getPersonnelById,
  writeAuditEvent,
  listEvaluateePersonnelIdsForCommitteeMember,
  listApprovals, decideOnReport, getReportRoundStatus,
} from '@seip/database';
import { ApiError, coerceReportPayloadV1, forbiddenAreaWrite } from '@seip/backend-shared';
import { requireCurrentSchool } from '../plugins/auth.js';
import { resolveGrant, requireOwnership, requireCommitteeAccessToPersonnel } from '../lib/permission-guard.js';
import { buildPaReportPdf } from '../lib/pa-report-pdf.js';

const TEMPLATE_CODES = ['PA1_s', 'PA1_bs', 'PA2_s', 'PA2_bs', 'PA3_s', 'PA3_bs'] as const;

function serializeApproval(a: {
  id: string; reportId: string; approverUserId: string;
  stepCode: string; decision: string; comment: string | null;
  // Nullable in the schema because the column has to accommodate a `pending`
  // row. Nothing writes one — decideOnReport only ever records a decision that
  // was actually taken — but the API shape stays truthful to the column rather
  // than asserting a timestamp that could be absent.
  decidedAt: Date | null;
}) {
  return {
    id: a.id,
    report_id: a.reportId,
    approver_user_id: a.approverUserId,
    step_code: a.stepCode,
    decision: a.decision,
    comment: a.comment,
    decided_at: a.decidedAt ? a.decidedAt.toISOString() : null,
  };
}

function serializeReport(r: {
  id: string;
  schoolId: string;
  cycleId: string;
  roundId: string | null;
  subjectPersonnelId: string;
  templateCode: string;
  status: string;
  generatedAt: Date;
}) {
  return {
    id: r.id,
    school_id: r.schoolId,
    cycle_id: r.cycleId,
    round_id: r.roundId,
    subject_personnel_id: r.subjectPersonnelId,
    template_code: r.templateCode,
    status: r.status,
    generated_at: r.generatedAt.toISOString(),
  };
}

function serializeSectionRef(s: {
  id: string;
  reportId: string;
  evidenceId: string | null;
  mappingId: string | null;
  sectionKey: string;
  sortOrder: number;
}) {
  return {
    id: s.id,
    report_id: s.reportId,
    evidence_id: s.evidenceId,
    mapping_id: s.mappingId,
    section_key: s.sectionKey,
    sort_order: s.sortOrder,
  };
}

export const reportRoutes: FastifyPluginAsync = async (app) => {
  app.get('/reports', { config: { operationId: 'listReports' } }, async (request) => {
    const auth = request.auth!;
    const schoolId = requireCurrentSchool(auth);
    const grant = await resolveGrant('listReports', auth, schoolId);

    const q = z.object({
      cycle_id: z.string().uuid().optional(),
      subject_personnel_id: z.string().uuid().optional(),
      status: z.enum(['draft', 'pending_approval', 'approved', 'issued', 'superseded']).optional(),
      template_code: z.enum(TEMPLATE_CODES).optional(),
      page: z.coerce.number().int().min(1).default(1),
      page_size: z.coerce.number().int().min(1).max(100).default(20),
    }).parse(request.query);

    let subjectPersonnelIdIn: string[] | undefined;
    if (grant === 'own') {
      if (!auth.personnel) throw new ApiError('PERM-001', 'Role not allowed for this operation');
      subjectPersonnelIdIn = [auth.personnel.id];
    } else if (grant === 'committee') {
      subjectPersonnelIdIn = await listEvaluateePersonnelIdsForCommitteeMember(schoolId, auth.userId);
    }

    const { items, total } = await listReports(schoolId, {
      cycleId: q.cycle_id,
      subjectPersonnelId: q.subject_personnel_id,
      status: q.status,
      templateCode: q.template_code,
      subjectPersonnelIdIn,
      page: q.page,
      pageSize: q.page_size,
    });
    return {
      items: items.map(serializeReport),
      meta: { page: q.page, page_size: q.page_size, total },
    };
  });

  app.post('/reports', { config: { operationId: 'createReport' } }, async (request, reply) => {
    const auth = request.auth!;
    const schoolId = requireCurrentSchool(auth);
    const grant = await resolveGrant('createReport', auth, schoolId);
    if (grant === 'area-r') throw forbiddenAreaWrite();

    const body = z.object({
      cycle_id: z.string().uuid(),
      round_id: z.string().uuid().nullable().optional(),
      subject_personnel_id: z.string().uuid(),
      template_code: z.enum(TEMPLATE_CODES),
    }).parse(request.body);

    if (!isReportTemplateCode(body.template_code)) {
      throw new ApiError('RPT-001', 'Unknown report template_code');
    }

    const cycle = await getCycleForRound(body.cycle_id);
    if (!cycle || cycle.schoolId !== schoolId) {
      throw new ApiError('RES-001', 'Cycle not found');
    }

    const subject = await getPersonnelById(body.subject_personnel_id);
    if (!subject || subject.schoolId !== schoolId) {
      throw new ApiError('RES-001', 'Subject personnel not found');
    }

    let roundId: string | null = body.round_id ?? null;
    if (roundId) {
      const round = await getRoundForAction(roundId);
      if (!round || round.cycle.schoolId !== schoolId || round.cycleId !== body.cycle_id) {
        throw new ApiError('RPT-001', 'round_id does not belong to the given cycle');
      }
    }

    const report = await createReportDraft({
      schoolId,
      cycleId: body.cycle_id,
      roundId,
      subjectPersonnelId: body.subject_personnel_id,
      templateCode: body.template_code,
      actorUserId: auth.userId,
      requestId: request.id,
    });

    await writeAuditEvent({
      schoolId,
      actorUserId: auth.userId,
      action: 'created',
      entityType: 'Report',
      entityId: report.id,
      after: report,
      requestId: request.id,
    });

    reply.status(201).send(serializeReport(report));
  });

  app.get('/reports/:reportId', { config: { operationId: 'getReport' } }, async (request) => {
    const auth = request.auth!;
    const schoolId = requireCurrentSchool(auth);
    const grant = await resolveGrant('getReport', auth, schoolId);
    const { reportId } = z.object({ reportId: z.string().uuid() }).parse(request.params);

    const report = await getReportDetail(schoolId, reportId);
    if (!report) throw new ApiError('RES-001', 'Report not found');

    if (grant === 'own') {
      requireOwnership(auth, report.subjectPersonnelId);
    } else if (grant === 'committee') {
      await requireCommitteeAccessToPersonnel(schoolId, auth.userId, report.subjectPersonnelId);
    }

    // ReportPayloadV1 — single typed shape for worker → DB → API → PDF/UI (cleanup M2).
    const payload = coerceReportPayloadV1(report.payload);
    return {
      ...serializeReport(report),
      payload,
      section_refs: report.sectionRefs.map(serializeSectionRef),
      // CCR-016: inlined so a client can render "who signed this and when"
      // without a second round trip.
      approvals: (await listApprovals(reportId)).map(serializeApproval),
    };
  });

  app.get('/reports/:reportId/approvals', { config: { operationId: 'listReportApprovals' } }, async (request) => {
    const auth = request.auth!;
    const schoolId = requireCurrentSchool(auth);
    const grant = await resolveGrant('listReportApprovals', auth, schoolId);
    const { reportId } = z.object({ reportId: z.string().uuid() }).parse(request.params);

    const report = await getReportDetail(schoolId, reportId);
    if (!report) throw new ApiError('RES-001', 'Report not found');

    // Same ownership shape as getReport — the subject may read who endorsed their
    // own result. Being able to see your score but not its signature would be a
    // strange sort of transparency.
    if (grant === 'own') {
      requireOwnership(auth, report.subjectPersonnelId);
    } else if (grant === 'committee') {
      await requireCommitteeAccessToPersonnel(schoolId, auth.userId, report.subjectPersonnelId);
    }

    return (await listApprovals(reportId)).map(serializeApproval);
  });

  /**
   * approve and return share every precondition except the decision itself, so
   * they share an implementation. Splitting them into two endpoints (rather than
   * one taking a `decision` field) keeps `comment` required on return and
   * optional on approve, which is the one place they genuinely differ.
   */
  async function decide(
    request: FastifyRequest,
    operationId: 'approveReport' | 'returnReport',
    decision: 'approved' | 'returned',
    comment: string | null,
  ) {
    const auth = request.auth!;
    const schoolId = requireCurrentSchool(auth);
    const grant = await resolveGrant(operationId, auth, schoolId);
    if (grant === 'area-r') throw forbiddenAreaWrite();

    const { reportId } = z.object({ reportId: z.string().uuid() }).parse(request.params);
    const report = await getReportDetail(schoolId, reportId);
    if (!report) throw new ApiError('RES-001', 'Report not found');

    // A director is an evaluatee too under ว10, so `director: school` would
    // otherwise let them sign their own PA report. permissions.yaml has no way to
    // say "any grant except over yourself", so it lives here — same rule and same
    // reasoning as acknowledgeAgreement (CCR-015).
    if (auth.personnel && auth.personnel.id === report.subjectPersonnelId) {
      throw new ApiError('RPT-003', 'You cannot decide on your own report — another director or the school admin must');
    }

    // The rule this CCR exists for. Scores stay mutable until the round closes
    // (SCORE-002) and nothing checks round state when a report is generated, so
    // approving earlier would timestamp an endorsement of numbers that can still
    // change. Returning is exempt: sending a document back for rework says
    // nothing about the scores, and blocking it would strand reports generated
    // mid-round with no way out.
    if (decision === 'approved') {
      const roundStatus = await getReportRoundStatus(reportId);
      // null = cycle-level report, no round to freeze.
      if (roundStatus !== null && roundStatus !== 'closed') {
        throw new ApiError('RPT-003', 'Cannot approve until the round is closed — scores are still editable until then');
      }
    }

    const result = await decideOnReport({
      schoolId, reportId, decision, approverUserId: auth.userId, comment, requestId: request.id,
    });
    if (!result.ok) {
      throw new ApiError('RPT-003', 'Report is not awaiting approval');
    }

    const updated = await getReportDetail(schoolId, reportId);
    return {
      ...serializeReport(updated!),
      payload: coerceReportPayloadV1(updated!.payload),
      section_refs: updated!.sectionRefs.map(serializeSectionRef),
      approvals: (await listApprovals(reportId)).map(serializeApproval),
    };
  }

  app.post('/reports/:reportId/approve', { config: { operationId: 'approveReport' } }, async (request) => {
    const body = z.object({ comment: z.string().max(2000).nullish() }).parse(request.body ?? {});
    return decide(request, 'approveReport', 'approved', body.comment ?? null);
  });

  app.post('/reports/:reportId/return', { config: { operationId: 'returnReport' } }, async (request) => {
    // Required here, unlike approve: handing a result back with no stated reason
    // leaves the person who has to fix it nothing to act on.
    const body = z.object({ comment: z.string().min(1).max(2000) }).parse(request.body);
    return decide(request, 'returnReport', 'returned', body.comment);
  });

  app.get('/reports/:reportId/pdf', { config: { operationId: 'getReportPdf' } }, async (request, reply) => {
    const auth = request.auth!;
    const schoolId = requireCurrentSchool(auth);
    const grant = await resolveGrant('getReportPdf', auth, schoolId);
    const { reportId } = z.object({ reportId: z.string().uuid() }).parse(request.params);

    const report = await getReportDetail(schoolId, reportId);
    if (!report) throw new ApiError('RES-001', 'Report not found');

    if (grant === 'own') {
      requireOwnership(auth, report.subjectPersonnelId);
    } else if (grant === 'committee') {
      await requireCommitteeAccessToPersonnel(schoolId, auth.userId, report.subjectPersonnelId);
    } else if (grant === 'area-r') {
      // read-only OK for PDF download
    }

    try {
      const pdf = await buildPaReportPdf({
        id: report.id,
        templateCode: report.templateCode,
        status: report.status,
        generatedAt: report.generatedAt,
        payload: coerceReportPayloadV1(report.payload),
        // CCR-016: so the document can state who endorsed it, not just that its
        // status says approved.
        approvals: (await listApprovals(reportId)).map((a) => ({
          decision: a.decision,
          approverUserId: a.approverUserId,
          decidedAt: a.decidedAt,
        })),
        sectionRefs: report.sectionRefs.map((s) => ({
          sectionKey: s.sectionKey,
          evidenceId: s.evidenceId,
          mappingId: s.mappingId,
          sortOrder: s.sortOrder,
        })),
      });
      const filename = `${report.templateCode}-${report.id.slice(0, 8)}.pdf`;
      reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', `attachment; filename="${filename}"`)
        .header('cache-control', 'private, no-store')
        .send(pdf);
    } catch (e) {
      if (e instanceof Error && e.message === 'REPORT_NOT_READY') {
        throw new ApiError('RPT-002', 'Report PDF not ready — still generating');
      }
      throw e;
    }
  });
};
