// listAssignmentEvidence (FR-060/061): the committee's read-only view of one
// evaluatee's confirmed evidence per indicator. It carries no AI confidence,
// rationale or suggestions (ADR-0015), only the mapping, the item and the files
// a reviewer may open: a video's 720p copy in place of its original, everything
// else as uploaded. Blocked or unscanned-pending files are left out.
// Grants: director / school_admin of the assignment's school (school); a
// member of THIS committee (committee) — and only while its round is not
// closed (FR-062b).
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  getAssignmentDetail, getCommitteeMembership, listCommitteeEvidence, getPersonIdOfPersonnel, getSchoolAreaId,
  listAssignmentComments, createAssignmentComment, getAssignmentComment, getPersonnelUserId, indicatorInFramework, writeAuditEvent,
} from '@seip/database';
import { ApiError, grantFor } from '@seip/backend-shared';
import { resolveGrant, type Grant } from '../lib/permission-guard.js';
import { ownGrant } from '../lib/evidence-access.js';
import type { AuthedRequest } from '../plugins/auth.js';
import { serializeEvidence, serializeFile, serializeMapping } from './evidence.js';

const OP = 'listAssignmentEvidence';

export const committeeRoutes: FastifyPluginAsync = async (app) => {
  app.get('/assignments/:assignmentId/evidence', { config: { operationId: OP } }, async (request) => {
    const auth = request.auth!;
    const { assignmentId } = z.object({ assignmentId: z.string().uuid() }).parse(request.params);
    const q = z.object({
      indicator_id: z.string().uuid().optional(),
      cursor: z.string().regex(/^\d+$/).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }).parse(request.query);

    const assignment = await getAssignmentDetail(assignmentId);
    if (!assignment) throw new ApiError('RES-001', 'Assignment not found');
    const membership = await getCommitteeMembership(assignmentId, auth.userId);
    let grant: Grant;
    try {
      grant = await resolveGrant(OP, auth, assignment.schoolId);
    } catch (e) {
      // A committee member is often from another school: their seat is the route.
      // Someone with no foothold at the school learns nothing about it (RES-001);
      // staff there whose role has no grant get the usual PERM-001.
      if (!membership) {
        const areaId = await getSchoolAreaId(assignment.schoolId);
        const foothold = auth.tenancy.schoolRoles.has(assignment.schoolId) || (!!areaId && auth.tenancy.areaRoles.has(areaId)); // any area role (CCR-029)
        throw e instanceof ApiError && e.code === 'PERM-001' && !foothold ? new ApiError('RES-001', 'Assignment not found') : e;
      }
      grant = 'committee';
    }
    if (grant === 'committee' && !membership) throw new ApiError('PERM-003', 'Not a committee member of this assignment');
    if (grant === 'committee' && assignment.round.status === 'closed') {
      throw new ApiError('PERM-003', 'The round is closed: committee access has ended (FR-062b)');
    }

    const personId = await getPersonIdOfPersonnel(assignment.evaluateePersonnelId);
    if (!personId) return { items: [], next_cursor: null };
    const offset = q.cursor ? Number(q.cursor) : 0;
    const page = await listCommitteeEvidence({
      personId, frameworkVersionId: assignment.round.cycle.frameworkVersionId, indicatorId: q.indicator_id, offset, limit: q.limit,
    });
    // FR-111: someone else's portfolio was opened — who, through which grant, how much.
    if (auth.personId !== personId) {
      await writeAuditEvent({
        schoolId: assignment.schoolId, actorUserId: auth.userId, action: 'committee_evidence_viewed',
        entityType: 'AssignmentEvidenceView', entityId: assignment.id,
        after: { assignmentId: assignment.id, grant, itemCount: page.items.length }, requestId: request.id,
      });
    }
    return {
      items: page.items.map((m) => {
        const files = m.evidence.files;
        const hasReview = (id: string) => files.some((f) => f.parentFileId === id && f.role === 'review_720p');
        const viewable = files.filter((f) => (f.role === 'original' ? !hasReview(f.id) : f.role === 'review_720p'));
        return {
          indicator_id: m.indicatorId,
          mapping: serializeMapping(m),
          evidence: serializeEvidence(m.evidence),
          files: viewable.map(serializeFile),
        };
      }),
      next_cursor: page.more ? String(offset + q.limit) : null,
    };
  });
};

type Assignment = NonNullable<Awaited<ReturnType<typeof getAssignmentDetail>>>;
type Actor = 'evaluatee' | 'committee' | 'director';

/**
 * CCR-028: who the caller is on this assignment. The evaluatee (own); a member
 * of this committee while the round is open; or a school role (director, and
 * for reading, the school admin). Otherwise PERM-001 for staff of the school,
 * RES-001 for anyone with no foothold there.
 */
