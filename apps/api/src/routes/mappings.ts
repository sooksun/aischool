// Governed evidence<->indicator mappings. actOnMapping has the most nuanced grant
// in permissions.yaml: teacher holds 'own-revoke' — narrower than a role check
// alone can express (action must BE revoke, the mapping must still be 'suggested',
// and the caller must own the evidence it points at).
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  listMappingsForEvidence, createMapping, listMappings, getMappingForAction, getMappingById,
  confirmMapping, rejectMapping, revokeMapping, getEvidenceDetail, getIndicatorById, writeAuditEvent,
  listEvaluateePersonnelIdsForCommitteeMember, suggestMappingsLocalHeuristic, getCycleForRound,
} from '@seip/database';
import { ApiError, forbiddenAreaWrite, forbiddenRole } from '@seip/backend-shared';
import { Prisma } from '@prisma/client';
import { requireCurrentSchool } from '../plugins/auth.js';
import { resolveGrant, requireOwnership, requireCommitteeAccessToPersonnel } from '../lib/permission-guard.js';

function serializeMapping(m: { id: string; evidenceId: string; indicatorId: string; cycleId: string | null; mappingSource: string; status: string; rationale: string | null; mappedByUserId: string; confirmedByUserId: string | null; mappedAt: Date; confirmedAt: Date | null }) {
  return {
    id: m.id, evidence_id: m.evidenceId, indicator_id: m.indicatorId, cycle_id: m.cycleId,
    mapping_source: m.mappingSource, status: m.status, rationale: m.rationale,
    mapped_by_user_id: m.mappedByUserId, confirmed_by_user_id: m.confirmedByUserId,
    mapped_at: m.mappedAt.toISOString(), confirmed_at: m.confirmedAt?.toISOString() ?? null,
  };
}

