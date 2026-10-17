// P3 analysis, segments and suggestions (ADR-0010; contract 4.0.0 "analysis").
// An analysis runs automatically once an item's file is verified and scanned
// (or a link / note is created), and again on request at most every 10 min
// (AI-002). The worker writes segments and suggestions; the owner accepts a
// suggestion into an owner_confirmed mapping or rejects it with a reason.
import { Prisma, type SegmentKind, type SuggestionRejectReason, type SuggestionStatus } from '@prisma/client';
import { prisma } from '../client.js';
import { enqueueWorkerJob } from './jobs.js';
import { createOwnerMapping } from './mappings.js';
import { enqueueOutboxEvent } from './outbox.js';

type Tx = Prisma.TransactionClient;

export const ANALYSIS_RERUN_COOLDOWN_MS = 10 * 60 * 1000;
const RUNNING = ['queued', 'extracting', 'perceiving', 'mapping', 'validating'] as const;

export async function getLatestAnalysis(evidenceId: string) {
  return prisma.evidenceAnalysis.findFirst({ where: { evidenceId }, orderBy: { createdAt: 'desc' } });
}

export async function getAnalysisById(analysisId: string) {
  return prisma.evidenceAnalysis.findUnique({ where: { id: analysisId } });
}

/**
 * Queue an analysis and its worker job together. An analysis already queued or
 * running is reused, so a burst of uploads to one item runs it once.
 */
export async function requestAnalysis(evidenceId: string, requestedByUserId: string | null, db?: Tx) {
  const run = async (tx: Tx) => {
    const live = await tx.evidenceAnalysis.findFirst({
      where: { evidenceId, status: { in: [...RUNNING] } },
      orderBy: { createdAt: 'desc' },
    });
    if (live) return { analysis: live, reused: true };
    const analysis = await tx.evidenceAnalysis.create({ data: { evidenceId, requestedByUserId } });
    await enqueueWorkerJob({ jobType: 'evidence.analyze', payload: { analysis_id: analysis.id, evidence_id: evidenceId } }, tx);
    return { analysis, reused: false };
  };
  return db ? run(db) : prisma.$transaction(run);
}

export async function listSegments(evidenceId: string, f: { kind?: SegmentKind; cursor?: number; limit: number }) {
  const latest = await prisma.evidenceAnalysis.findFirst({
    where: { evidenceId, status: { in: ['succeeded', 'degraded'] } },
    orderBy: { createdAt: 'desc' },
  });
  if (!latest) return { items: [], nextCursor: null };
  const rows = await prisma.contentSegment.findMany({
    where: { analysisId: latest.id, ...(f.kind ? { kind: f.kind } : {}), ordinal: { gt: f.cursor ?? -1 } },
    orderBy: { ordinal: 'asc' },
    take: f.limit + 1,
  });
  const more = rows.length > f.limit;
  const items = rows.slice(0, f.limit);
  return { items, nextCursor: more ? String(items[items.length - 1].ordinal) : null };
}

export async function listSuggestions(evidenceId: string, status?: SuggestionStatus) {
  return prisma.aiSuggestion.findMany({
    where: { evidenceId, ...(status ? { status } : { status: { not: 'superseded' } }) },
    include: { indicator: { select: { code: true } } },
    orderBy: [{ status: 'asc' }, { calibratedP: { sort: 'desc', nulls: 'last' } }, { createdAt: 'asc' }],
  });
}

export async function getSuggestion(suggestionId: string) {
  return prisma.aiSuggestion.findUnique({
    where: { id: suggestionId },
    include: { indicator: { select: { code: true } } },
  });
}

export type SuggestionDecision<T> = { ok: true; row: T; replayed?: boolean } | { ok: false; reason: 'not_open' | 'map_exists' };

/**
 * Accept: the suggestion and its owner_confirmed mapping (source ai_accepted,
 * locators frozen as locator_snapshot) in one transaction. Losing the
 * open → accepted race is AI-003; a live mapping already on that indicator is
 * MAP-001.
 */