async function actorOn(op: string, auth: AuthedRequest, a: Assignment): Promise<Actor> {
  if (ownGrant(op, auth) && (await getPersonnelUserId(a.evaluateePersonnelId)) === auth.userId) return 'evaluatee';
  // A seat counts only for a role the matrix grants `committee` (evaluator,
  // director) — a seat alone is not a grant.
  const roles = [...auth.tenancy.schoolRoles.values(), ...auth.tenancy.areaRoles.values()].flatMap((r) => [...r]);
  const committeeRole = roles.some((r) => grantFor(op, r as never) === 'committee');
  const membership = committeeRole ? await getCommitteeMembership(a.id, auth.userId) : null;
  if (membership && a.round.status !== 'closed') return 'committee';
  try {
    const g = await resolveGrant(op, auth, a.schoolId);
    if (g === 'school') return 'director';
    if (g === 'committee') throw new ApiError('PERM-003', membership ? 'The round is closed: committee access has ended (FR-062b)' : 'Not a committee member of this assignment');
    throw new ApiError('PERM-001', 'Role not allowed for this operation');
  } catch (e) {
    // A member from another school whose round has closed: say so, not "not found".
    if (membership && e instanceof ApiError && e.code === 'PERM-001') {
      throw new ApiError('PERM-003', 'The round is closed: committee access has ended (FR-062b)');
    }
    if (e instanceof ApiError && e.code === 'PERM-001') {
      const areaId = await getSchoolAreaId(a.schoolId);
      const foothold = auth.tenancy.schoolRoles.has(a.schoolId) || (!!areaId && auth.tenancy.areaRoles.has(areaId)); // any area role (CCR-029)
      if (!foothold) throw new ApiError('RES-001', 'Assignment not found');
    }
    throw e;
  }
}

function serializeComment(c: Awaited<ReturnType<typeof listAssignmentComments>>[number]) {
  return {
    id: c.id, assignment_id: c.assignmentId, indicator_id: c.indicatorId, kind: c.kind, body: c.body,
    parent_id: c.parentId, author_user_id: c.authorUserId, author_role: c.authorRole, created_at: c.createdAt.toISOString(),
  };
}

export const commentRoutes: FastifyPluginAsync = async (app) => {
  app.get('/assignments/:assignmentId/comments', { config: { operationId: 'listAssignmentComments' } }, async (request) => {
    const auth = request.auth!;
    const { assignmentId } = z.object({ assignmentId: z.string().uuid() }).parse(request.params);
    const q = z.object({ indicator_id: z.string().uuid().optional() }).parse(request.query);
    const a = await getAssignmentDetail(assignmentId);
    if (!a) throw new ApiError('RES-001', 'Assignment not found');
    await actorOn('listAssignmentComments', auth, a);
    return (await listAssignmentComments(a.id, q.indicator_id)).map(serializeComment);
  });

  app.post('/assignments/:assignmentId/comments', { config: { operationId: 'createAssignmentComment' } }, async (request, reply) => {
    const auth = request.auth!;
    const { assignmentId } = z.object({ assignmentId: z.string().uuid() }).parse(request.params);
    const body = z.object({
      indicator_id: z.string().uuid(),
      kind: z.enum(['comment', 'request_info', 'reply']),
      body: z.string().trim().min(1).max(2000),
      parent_id: z.string().uuid().nullable().optional(),
    }).parse(request.body);
    const a = await getAssignmentDetail(assignmentId);
    if (!a) throw new ApiError('RES-001', 'Assignment not found');
    const actor = await actorOn('createAssignmentComment', auth, a);

    if (!(await indicatorInFramework(body.indicator_id, a.round.cycle.frameworkVersionId))) {
      throw new ApiError('VAL-002', 'indicator_id is not in this cycle\'s framework', [{ field: 'indicator_id', issue: 'unknown' }]);
    }
    if (actor === 'evaluatee' && body.kind !== 'reply') {
      throw new ApiError('VAL-002', 'The evaluatee replies to comments; they do not open them', [{ field: 'kind', issue: 'reply only' }]);
    }
    if (body.kind === 'reply') {
      const parent = body.parent_id ? await getAssignmentComment(body.parent_id) : null;
      if (!parent || parent.assignmentId !== a.id || parent.indicatorId !== body.indicator_id) {
        throw new ApiError('VAL-002', 'A reply needs parent_id: a comment on this assignment and indicator', [{ field: 'parent_id', issue: 'required' }]);
      }
    } else if (body.parent_id) {
      throw new ApiError('VAL-002', 'Only a reply has a parent', [{ field: 'parent_id', issue: 'must be null' }]);
    }

    const row = await createAssignmentComment({
      assignmentId: a.id, schoolId: a.schoolId, indicatorId: body.indicator_id, kind: body.kind, body: body.body,
      parentId: body.kind === 'reply' ? body.parent_id! : null, authorUserId: auth.userId, authorRole: actor, requestId: request.id,
    });
    reply.status(201);
    return serializeComment(row);
  });
};
