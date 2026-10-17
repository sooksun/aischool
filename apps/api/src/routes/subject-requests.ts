// FR-117 data-subject requests (CCR-029).
//   createSubjectRequest   own — about the caller's own person, routed to the DPO
//                          of the current school's area
//   list / get             own (the caller's requests) or dpo: area (the requests
//                          of the areas where they hold the role); anyone else RES-001
//   decideSubjectRequest   dpo: area, step-up (min_acr 2); audited
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  fileSubjectRequest, getSubjectRequestById, listSubjectRequestsFor, decideSubjectRequest, getSchoolAreaId,
  type SubjectRequestRow,
} from '@seip/database';
import { ApiError, forbiddenRole } from '@seip/backend-shared';
import type { AuthedRequest } from '../plugins/auth.js';
import { requireCurrentSchool } from '../plugins/auth.js';
import { requireAcr } from '../lib/permission-guard.js';
import { ownGrant } from '../lib/evidence-access.js';
import { idempotent } from '../lib/concurrency.js';

const TYPES = ['access', 'portability', 'correction', 'erasure', 'restriction', 'objection'] as const;
const STATUSES = ['received', 'fulfilling', 'approved', 'completed', 'rejected'] as const;
const OPEN = new Set(['received', 'fulfilling', 'approved']);

function serialize(r: SubjectRequestRow) {
  return {
    id: r.id,
    request_type: r.requestType,
    status: r.status,
    person_id: r.personId,
    requester_display_name: r.requesterDisplayName,
    school_id: r.schoolId,
    area_id: r.areaId,
    details: r.details,
    received_at: r.receivedAt.toISOString(),
    due_at: r.dueAt.toISOString(),
    overdue: OPEN.has(r.status) && r.dueAt < new Date(),
    decision_note: r.decisionNote,
    decided_at: r.decidedAt?.toISOString() ?? null,
    completed_at: r.completedAt?.toISOString() ?? null,
    export_id: r.exportId,
  };
}

/** Areas where the caller holds the dpo role. */
function dpoAreas(auth: AuthedRequest): string[] {
  return [...auth.tenancy.areaRoles].filter(([, roles]) => roles.has('dpo')).map(([id]) => id);
}

/** The caller's own request, or one of their DPO areas; otherwise RES-001 (PERM-001 with no route at all). */
async function requestFor(op: string, auth: AuthedRequest, id: string): Promise<SubjectRequestRow> {
  const own = ownGrant(op, auth) ? auth.personId : null;
  const areas = dpoAreas(auth);
  if (!own && areas.length === 0) throw forbiddenRole();
  const r = await getSubjectRequestById(id);
  if (r && ((own && r.personId === own) || areas.includes(r.areaId))) return r;
  throw new ApiError('RES-001', 'Request not found');
}

export const subjectRequestRoutes: FastifyPluginAsync = async (app) => {
  app.post('/subject-requests', { config: { operationId: 'createSubjectRequest' } }, async (request, reply) => {
    const auth = request.auth!;
    if (!ownGrant('createSubjectRequest', auth)) throw forbiddenRole();
    const body = z.object({
      request_type: z.enum(TYPES),
      details: z.string().trim().max(2000).nullable().optional(),
    }).parse(request.body);
    if (!auth.personId) throw new ApiError('VAL-002', 'This account has no person to file for', [{ field: 'request_type', issue: 'no person' }]);
    const schoolId = requireCurrentSchool(auth);
    if (!auth.tenancy.schoolRoles.has(schoolId)) throw forbiddenRole(); // filed from a school the caller belongs to
    const areaId = await getSchoolAreaId(schoolId);
    if (!areaId) throw new ApiError('VAL-002', 'This school belongs to no สพท., so there is no DPO to receive the request');
    await idempotent(request, reply, 'createSubjectRequest', async () => {
      const row = await fileSubjectRequest({
        personId: auth.personId!, userId: auth.userId, schoolId, areaId,
        requestType: body.request_type, details: body.details || null, requestId: request.id,
      });
      return { status: 201, body: serialize(row) };
    });
  });

  app.get('/subject-requests', { config: { operationId: 'listSubjectRequests' } }, async (request) => {
    const auth = request.auth!;
    const q = z.object({
      status: z.enum(STATUSES).optional(),
      cursor: z.string().regex(/^\d+$/).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    }).parse(request.query);
    const own = ownGrant('listSubjectRequests', auth) ? auth.personId : null;
    const areas = dpoAreas(auth);
    if (!ownGrant('listSubjectRequests', auth) && areas.length === 0) throw forbiddenRole();
    const offset = q.cursor ? Number(q.cursor) : 0;
    const page = await listSubjectRequestsFor(own, areas, { status: q.status, offset, limit: q.limit });
    return { items: page.items.map(serialize), next_cursor: page.more ? String(offset + q.limit) : null };
  });

  app.get('/subject-requests/:requestId', { config: { operationId: 'getSubjectRequest' } }, async (request) => {
    const { requestId } = z.object({ requestId: z.string().uuid() }).parse(request.params);
    return serialize(await requestFor('getSubjectRequest', request.auth!, requestId));
  });

  app.post('/subject-requests/:requestId/decision', { config: { operationId: 'decideSubjectRequest' } }, async (request) => {
    const auth = request.auth!;
    const { requestId } = z.object({ requestId: z.string().uuid() }).parse(request.params);
    const areas = dpoAreas(auth);
    if (areas.length === 0) throw forbiddenRole();
    const cur = await getSubjectRequestById(requestId);
    if (!cur || !areas.includes(cur.areaId)) throw new ApiError('RES-001', 'Request not found');
    requireAcr(auth, 'decideSubjectRequest');
    const body = z.object({
      action: z.enum(['approve', 'reject', 'complete']),
      note: z.string().max(2000).nullable().optional(),
    }).parse(request.body);
    const r = await decideSubjectRequest({ id: requestId, action: body.action, note: body.note ?? null, actorUserId: auth.userId, requestId: request.id });
    if (r.ok) return serialize(r.row);
    if (r.reason === 'note_required') throw new ApiError('VAL-002', `${body.action} needs a note`, [{ field: 'note', issue: 'required' }]);
    if (r.reason === 'not_found') throw new ApiError('RES-001', 'Request not found');
    throw new ApiError('VAL-002', `Cannot ${body.action} a request that is ${cur.status}`, [{ field: 'action', issue: 'not allowed in this status' }]);
  });
};