export const mappingRoutes: FastifyPluginAsync = async (app) => {
  app.get('/evidence/:evidenceId/mappings', { config: { operationId: 'listEvidenceMappings' } }, async (request) => {
    const auth = request.auth!;
    const schoolId = requireCurrentSchool(auth);
    const { evidenceId } = z.object({ evidenceId: z.string().uuid() }).parse(request.params);
    const grant = await resolveGrant('listEvidenceMappings', auth, schoolId);

    const evidence = await getEvidenceDetail(schoolId, evidenceId);
    if (!evidence) throw new ApiError('RES-001', 'Evidence not found');
    if (grant === 'own') requireOwnership(auth, evidence.ownerPersonnelId);
    if (grant === 'committee') await requireCommitteeAccessToPersonnel(schoolId, auth.userId, evidence.ownerPersonnelId);

    const rows = await listMappingsForEvidence(schoolId, evidenceId);
    return rows.map(serializeMapping);
  });

  app.post('/evidence/:evidenceId/mappings', { config: { operationId: 'createMapping' } }, async (request, reply) => {
    const auth = request.auth!;
    const schoolId = requireCurrentSchool(auth);
    const { evidenceId } = z.object({ evidenceId: z.string().uuid() }).parse(request.params);
    const grant = await resolveGrant('createMapping', auth, schoolId);
    if (grant === 'area-r') throw forbiddenAreaWrite();

    const evidence = await getEvidenceDetail(schoolId, evidenceId);
    if (!evidence) throw new ApiError('RES-001', 'Evidence not found');
    if (grant === 'own') requireOwnership(auth, evidence.ownerPersonnelId);

    const body = z.object({
      indicator_id: z.string().uuid(),
      cycle_id: z.string().uuid().nullable().optional(),
      rationale: z.string().max(1000).nullable().optional(),
    }).parse(request.body);

    const indicator = await getIndicatorById(body.indicator_id);
    if (!indicator) throw new ApiError('VAL-002', 'Unknown indicator_id');
    if (indicator.indicatorKind === 'workload_gate') {
      throw new ApiError('MAP-003', 'Workload-gate rows cannot be mapped to evidence');
    }

    try {
      const mapping = await createMapping(schoolId, {
        evidenceId, indicatorId: body.indicator_id, cycleId: body.cycle_id ?? null,
        mappedByUserId: auth.userId, rationale: body.rationale ?? null,
      });
      await writeAuditEvent({
        schoolId, actorUserId: auth.userId, action: 'created', entityType: 'EvidenceIndicatorMapping',
        entityId: mapping.id, after: mapping, requestId: request.id,
      });
      reply.status(201).send(serializeMapping(mapping));
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ApiError('MAP-001', 'Active mapping already exists for this (evidence, indicator, cycle)');
      }
      throw e;
    }
  });

  app.post('/evidence/:evidenceId/mappings/suggest', { config: { operationId: 'suggestMappings' } }, async (request) => {
    const auth = request.auth!;
    const schoolId = requireCurrentSchool(auth);
    const { evidenceId } = z.object({ evidenceId: z.string().uuid() }).parse(request.params);
    const grant = await resolveGrant('suggestMappings', auth, schoolId);
    if (grant === 'area-r') throw forbiddenAreaWrite();

    const evidence = await getEvidenceDetail(schoolId, evidenceId);
    if (!evidence) throw new ApiError('RES-001', 'Evidence not found');
    if (grant === 'own') requireOwnership(auth, evidence.ownerPersonnelId);

    if (evidence.status !== 'active' && evidence.status !== 'draft') {
      throw new ApiError('AI-001', 'Evidence is not eligible for mapping suggestions');
    }

    const body = z.object({
      cycle_id: z.string().uuid().nullable().optional(),
      framework_version_id: z.string().uuid().nullable().optional(),
      max_suggestions: z.number().int().min(1).max(20).optional(),
    }).parse(request.body ?? {});

    let frameworkVersionId = body.framework_version_id ?? null;
    const cycleId = body.cycle_id ?? null;
    if (cycleId) {
      const cycle = await getCycleForRound(cycleId);
      if (!cycle || cycle.schoolId !== schoolId) {
        throw new ApiError('AI-001', 'cycle_id is not valid for this school');
      }
      if (!frameworkVersionId) frameworkVersionId = cycle.frameworkVersionId;
    }
    if (!frameworkVersionId) {
      throw new ApiError('AI-001', 'framework_version_id or cycle_id is required to scope indicators');
    }

    const evidenceText = `${evidence.title} ${evidence.description ?? ''}`;
    const { items, skippedActive } = await suggestMappingsLocalHeuristic({
      schoolId,
      evidenceId,
      evidenceText,
      frameworkVersionId,
      cycleId,
      mappedByUserId: auth.userId,
      maxSuggestions: body.max_suggestions ?? 5,
      requestId: request.id,
    });

    await writeAuditEvent({
      schoolId, actorUserId: auth.userId, action: 'ai_suggested', entityType: 'EvidenceIndicatorMapping',
      entityId: evidenceId, after: { count: items.length, provider: 'local_heuristic' }, requestId: request.id,
    });

    return {
      provider: 'local_heuristic' as const,
      items: items.map(serializeMapping),
      skipped_active: skippedActive,
    };
  });

  app.get('/mappings', { config: { operationId: 'listMappings' } }, async (request) => {
    const auth = request.auth!;
    const schoolId = requireCurrentSchool(auth);
    const grant = await resolveGrant('listMappings', auth, schoolId);
    // 'own'/'own-revoke' never appear in listMappings' grant set (teacher/deputy
    // hold no rule for this operationId at all — resolveGrant already threw
    // PERM-001 for them before reaching here).

    const q = z.object({
      indicator_id: z.string().uuid().optional(),
      cycle_id: z.string().uuid().optional(),
      status: z.enum(['suggested', 'confirmed', 'rejected', 'revoked']).optional(),
      page: z.coerce.number().int().min(1).default(1),
      page_size: z.coerce.number().int().min(1).max(100).default(20),
    }).parse(request.query);

    const ownerPersonnelIdIn = grant === 'committee'
      ? await listEvaluateePersonnelIdsForCommitteeMember(schoolId, auth.userId)
      : undefined;

    const { items, total } = await listMappings(schoolId, {
      indicatorId: q.indicator_id, cycleId: q.cycle_id, status: q.status,
      ownerPersonnelIdIn, page: q.page, pageSize: q.page_size,
    });
    return { items: items.map(serializeMapping), meta: { page: q.page, page_size: q.page_size, total } };
  });

  app.patch('/mappings/:mappingId', { config: { operationId: 'actOnMapping' } }, async (request) => {
    const auth = request.auth!;
    const { mappingId } = z.object({ mappingId: z.string().uuid() }).parse(request.params);
    const body = z.object({
      action: z.enum(['confirm', 'reject', 'revoke']),
      rationale: z.string().max(1000).nullable().optional(),
    }).parse(request.body);

    const mapping = await getMappingForAction(mappingId);
    if (!mapping) throw new ApiError('RES-001', 'Mapping not found');

    const grant = await resolveGrant('actOnMapping', auth, mapping.schoolId);
    if (grant === 'own-revoke') {
      // permissions.yaml: "owner may revoke their own suggested mapping only" —
      // narrower than the DB layer allows (which also permits revoking 'confirmed'
      // for school-level roles). All three conditions are enforced here, not just role.
      if (body.action !== 'revoke') throw forbiddenRole();
      if (!auth.personnel || auth.personnel.id !== mapping.evidence.ownerPersonnelId) throw forbiddenRole();
      if (mapping.status !== 'suggested') throw new ApiError('MAP-002', 'Only a suggested mapping may be revoked by its owner');
    } else if (grant === 'area-r') {
      throw forbiddenAreaWrite();
    }
    // grant === 'school': any action, any status transition the DB layer allows.

    let ok: boolean;
    let action: string;
    if (body.action === 'confirm') {
      ok = await confirmMapping(mappingId, auth.userId);
      action = 'confirmed';
      if (!ok) throw new ApiError('MAP-002', 'Confirm rejected — mapping not in suggested state');
    } else if (body.action === 'reject') {
      ok = await rejectMapping(mappingId, body.rationale ?? null);
      action = 'rejected';
      if (!ok) throw new ApiError('MAP-002', 'Reject rejected — mapping not in suggested state');
    } else {
      ok = await revokeMapping(mappingId);
      action = 'revoked';
      if (!ok) throw new ApiError('MAP-002', 'Mapping is not in a revocable state');
    }

    await writeAuditEvent({
      schoolId: mapping.schoolId, actorUserId: auth.userId, action, entityType: 'EvidenceIndicatorMapping',
      entityId: mappingId, requestId: request.id,
    });

    const updated = await getMappingById(mappingId);
    return serializeMapping(updated!);
  });
};
