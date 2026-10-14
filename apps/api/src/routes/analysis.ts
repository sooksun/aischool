// P3 analysis and AI suggestions (ADR-0010; contract 4.0.0 "analysis" tag).
//
//   requestEvidenceAnalysis   re-run (it also runs by itself after verify + scan,
//                             and when a link or note is created); ≤ once / 10 min
//   getEvidenceAnalysis       progress of one run
//   listEvidenceSegments      locator targets; the text only for the owner
//   listEvidenceSuggestions   open / decided suggestions with validated locators
//   acceptSuggestion(s)       the OWNER turns a suggestion into an owner_confirmed
//                             mapping (source ai_accepted) — AI never confirms
//   rejectSuggestion          with a reason, which feeds calibration
//
// Until the in-country model tier exists every run finishes `degraded` on the
// local_heuristic floor and its suggestions are provisional. calibrated_p and
// rationale_th are for the owner alone; nobody else sees AI confidence.
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  getEvidenceDetail, getLatestAnalysis, getAnalysisById, requestAnalysis, listSegments, listSuggestions,
  getSuggestion, acceptSuggestionToMapping, rejectSuggestionWithReason, writeAuditEvent, ANALYSIS_RERUN_COOLDOWN_MS, redactPii, isInjectionSuspected,
} from '@seip/database';
import { ApiError, forbiddenAreaWrite } from '@seip/backend-shared';
import type { AuthedRequest } from '../plugins/auth.js';
import { requireCurrentSchool } from '../plugins/auth.js';
import { authorizeEvidence, isOwner } from '../lib/evidence-access.js';
import { resolveGrant } from '../lib/permission-guard.js';
import { idempotent } from '../lib/concurrency.js';
import { serializeMapping } from './evidence.js';

type Analysis = NonNullable<Awaited<ReturnType<typeof getAnalysisById>>>;
type Suggestion = NonNullable<Awaited<ReturnType<typeof getSuggestion>>>;
type Segment = Awaited<ReturnType<typeof listSegments>>['items'][number];

export function serializeAnalysis(a: Analysis) {
  return {
    id: a.id,
    evidence_id: a.evidenceId,
    status: a.status,
    stage: a.stage,
    provisional: a.provisional,
    error_code: a.errorCode,
    eta_seconds: null,
    queue_position: null,
    created_at: a.createdAt.toISOString(),
    finished_at: a.finishedAt?.toISOString() ?? null,
  };
}

/**
 * Batch accept needs band `clear` AND a passed pre-tick gate for the indicator
 * (plan §3 step 5: precision ≥ 0.85 on ≥ 50 pilot items). No gate has been run
 * yet, so nothing is batch-acceptable; the gate table arrives with the pilot.
 */
function batchAcceptable(s: Pick<Suggestion, 'band'>, injectionSuspected: boolean): boolean {
  const gatePassed = false;
  // FR-028: nothing on an item flagged for hidden instructions is batch-accepted.
  return s.band === 'clear' && gatePassed && !injectionSuspected;
}

export function serializeSuggestion(s: Suggestion, owner: boolean, injectionSuspected = false) {
  return {
    id: s.id,
    evidence_id: s.evidenceId,
    indicator_id: s.indicatorId,
    indicator_code: s.indicator.code,
    framework_version_id: s.frameworkVersionId,
    band: s.band,
    support: s.support,
    batch_acceptable: batchAcceptable(s, injectionSuspected),
    calibrated_p: owner ? s.calibratedP : null,
    rationale_th: owner ? s.rationaleTh : null,
    locators: (s.locators ?? []) as unknown[],
    model_label: s.modelLabel,
    prompt_version: s.promptVersion,
    provisional: s.provisional,
    status: s.status,
    created_at: s.createdAt.toISOString(),
  };
}

function serializeSegment(g: Segment, owner: boolean) {
  return {
    id: g.id,
    evidence_file_id: g.evidenceFileId,
    kind: g.kind,
    confidence: g.confidence,
    // FR-023a: the owner reads their own text; everyone else (director,
    // committee) gets it with national ids, phones and emails masked.
    text: owner || g.text === null ? g.text : redactPii(g.text).text,
    locator: {
      segment_id: g.id,
      kind: g.tStartMs !== null ? 'time' : 'page',
      page: g.page,
      t_start_ms: g.tStartMs,
      t_end_ms: g.tEndMs,
      frame_ms: g.frameMs,
      bbox: (g.bbox ?? null) as number[] | null,
      quote: null,
      match_span: null,
    },
  };
}

