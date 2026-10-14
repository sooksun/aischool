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
import { getAssignmentDetail, getCommitteeMembership, listCommitteeEvidence, getPersonIdOfPersonnel, getSchoolAreaId } from '@seip/database';
import { ApiError } from '@seip/backend-shared';
import { resolveGrant, type Grant } from '../lib/permission-guard.js';
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
        const foothold = auth.tenancy.schoolRoles.has(assignment.schoolId) || (!!areaId && !!auth.tenancy.areaRoles.get(areaId)?.has('area_admin'));
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
