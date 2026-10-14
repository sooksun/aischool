// getCoverage (FR-052/053/056/057): indicator coverage for a person, a school
// or an area. Grants (permissions.yaml): a person's own portfolio (own), the
// staff of the caller's school (school), an evaluatee of the caller's committee
// seat (committee), and the schools of the caller's area, read-only (area-r).
// School and area scope return counts only (people_count, never names).
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  coverageCounts, countPeopleAtSchools, listActiveSchoolIdsOfPerson, listSchoolIdsInArea,
  listEvaluateePersonIdsForCommitteeMember, getFrameworkById, prisma,
} from '@seip/database';
import { ApiError, forbiddenRole } from '@seip/backend-shared';
import type { AuthedRequest } from '../plugins/auth.js';
import { resolveGrant } from '../lib/permission-guard.js';
import { ownGrant } from '../lib/evidence-access.js';

const OP = 'getCoverage';

/** True when some role the caller holds at one of these schools (or their area) grants getCoverage. */
async function anyGrantAt(auth: AuthedRequest, schoolIds: string[]): Promise<boolean> {
  for (const schoolId of schoolIds) {
    try {
      const g = await resolveGrant(OP, auth, schoolId);
      if (g === 'school' || g === 'area-r') return true;
    } catch { /* no role there */ }
  }
  return false;
}

async function authorizePerson(auth: AuthedRequest, personId: string): Promise<void> {
  if (auth.personId === personId && ownGrant(OP, auth)) return;
  if (await anyGrantAt(auth, await listActiveSchoolIdsOfPerson(personId))) return;
  if ((await listEvaluateePersonIdsForCommitteeMember(auth.userId)).includes(personId)) {
    const roles = [...auth.tenancy.schoolRoles.values()].flatMap((s) => [...s]);
    if (roles.includes('evaluator') || roles.includes('director')) return;
  }
  // No route to this person at all — the same answer as a person who does not exist.
  throw new ApiError('RES-001', 'Not found');
}

export const coverageRoutes: FastifyPluginAsync = async (app) => {
  app.get('/coverage', { config: { operationId: OP } }, async (request) => {
    const auth = request.auth!;
    const q = z.object({
      subject_type: z.enum(['person', 'school', 'area']),
      subject_id: z.string().uuid(),
      framework_version_id: z.string().uuid(),
    }).parse(request.query);
    if (!(await getFrameworkById(q.framework_version_id))) throw new ApiError('VAL-002', 'Unknown framework_version_id');

    let indicators;
    let peopleCount: number | null = null;
    if (q.subject_type === 'person') {
      await authorizePerson(auth, q.subject_id);
      indicators = await coverageCounts(q.framework_version_id, { personId: q.subject_id });
    } else if (q.subject_type === 'school') {
      const school = await prisma.school.findUnique({ where: { id: q.subject_id }, select: { id: true } });
      if (!school) throw new ApiError('RES-001', 'Not found');
      const g = await resolveGrant(OP, auth, school.id); // PERM-001 without any role there
      if (g !== 'school' && g !== 'area-r') throw forbiddenRole();
      indicators = await coverageCounts(q.framework_version_id, { schoolIds: [school.id] });
      peopleCount = await countPeopleAtSchools([school.id]);
    } else {
      if (!auth.tenancy.areaRoles.get(q.subject_id)?.has('area_admin')) {
        if (auth.tenancy.areaRoles.size === 0) throw forbiddenRole();
        throw new ApiError('RES-001', 'Not found'); // another area
      }
      const schoolIds = await listSchoolIdsInArea(q.subject_id);
      indicators = await coverageCounts(q.framework_version_id, { schoolIds });
      peopleCount = await countPeopleAtSchools(schoolIds);
    }

    return {
      subject_type: q.subject_type,
      subject_id: q.subject_id,
      framework_version_id: q.framework_version_id,
      people_count: peopleCount,
      indicators: indicators.map((i) => ({
        indicator_id: i.indicatorId,
        indicator_code: i.indicatorCode,
        owner_confirmed: i.ownerConfirmed,
        validated: i.validated,
        returned: i.returned,
        open_suggestions: i.openSuggestions,
        eligibility_warnings: [],
      })),
    };
  });
};