export async function acceptSuggestionToMapping(input: {
  suggestionId: string; ownerUserId: string; schoolId: string; requestId?: string | null;
}): Promise<SuggestionDecision<Awaited<ReturnType<typeof createOwnerMapping>>>> {
  try {
    return await prisma.$transaction(async (tx) => {
      const claimed = await tx.aiSuggestion.updateMany({
        where: { id: input.suggestionId, status: 'open' },
        data: { status: 'accepted', decidedByUserId: input.ownerUserId, decidedAt: new Date() },
      });
      if (claimed.count === 0) throw new NotOpen();
      const s = await tx.aiSuggestion.findUniqueOrThrow({ where: { id: input.suggestionId } });
      const mapping = await createOwnerMapping({
        evidenceId: s.evidenceId, schoolId: input.schoolId, indicatorId: s.indicatorId, frameworkVersionId: s.frameworkVersionId,
        ownerUserId: input.ownerUserId, source: 'ai_accepted', aiSuggestionId: s.id,
        locatorSnapshot: s.locators as Prisma.InputJsonValue, requestId: input.requestId ?? null,
      }, tx);
      return { ok: true as const, row: mapping };
    });
  } catch (e) {
    if (e instanceof NotOpen) return { ok: false, reason: 'not_open' };
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { ok: false, reason: 'map_exists' };
    throw e;
  }
}

class NotOpen extends Error {}

export async function rejectSuggestionWithReason(input: {
  suggestionId: string; userId: string; reasonCode: SuggestionRejectReason; note: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.aiSuggestion.updateMany({
      where: { id: input.suggestionId, status: 'open' },
      data: { status: 'rejected', decidedByUserId: input.userId, decidedAt: new Date() },
    });
    if (claimed.count === 0) return null;
    await tx.suggestionFeedback.create({
      data: { suggestionId: input.suggestionId, userId: input.userId, reasonCode: input.reasonCode, note: input.note },
    });
    return tx.aiSuggestion.findUniqueOrThrow({ where: { id: input.suggestionId }, include: { indicator: { select: { code: true } } } });
  });
}

// ── worker side ──

/** False when the analysis no longer exists (its evidence was deleted): stop quietly. */
export async function setAnalysisStage(analysisId: string, status: (typeof RUNNING)[number], stage: string): Promise<boolean> {
  const r = await prisma.evidenceAnalysis.updateMany({ where: { id: analysisId }, data: { status, stage } });
  return r.count > 0;
}

/** What the worker needs: the item, its scanned originals, and the owner's framework. */
export async function getAnalysisInput(evidenceId: string) {
  const evidence = await prisma.evidence.findFirst({
    where: { id: evidenceId, deletedAt: null },
    include: {
      files: { where: { role: 'original', scanStatus: { in: ['clean', 'unscanned', 'sanitised'] }, sha256VerifiedAt: { not: null } } },
    },
  });
  if (!evidence) return null;
  // The owner's current position decides ว9 (teacher) or ว10 (administrator).
  const personnel = await prisma.personnelProfile.findFirst({
    where: { personId: evidence.ownerPersonId, status: 'active' },
    select: { positionRole: true },
  });
  const framework = personnel
    ? await prisma.frameworkVersion.findFirst({
      where: { roleFamily: personnel.positionRole, status: 'active' },
      orderBy: { effectiveFrom: 'desc' },
      include: { indicators: { select: { id: true, code: true, nameTh: true, indicatorKind: true } } },
    })
    : null;
  return { evidence, framework };
}

export interface NewSegment {
  evidenceFileId: string; kind: SegmentKind; ordinal: number; page: number | null; text: string;
}

export interface NewSuggestion {
  indicatorId: string; band: 'clear' | 'likely' | 'possible'; rationaleTh: string;
  /** Locators with segment_id = the ordinal of a NewSegment; resolved to the stored id here. */
  locators: Array<Record<string, unknown> & { segment_ordinal: number }>;
}

