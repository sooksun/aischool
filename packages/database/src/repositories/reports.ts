// Report + ReportSectionRef — structured PA payloads; evidence cited by reference only.
import { randomUUID } from 'node:crypto';
import type { Prisma, ReportStatus } from '@prisma/client';
import { prisma } from '../client.js';
import { enqueueWorkerJob } from './jobs.js';
import { enqueueOutboxEvent } from './outbox.js';

export const REPORT_TEMPLATE_CODES = [
  'PA1_s', 'PA1_bs', 'PA2_s', 'PA2_bs', 'PA3_s', 'PA3_bs',
] as const;
export type ReportTemplateCode = (typeof REPORT_TEMPLATE_CODES)[number];

export function isReportTemplateCode(v: string): v is ReportTemplateCode {
  return (REPORT_TEMPLATE_CODES as readonly string[]).includes(v);
}

export interface ListReportsFilter {
  cycleId?: string;
  subjectPersonnelId?: string;
  status?: ReportStatus;
  templateCode?: string;
  /** 'own' grant: force subject = caller's personnel */
  subjectPersonnelIdIn?: string[];
  page: number;
  pageSize: number;
}

export async function listReports(schoolId: string, f: ListReportsFilter) {
  const where: Prisma.ReportWhereInput = {
    schoolId,
    cycleId: f.cycleId,
    status: f.status,
    templateCode: f.templateCode,
    subjectPersonnelId: f.subjectPersonnelId,
    ...(f.subjectPersonnelIdIn
      ? { subjectPersonnelId: { in: f.subjectPersonnelIdIn } }
      : {}),
  };
  // If both subjectPersonnelId and subjectPersonnelIdIn are set, narrow to intersection
  if (f.subjectPersonnelId && f.subjectPersonnelIdIn) {
    if (!f.subjectPersonnelIdIn.includes(f.subjectPersonnelId)) {
      return { items: [], total: 0 };
    }
    where.subjectPersonnelId = f.subjectPersonnelId;
  }

  const [items, total] = await Promise.all([
    prisma.report.findMany({
      where,
      orderBy: { generatedAt: 'desc' },
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
    }),
    prisma.report.count({ where }),
  ]);
  return { items, total };
}

export async function getReportDetail(schoolId: string, reportId: string) {
  return prisma.report.findFirst({
    where: { id: reportId, schoolId },
    include: { sectionRefs: { orderBy: { sortOrder: 'asc' } } },
  });
}

export async function getReportById(reportId: string) {
  return prisma.report.findUnique({
    where: { id: reportId },
    include: { sectionRefs: { orderBy: { sortOrder: 'asc' } } },
  });
}

/** Create draft + enqueue report.generate in one transaction. */
export async function createReportDraft(input: {
  schoolId: string;
  cycleId: string;
  roundId: string | null;
  subjectPersonnelId: string;
  templateCode: ReportTemplateCode;
  actorUserId: string | null;
  requestId?: string | null;
}) {
  const reportId = randomUUID();
  const jobId = randomUUID();

  const report = await prisma.$transaction(async (tx) => {
    const row = await tx.report.create({
      data: {
        id: reportId,
        schoolId: input.schoolId,
        cycleId: input.cycleId,
        roundId: input.roundId,
        subjectPersonnelId: input.subjectPersonnelId,
        templateCode: input.templateCode,
        status: 'draft',
        payload: {
          schema_version: 1,
          generation_status: 'pending',
          template_code: input.templateCode,
        },
      },
    });
    await enqueueWorkerJob(
      {
        id: jobId,
        jobType: 'report.generate',
        payload: {
          report_id: reportId,
          school_id: input.schoolId,
          actor_user_id: input.actorUserId,
          request_id: input.requestId ?? null,
        },
      },
      tx,
    );
    return row;
  });

  return report;
}

