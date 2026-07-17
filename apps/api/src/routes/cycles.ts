// Evaluation cycles + rounds. Cycles are school-scoped directly (requireCurrentSchool);
// rounds carry no schoolId of their own, so every round-scoped route resolves
// tenancy through getCycleForRound/getRoundForAction (mirrors mappings.ts's
// evidence-relation tenancy pattern for evidence_indicator_mapping).
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  listCycles, createCycle, getCycleDetail, updateCycle,
  getCycleForRound, createRound, getRoundForAction, updateRound, writeAuditEvent,
} from '@seip/database';
import { ApiError, forbiddenAreaWrite } from '@seip/backend-shared';
import { requireCurrentSchool } from '../plugins/auth.js';
import { resolveGrant } from '../lib/permission-guard.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function serializeCycle(c: { id: string; schoolId: string; frameworkVersionId: string; fiscalYear: number; evaluationKind: string; title: string; status: string; startsOn: Date; endsOn: Date }) {
  return {
    id: c.id, school_id: c.schoolId, framework_version_id: c.frameworkVersionId,
    fiscal_year: c.fiscalYear, evaluation_kind: c.evaluationKind, title: c.title, status: c.status,
    starts_on: c.startsOn.toISOString().slice(0, 10), ends_on: c.endsOn.toISOString().slice(0, 10),
  };
}

function serializeRound(r: { id: string; cycleId: string; roundNumber: number; purpose: string; periodStart: Date; periodEnd: Date; status: string }) {
  return {
    id: r.id, cycle_id: r.cycleId, round_number: r.roundNumber, purpose: r.purpose,
    period_start: r.periodStart.toISOString().slice(0, 10), period_end: r.periodEnd.toISOString().slice(0, 10),
    status: r.status,
  };
}

// planned -> open -> scoring -> closed, one step at a time (CYCLE-001). Closing
// freezes scores (SCORE-002, enforced in scoring.ts, not here).
const ROUND_STATUS_ORDER = ['planned', 'open', 'scoring', 'closed'];
function isLegalRoundTransition(from: string, to: string): boolean {
  return ROUND_STATUS_ORDER.indexOf(to) === ROUND_STATUS_ORDER.indexOf(from) + 1;
}

