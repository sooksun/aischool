// Structured PA reports (list/create/get) + on-demand PDF (getReportPdf).
// Payload generation is async via report.generate worker job — HTTP only creates
// the draft + enqueues; PDF is built from payload when ready (SEIP-PDF).
import type { FastifyPluginAsync } from 'fastify';
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
} from '@seip/database';
import { ApiError, forbiddenAreaWrite } from '@seip/backend-shared';
import { requireCurrentSchool } from '../plugins/auth.js';
import { resolveGrant, requireOwnership, requireCommitteeAccessToPersonnel } from '../lib/permission-guard.js';
import { buildPaReportPdf } from '../lib/pa-report-pdf.js';

const TEMPLATE_CODES = ['PA1_s', 'PA1_bs', 'PA2_s', 'PA2_bs', 'PA3_s', 'PA3_bs'] as const;

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

    return {
      ...serializeReport(report),
      payload: report.payload as Record<string, unknown>,
      section_refs: report.sectionRefs.map(serializeSectionRef),
    };
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
        payload: report.payload as Record<string, unknown>,
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