/** Build structured payload from confirmed mappings + assignment results (worker). */
export async function generateReportPayload(reportId: string) {
  const report = await prisma.report.findUnique({
    where: { id: reportId },
    include: {
      subject: { select: { id: true, fullName: true, positionRole: true, rankLevelCode: true } },
      cycle: {
        select: {
          id: true,
          title: true,
          fiscalYear: true,
          evaluationKind: true,
          frameworkVersionId: true,
          framework: { select: { code: true, roleFamily: true, legalRef: true } },
        },
      },
      round: { select: { id: true, roundNumber: true, purpose: true, status: true } },
    },
  });
  if (!report) return null;

  // Confirmed mappings for this subject in the cycle (evidence owner = subject)
  const mappings = await prisma.evidenceIndicatorMapping.findMany({
    where: {
      schoolId: report.schoolId,
      cycleId: report.cycleId,
      status: 'confirmed',
      evidence: { ownerPersonnelId: report.subjectPersonnelId },
    },
    include: {
      evidence: { select: { id: true, title: true, categoryId: true } },
      indicator: { select: { id: true, code: true, nameTh: true } },
    },
    orderBy: { confirmedAt: 'asc' },
  });

  // Assignment results for subject in cycle (optionally scoped to round)
  const assignmentWhere: Prisma.EvaluationAssignmentWhereInput = {
    schoolId: report.schoolId,
    evaluateePersonnelId: report.subjectPersonnelId,
    round: {
      cycleId: report.cycleId,
      ...(report.roundId ? { id: report.roundId } : {}),
    },
  };
  const assignments = await prisma.evaluationAssignment.findMany({
    where: assignmentWhere,
    include: {
      round: { select: { id: true, roundNumber: true, purpose: true } },
      results: true,
      committee: true,
    },
  });

  const payload = {
    schema_version: 1,
    generation_status: 'ready',
    template_code: report.templateCode,
    subject: {
      personnel_id: report.subject.id,
      full_name: report.subject.fullName,
      position_role: report.subject.positionRole,
      rank_level_code: report.subject.rankLevelCode,
    },
    cycle: {
      id: report.cycle.id,
      title: report.cycle.title,
      fiscal_year: report.cycle.fiscalYear,
      evaluation_kind: report.cycle.evaluationKind,
      framework_code: report.cycle.framework.code,
      framework_legal_ref: report.cycle.framework.legalRef,
    },
    round: report.round
      ? {
          id: report.round.id,
          round_number: report.round.roundNumber,
          purpose: report.round.purpose,
          status: report.round.status,
        }
      : null,
    confirmed_mappings: mappings.map((m) => ({
      mapping_id: m.id,
      evidence_id: m.evidenceId,
      evidence_title: m.evidence.title,
      indicator_id: m.indicatorId,
      indicator_code: m.indicator.code,
      indicator_name_th: m.indicator.nameTh,
      confirmed_at: m.confirmedAt?.toISOString() ?? null,
    })),
    assignments: assignments.map((a) => ({
      assignment_id: a.id,
      round_id: a.roundId,
      round_number: a.round.roundNumber,
      status: a.status,
      committee_size: a.committee.length,
      evaluator_results: a.results.map((r) => ({
        evaluator_user_id: r.evaluatorUserId,
        part1_percent: Number(r.part1Percent),
        part2_percent: Number(r.part2Percent),
        total_percent: Number(r.totalPercent),
        passed_individual_threshold: r.passedIndividualThreshold,
        computed_at: r.computedAt.toISOString(),
      })),
    })),
    generated_at: new Date().toISOString(),
  };

  // Replace section refs (idempotent retries: wipe + recreate)
  const sectionData = mappings.map((m, idx) => ({
    id: randomUUID(),
    reportId,
    evidenceId: m.evidenceId,
    mappingId: m.id,
    sectionKey: `indicator:${m.indicator.code}`,
    sortOrder: idx + 1,
  }));

  await prisma.$transaction(async (tx) => {
    await tx.reportSectionRef.deleteMany({ where: { reportId } });
    if (sectionData.length > 0) {
      await tx.reportSectionRef.createMany({ data: sectionData });
    }
    // draft → pending_approval once payload is ready (approval workflow is later)
    await tx.report.update({
      where: { id: reportId },
      data: {
        payload: payload as Prisma.InputJsonValue,
        status: 'pending_approval',
        generatedAt: new Date(),
      },
    });
    await enqueueOutboxEvent(
      {
        eventType: 'report.generated',
        schoolId: report.schoolId,
        actorUserId: null,
        payload: {
          report_id: reportId,
          cycle_id: report.cycleId,
          subject_personnel_id: report.subjectPersonnelId,
          template_code: report.templateCode,
          status: 'pending_approval',
        },
      },
      tx,
    );
  });

  return getReportById(reportId);
}