/**
 * Store one finished analysis: its segments, its suggestions (superseding the
 * open ones from earlier runs), and its final status — atomically.
 */
export async function completeAnalysis(input: {
  analysisId: string; evidenceId: string; frameworkVersionId: string | null;
  status: 'succeeded' | 'degraded'; provisional: boolean; modelLabel: string; promptVersion: string; inputSha256: string | null;
  segments: NewSegment[]; suggestions: NewSuggestion[];
  /** FR-028 / CCR-027 — stored on the evidence with the content hash it was found for. */
  injectionReasons?: string[];
}) {
  await prisma.$transaction(async (tx) => {
    const ids = new Map<number, string>();
    for (const seg of input.segments) {
      const row = await tx.contentSegment.create({
        data: { evidenceId: input.evidenceId, analysisId: input.analysisId, evidenceFileId: seg.evidenceFileId, kind: seg.kind, ordinal: seg.ordinal, page: seg.page, text: seg.text },
      });
      ids.set(seg.ordinal, row.id);
    }
    await tx.aiSuggestion.updateMany({ where: { evidenceId: input.evidenceId, status: 'open' }, data: { status: 'superseded' } });
    if (input.frameworkVersionId) {
      for (const s of input.suggestions) {
        await tx.aiSuggestion.create({
          data: {
            evidenceId: input.evidenceId, analysisId: input.analysisId, indicatorId: s.indicatorId, frameworkVersionId: input.frameworkVersionId,
            band: s.band, rationaleTh: s.rationaleTh, provisional: input.provisional, modelLabel: input.modelLabel,
            promptVersion: input.promptVersion, inputSha256: input.inputSha256,
            locators: s.locators.map(({ segment_ordinal, ...l }) => ({ ...l, segment_id: ids.get(segment_ordinal) })) as Prisma.InputJsonValue,
          },
        });
      }
    }
    await tx.evidence.update({
      where: { id: input.evidenceId },
      data: { injectionReasons: input.injectionReasons ?? [], injectionInputSha256: input.inputSha256 },
    });
    await tx.evidenceAnalysis.update({
      where: { id: input.analysisId },
      data: { status: input.status, provisional: input.provisional, stage: null, finishedAt: new Date() },
    });
    const ev = await tx.evidence.findUniqueOrThrow({ where: { id: input.evidenceId }, select: { originSchoolId: true } });
    await enqueueOutboxEvent({
      eventType: 'analysis.completed', schoolId: ev.originSchoolId, actorUserId: null,
      payload: {
        analysis_id: input.analysisId, evidence_id: input.evidenceId, status: input.status,
        suggestion_count: input.frameworkVersionId ? input.suggestions.length : 0,
      },
    }, tx);
  });
}

/** A no-op when the analysis is gone with its deleted evidence (cascade). */
export async function failAnalysis(analysisId: string, errorCode: string) {
  await prisma.evidenceAnalysis.updateMany({ where: { id: analysisId }, data: { status: 'failed', errorCode, finishedAt: new Date() } });
}

/** FR-028: flagged unless a school admin cleared it for this very content. */
export function isInjectionSuspected(e: { injectionReasons: string[]; injectionInputSha256: string | null; injectionClearedSha256: string | null }): boolean {
  return e.injectionReasons.length > 0 && e.injectionInputSha256 !== e.injectionClearedSha256;
}

/** CCR-027: a school admin clears the flag for the content it was raised on. */
export async function clearInjectionFlag(evidenceId: string, userId: string) {
  const e = await prisma.evidence.findUniqueOrThrow({ where: { id: evidenceId } });
  if (!isInjectionSuspected(e)) return { row: e, changed: false };
  const row = await prisma.evidence.update({
    where: { id: evidenceId },
    data: { injectionClearedSha256: e.injectionInputSha256, injectionClearedAt: new Date(), injectionClearedByUserId: userId },
  });
  return { row, changed: true };
}
