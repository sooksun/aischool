// Evidence ↔ indicator mappings, two tiers (ADR-0015, CCR-017).
//
//   createMapping   the OWNER adds a mapping by hand → owner_confirmed
//   actOnMapping    revoke   — the owner, from any live state
//                   validate — the director, or a committee member for the owner
//                   return   — same validators, with a note the owner reads
//
// Nobody confirms a mapping on someone else's evidence, and nobody validates
// their own. AI suggestions become mappings only when the owner accepts them
// (acceptSuggestion, P3) — there is no "suggested" mapping state any more.
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  listMappingsForEvidence, createOwnerMapping, listMappings, getMappingForAction,
  validateMapping, returnMapping, revokeMapping, getEvidenceDetail, getIndicatorById,
  writeAuditEvent, listEvaluateePersonIdsForCommitteeMember, isUniqueViolation,
} from '@seip/database';
import { ApiError, forbiddenAreaWrite, forbiddenRole } from '@seip/backend-shared';
import { requireCurrentSchool } from '../plugins/auth.js';
import { resolveGrant, requireAcr } from '../lib/permission-guard.js';
import { authorizeEvidence, isOwner, ownGrant } from '../lib/evidence-access.js';
import { etag, idempotent, requireIfMatch, staleOrMissing } from '../lib/concurrency.js';
import { serializeMapping } from './evidence.js';