export const cycleRoutes: FastifyPluginAsync = async (app) => {
  app.get('/cycles', { config: { operationId: 'listCycles' } }, async (request) => {
    const auth = request.auth!;
    const schoolId = requireCurrentSchool(auth);
    // Every role in this op's matrix row grants plain school/area visibility (no
    // 'own'-style row filtering) — resolveGrant's throw-if-none IS the enforcement.
    await resolveGrant('listCycles', auth, schoolId);

    const q = z.object({
      fiscal_year: z.coerce.number().int().optional(),
      evaluation_kind: z.enum(['pa', 'dpa']).optional(),
      status: z.enum(['planned', 'open', 'closed']).optional(),
    }).parse(request.query);

    const rows = await listCycles(schoolId, {
      fiscalYear: q.fiscal_year, evaluationKind: q.evaluation_kind, status: q.status,
    });
    return rows.map(serializeCycle);
  });

  app.post('/cycles', { config: { operationId: 'createCycle' } }, async (request, reply) => {
    const auth = request.auth!;
    const schoolId = requireCurrentSchool(auth);
    const grant = await resolveGrant('createCycle', auth, schoolId);
    if (grant === 'area-r') throw forbiddenAreaWrite();

    const body = z.object({
      framework_version_id: z.string().uuid(),
      fiscal_year: z.number().int(),
      evaluation_kind: z.enum(['pa', 'dpa']),
      title: z.string().min(1).max(200),
      starts_on: z.string().regex(DATE_RE),
      ends_on: z.string().regex(DATE_RE),
    }).parse(request.body);

    if (body.starts_on > body.ends_on) throw new ApiError('VAL-002', 'starts_on must be on or before ends_on');

    const cycle = await createCycle(schoolId, {
      frameworkVersionId: body.framework_version_id, fiscalYear: body.fiscal_year,
      evaluationKind: body.evaluation_kind, title: body.title,
      startsOn: new Date(body.starts_on), endsOn: new Date(body.ends_on),
    });

    await writeAuditEvent({
      schoolId, actorUserId: auth.userId, action: 'created', entityType: 'EvaluationCycle',
      entityId: cycle.id, after: cycle, requestId: request.id,
    });
    reply.status(201).send(serializeCycle(cycle));
  });

  app.get('/cycles/:cycleId', { config: { operationId: 'getCycle' } }, async (request) => {
    const auth = request.auth!;
    const schoolId = requireCurrentSchool(auth);
    const { cycleId } = z.object({ cycleId: z.string().uuid() }).parse(request.params);
    await resolveGrant('getCycle', auth, schoolId);

    const detail = await getCycleDetail(schoolId, cycleId);
    if (!detail) throw new ApiError('RES-001', 'Cycle not found');
    return { ...serializeCycle(detail), rounds: detail.rounds.map(serializeRound) };
  });

  app.patch('/cycles/:cycleId', { config: { operationId: 'updateCycle' } }, async (request) => {
    const auth = request.auth!;
    const schoolId = requireCurrentSchool(auth);
    const { cycleId } = z.object({ cycleId: z.string().uuid() }).parse(request.params);
    const grant = await resolveGrant('updateCycle', auth, schoolId);
    if (grant === 'area-r') throw forbiddenAreaWrite();

    const patch = z.object({
      title: z.string().min(1).max(200).optional(),
      status: z.enum(['planned', 'open', 'closed']).optional(),
      starts_on: z.string().regex(DATE_RE).optional(),
      ends_on: z.string().regex(DATE_RE).optional(),
    }).refine((p) => Object.keys(p).length > 0, 'at least one field required').parse(request.body);

    const existing = await getCycleDetail(schoolId, cycleId);
    if (!existing) throw new ApiError('RES-001', 'Cycle not found');

    const nextStarts = patch.starts_on ?? existing.startsOn.toISOString().slice(0, 10);
    const nextEnds = patch.ends_on ?? existing.endsOn.toISOString().slice(0, 10);
    if (nextStarts > nextEnds) throw new ApiError('VAL-002', 'starts_on must be on or before ends_on');

    const updated = await updateCycle(schoolId, cycleId, {
      title: patch.title, status: patch.status,
      startsOn: patch.starts_on ? new Date(patch.starts_on) : undefined,
      endsOn: patch.ends_on ? new Date(patch.ends_on) : undefined,
    });
    if (!updated) throw new ApiError('RES-001', 'Cycle not found');

    await writeAuditEvent({
      schoolId, actorUserId: auth.userId, action: 'updated', entityType: 'EvaluationCycle',
      entityId: cycleId, before: existing, after: updated, requestId: request.id,
    });
    return serializeCycle(updated);
  });

  app.post('/cycles/:cycleId/rounds', { config: { operationId: 'createRound' } }, async (request, reply) => {
    const auth = request.auth!;
    const { cycleId } = z.object({ cycleId: z.string().uuid() }).parse(request.params);

    const cycle = await getCycleForRound(cycleId);
    if (!cycle) throw new ApiError('RES-001', 'Cycle not found');
    // Resolved against the CYCLE's own school, not auth.currentSchoolId — a
    // multi-school school_admin acting on a cycle outside their "current" pick
    // must still be checked against the resource's actual school (permission-guard.ts).
    const grant = await resolveGrant('createRound', auth, cycle.schoolId);
    if (grant === 'area-r') throw forbiddenAreaWrite();

    const body = z.object({
      round_number: z.number().int().min(1),
      purpose: z.string().min(1).max(100),
      period_start: z.string().regex(DATE_RE),
      period_end: z.string().regex(DATE_RE),
    }).parse(request.body);

    if (body.period_start > body.period_end) {
      throw new ApiError('VAL-002', 'period_start must be on or before period_end');
    }
    const cycleStarts = cycle.startsOn.toISOString().slice(0, 10);
    const cycleEnds = cycle.endsOn.toISOString().slice(0, 10);
    if (body.period_start < cycleStarts || body.period_end > cycleEnds) {
      throw new ApiError('CYCLE-003', 'Round period must fall within the cycle bounds');
    }

    const round = await createRound(cycleId, {
      roundNumber: body.round_number, purpose: body.purpose,
      periodStart: new Date(body.period_start), periodEnd: new Date(body.period_end),
    });

    await writeAuditEvent({
      schoolId: cycle.schoolId, actorUserId: auth.userId, action: 'created', entityType: 'EvaluationRound',
      entityId: round.id, after: round, requestId: request.id,
    });
    reply.status(201).send(serializeRound(round));
  });

  app.patch('/rounds/:roundId', { config: { operationId: 'updateRound' } }, async (request) => {
    const auth = request.auth!;
    const { roundId } = z.object({ roundId: z.string().uuid() }).parse(request.params);

    const round = await getRoundForAction(roundId);
    if (!round) throw new ApiError('RES-001', 'Round not found');
    const grant = await resolveGrant('updateRound', auth, round.cycle.schoolId);
    if (grant === 'area-r') throw forbiddenAreaWrite();

    const patch = z.object({
      purpose: z.string().min(1).max(100).optional(),
      period_start: z.string().regex(DATE_RE).optional(),
      period_end: z.string().regex(DATE_RE).optional(),
      status: z.enum(['planned', 'open', 'scoring', 'closed']).optional(),
    }).refine((p) => Object.keys(p).length > 0, 'at least one field required').parse(request.body);

    if (patch.status && patch.status !== round.status && !isLegalRoundTransition(round.status, patch.status)) {
      throw new ApiError('CYCLE-001', `Illegal round transition ${round.status} -> ${patch.status}`);
    }

    const nextStart = patch.period_start ?? round.periodStart.toISOString().slice(0, 10);
    const nextEnd = patch.period_end ?? round.periodEnd.toISOString().slice(0, 10);
    if (nextStart > nextEnd) throw new ApiError('VAL-002', 'period_start must be on or before period_end');
    const cycleStarts = round.cycle.startsOn.toISOString().slice(0, 10);
    const cycleEnds = round.cycle.endsOn.toISOString().slice(0, 10);
    if (nextStart < cycleStarts || nextEnd > cycleEnds) {
      throw new ApiError('CYCLE-003', 'Round period must fall within the cycle bounds');
    }

    const updated = await updateRound(roundId, {
      purpose: patch.purpose,
      periodStart: patch.period_start ? new Date(patch.period_start) : undefined,
      periodEnd: patch.period_end ? new Date(patch.period_end) : undefined,
      status: patch.status,
    });

    await writeAuditEvent({
      schoolId: round.cycle.schoolId, actorUserId: auth.userId, action: 'updated', entityType: 'EvaluationRound',
      entityId: roundId, before: round, after: updated, requestId: request.id,
    });
    return serializeRound(updated);
  });
};