async function evidenceFor(evidenceId: string) {
  const evidence = await getEvidenceDetail(evidenceId);
  if (!evidence) throw new ApiError('RES-001', 'Evidence not found');
  return evidence;
}

/** The suggestion and its evidence, authorized for `operationId`; another person's is RES-001. */
async function suggestionFor(operationId: string, auth: AuthedRequest, suggestionId: string) {
  const s = await getSuggestion(suggestionId);
  if (!s) throw new ApiError('RES-001', 'Suggestion not found');
  const evidence = await evidenceFor(s.evidenceId);
  await authorizeEvidence(operationId, auth, evidence);
  return { s, evidence };
}

export const analysisRoutes: FastifyPluginAsync = async (app) => {
  app.post('/evidence/:evidenceId/analysis', { config: { operationId: 'requestEvidenceAnalysis' } }, async (request, reply) => {
    const auth = request.auth!;
    const { evidenceId } = z.object({ evidenceId: z.string().uuid() }).parse(request.params);
    const evidence = await evidenceFor(evidenceId);
    const grant = await authorizeEvidence('requestEvidenceAnalysis', auth, evidence);
    if (grant === 'area-r') throw forbiddenAreaWrite();
    const latest = await getLatestAnalysis(evidenceId);
    if (latest && Date.now() - latest.createdAt.getTime() < ANALYSIS_RERUN_COOLDOWN_MS) {
      const wait = Math.ceil((ANALYSIS_RERUN_COOLDOWN_MS - (Date.now() - latest.createdAt.getTime())) / 1000);
      reply.header('Retry-After', String(wait));
      throw new ApiError('AI-002', 'Analysis re-run throttled — at most once per 10 minutes per evidence');
    }
    const { analysis } = await requestAnalysis(evidenceId, auth.userId);
    reply.status(202);
    return serializeAnalysis(analysis);
  });

  app.get('/analyses/:analysisId', { config: { operationId: 'getEvidenceAnalysis' } }, async (request) => {
    const auth = request.auth!;
    const { analysisId } = z.object({ analysisId: z.string().uuid() }).parse(request.params);
    const analysis = await getAnalysisById(analysisId);
    if (!analysis) throw new ApiError('RES-001', 'Analysis not found');
    await authorizeEvidence('getEvidenceAnalysis', auth, await evidenceFor(analysis.evidenceId));
    return serializeAnalysis(analysis);
  });

  app.get('/evidence/:evidenceId/segments', { config: { operationId: 'listEvidenceSegments' } }, async (request) => {
    const auth = request.auth!;
    const { evidenceId } = z.object({ evidenceId: z.string().uuid() }).parse(request.params);
    const q = z.object({
      kind: z.enum(['page_block', 'transcript', 'keyframe', 'image_caption', 'sheet_range', 'note', 'link_text']).optional(),
      cursor: z.string().regex(/^\d+$/).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }).parse(request.query);
    const evidence = await evidenceFor(evidenceId);
    await authorizeEvidence('listEvidenceSegments', auth, evidence);
    const page = await listSegments(evidenceId, { kind: q.kind, cursor: q.cursor ? Number(q.cursor) : undefined, limit: q.limit });
    const owner = isOwner(auth, evidence);
    return { items: page.items.map((g) => serializeSegment(g, owner)), next_cursor: page.nextCursor };
  });

  app.get('/evidence/:evidenceId/suggestions', { config: { operationId: 'listEvidenceSuggestions' } }, async (request) => {
    const auth = request.auth!;
    const { evidenceId } = z.object({ evidenceId: z.string().uuid() }).parse(request.params);
    const q = z.object({ status: z.enum(['open', 'accepted', 'rejected', 'superseded', 'needs_review']).optional() }).parse(request.query);
    const evidence = await evidenceFor(evidenceId);
    await authorizeEvidence('listEvidenceSuggestions', auth, evidence);
    const owner = isOwner(auth, evidence);
    const [rows, latest] = await Promise.all([listSuggestions(evidenceId, q.status), getLatestAnalysis(evidenceId)]);
    const flagged = isInjectionSuspected(evidence);
    return { items: rows.map((s) => serializeSuggestion(s, owner, flagged)), analysis: latest ? serializeAnalysis(latest) : null };
  });

  app.post('/suggestions/:suggestionId/accept', { config: { operationId: 'acceptSuggestion' } }, async (request, reply) => {
    const auth = request.auth!;
    const { suggestionId } = z.object({ suggestionId: z.string().uuid() }).parse(request.params);
    const { s, evidence } = await suggestionFor('acceptSuggestion', auth, suggestionId);
    if (!evidence.ownerAcceptedAt) throw new ApiError('VAL-002', 'Accept this item first: it was uploaded on your behalf (CCR-024)');
    const schoolId = requireCurrentSchool(auth);
    await idempotent(request, reply, 'acceptSuggestion', async () => {
      const r = await acceptSuggestionToMapping({ suggestionId: s.id, ownerUserId: auth.userId, schoolId, requestId: request.id });
      if (!r.ok) {
        throw r.reason === 'not_open'
          ? new ApiError('AI-003', 'Suggestion is not open (already accepted, rejected or superseded)')
          : new ApiError('MAP-001', 'This evidence is already mapped to that indicator');
      }
      await writeAuditEvent({
        schoolId, actorUserId: auth.userId, action: 'suggestion_accepted', entityType: 'EvidenceIndicatorMapping',
        entityId: r.row.id, after: { ai_suggestion_id: s.id, indicator_id: s.indicatorId }, requestId: request.id,
      });
      return { status: 201, body: serializeMapping(r.row) };
    });
  });

  app.post('/suggestions/accept-batch', { config: { operationId: 'acceptSuggestions' } }, async (request, reply) => {
    const auth = request.auth!;
    const body = z.object({ suggestion_ids: z.array(z.string().uuid()).min(1).max(100) }).parse(request.body);
    const schoolId = requireCurrentSchool(auth);
    // The role check up front: per-item ownership follows, but a role with no
    // grant at all is PERM-001, not a list of skips.
    await resolveGrant('acceptSuggestions', auth, schoolId);
    await idempotent(request, reply, 'acceptSuggestions', async () => {
      const accepted: ReturnType<typeof serializeMapping>[] = [];
      const skipped: { suggestion_id: string; code: string }[] = [];
      for (const id of [...new Set(body.suggestion_ids)]) {
        let found;
        try {
          found = await suggestionFor('acceptSuggestions', auth, id);
        } catch (e) {
          // Someone else's or missing: reported per item, never as existence.
          if (e instanceof ApiError) { skipped.push({ suggestion_id: id, code: 'RES-001' }); continue; }
          throw e;
        }
        const { s, evidence } = found;
        if (s.status !== 'open') { skipped.push({ suggestion_id: id, code: 'AI-003' }); continue; }
        if (!batchAcceptable(s, isInjectionSuspected(evidence)) || !evidence.ownerAcceptedAt) { skipped.push({ suggestion_id: id, code: 'AI-004' }); continue; }
        const r = await acceptSuggestionToMapping({ suggestionId: s.id, ownerUserId: auth.userId, schoolId, requestId: request.id });
        if (r.ok) accepted.push(serializeMapping(r.row));
        else skipped.push({ suggestion_id: id, code: r.reason === 'not_open' ? 'AI-003' : 'MAP-001' });
      }
      return { status: 200, body: { accepted, skipped } };
    });
  });

  app.post('/suggestions/:suggestionId/reject', { config: { operationId: 'rejectSuggestion' } }, async (request, reply) => {
    const auth = request.auth!;
    const { suggestionId } = z.object({ suggestionId: z.string().uuid() }).parse(request.params);
    const body = z.object({
      reason_code: z.enum(['not_relevant', 'wrong_indicator', 'weak_evidence', 'wrong_period', 'duplicate', 'other']),
      note: z.string().max(500).nullable().optional(),
    }).parse(request.body);
    const { s } = await suggestionFor('rejectSuggestion', auth, suggestionId);
    await idempotent(request, reply, 'rejectSuggestion', async () => {
      const row = await rejectSuggestionWithReason({ suggestionId: s.id, userId: auth.userId, reasonCode: body.reason_code, note: body.note ?? null });
      if (!row) throw new ApiError('AI-003', 'Suggestion is not open (already accepted, rejected or superseded)');
      return { status: 200, body: serializeSuggestion(row, true) };
    });
  });
};