export const mappingRoutes: FastifyPluginAsync = async (app) => {
  app.get('/evidence/:evidenceId/mappings', { config: { operationId: 'listEvidenceMappings' } }, async (request) => {
    const auth = request.auth!;
    const { evidenceId } = z.object({ evidenceId: z.string().uuid() }).parse(request.params);
    const evidence = await getEvidenceDetail(evidenceId);
    if (!evidence) throw new ApiError('RES-001', 'Evidence not found');
    await authorizeEvidence('listEvidenceMappings', auth, evidence);
    return (await listMappingsForEvidence(evidenceId)).map(serializeMapping);
  });

  app.post('/evidence/:evidenceId/mappings', { config: { operationId: 'createMapping' } }, async (request, reply) => {
    const auth = request.auth!;
    const { evidenceId } = z.object({ evidenceId: z.string().uuid() }).parse(request.params);
    const body = z.object({
      indicator_id: z.string().uuid(),
      note: z.string().max(1000).nullable().optional(),
    }).parse(request.body);

    const evidence = await getEvidenceDetail(evidenceId);
    if (!evidence) throw new ApiError('RES-001', 'Evidence not found');
    // The matrix grants createMapping as `own` only — authorizeEvidence lets
    // nobody but the owner through.
    await authorizeEvidence('createMapping', auth, evidence);
    // FR-051: the mapping belongs to the school the owner works at now — after a
    // transfer, the new school's director validates it, not the old school's.
    const schoolId = requireCurrentSchool(auth);

    const indicator = await getIndicatorById(body.indicator_id);
    if (!indicator) throw new ApiError('VAL-002', 'Unknown indicator_id');
    if (indicator.indicatorKind === 'workload_gate') {
      throw new ApiError('MAP-003', 'Workload-gate rows cannot be mapped to evidence');
    }

    await idempotent(request, reply, 'createMapping', async () => {
      try {
        const mapping = await createOwnerMapping({
          evidenceId, schoolId, indicatorId: indicator.id,
          frameworkVersionId: indicator.frameworkVersionId, ownerUserId: auth.userId,
          source: 'manual', note: body.note ?? null, requestId: request.id,
        });
        await writeAuditEvent({
          schoolId, actorUserId: auth.userId, action: 'owner_confirmed',
          entityType: 'EvidenceIndicatorMapping', entityId: mapping.id, after: mapping, requestId: request.id,
        });
        return { status: 201, body: serializeMapping(mapping), headers: { ETag: etag(mapping.version) } };
      } catch (e) {
        if (isUniqueViolation(e)) {
          throw new ApiError('MAP-001', 'A live mapping already exists for this (evidence, indicator, framework version)');
        }
        throw e;
      }
    });
  });

  app.get('/mappings', { config: { operationId: 'listMappings' } }, async (request) => {
    const auth = request.auth!;
    const schoolId = requireCurrentSchool(auth);
    const grant = await resolveGrant('listMappings', auth, schoolId);
    const q = z.object({
      indicator_id: z.string().uuid().optional(),
      framework_version_id: z.string().uuid().optional(),
      status: z.enum(['owner_confirmed', 'validated', 'returned', 'revoked']).optional(),
      page: z.coerce.number().int().min(1).default(1),
      page_size: z.coerce.number().int().min(1).max(100).default(20),
    }).parse(request.query);

    const ownerPersonIdIn = grant === 'committee'
      ? await listEvaluateePersonIdsForCommitteeMember(auth.userId)
      : undefined;
    const { items, total } = await listMappings(schoolId, {
      indicatorId: q.indicator_id, frameworkVersionId: q.framework_version_id, status: q.status,
      ownerPersonIdIn, page: q.page, pageSize: q.page_size,
    });
    return { items: items.map(serializeMapping), meta: { page: q.page, page_size: q.page_size, total } };
  });

  app.patch('/mappings/:mappingId', { config: { operationId: 'actOnMapping' } }, async (request, reply) => {
    const auth = request.auth!;
    const { mappingId } = z.object({ mappingId: z.string().uuid() }).parse(request.params);
    const body = z.object({
      action: z.enum(['revoke', 'validate', 'return']),
      return_note: z.string().max(1000).nullable().optional(),
    }).parse(request.body);

    const mapping = await getMappingForAction(mappingId);
    if (!mapping || mapping.evidence.deletedAt) throw new ApiError('RES-001', 'Mapping not found');
    const ref = { ownerPersonId: mapping.evidence.ownerPersonId, originSchoolId: mapping.schoolId };

    let validatorRole: 'director' | 'committee' | null = null;
    if (body.action === 'revoke') {
      // Owner only (own-revoke), from wherever they are now.
      if (!isOwner(auth, ref) || !ownGrant('actOnMapping', auth)) {
        // No route to the evidence at all → RES-001 (existence not leaked);
        // a route, but not the owner → PERM-001.
        await authorizeEvidence('actOnMapping', auth, ref);
        throw forbiddenRole();
      }
    } else {
      if (isOwner(auth, ref)) throw new ApiError('PERM-001', 'Nobody validates or returns a mapping on their own evidence');
      const grant = await authorizeEvidence('actOnMapping', auth, ref);
      if (grant === 'area-r') throw forbiddenAreaWrite();
      if (grant === 'school') validatorRole = 'director';
      else if (grant === 'committee') validatorRole = 'committee';
      else throw forbiddenRole();
      requireAcr(auth, 'actOnMapping', body.action);
      if (body.action === 'return' && !body.return_note?.trim()) {
        throw new ApiError('VAL-002', 'return_note is required when returning a mapping', [{ field: 'return_note', issue: 'required' }]);
      }
    }

    const expectedVersion = requireIfMatch(request);
    const res = body.action === 'revoke'
      ? await revokeMapping(mappingId, expectedVersion, auth.userId, request.id)
      : body.action === 'validate'
        ? await validateMapping(mappingId, expectedVersion, { userId: auth.userId, role: validatorRole! }, request.id)
        : await returnMapping(mappingId, expectedVersion, { userId: auth.userId, role: validatorRole! }, body.return_note!.trim(), request.id);
    if (!res.ok) {
      if (res.reason === 'state') {
        throw new ApiError('MAP-002', body.action === 'revoke'
          ? 'Mapping is already revoked'
          : `Only an owner_confirmed mapping can be ${body.action === 'validate' ? 'validated' : 'returned'}`);
      }
      throw staleOrMissing(res.reason, 'Mapping');
    }

    await writeAuditEvent({
      schoolId: mapping.schoolId, actorUserId: auth.userId,
      action: body.action === 'revoke' ? 'revoked' : body.action === 'validate' ? 'validated' : 'returned',
      entityType: 'EvidenceIndicatorMapping', entityId: mappingId, before: mapping, after: res.row, requestId: request.id,
    });
    reply.header('ETag', etag(res.row.version));
    return serializeMapping(res.row);
  });
};
