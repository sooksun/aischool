// The enforcement half of SEC-TEN-5: reads the grant for (operationId, role)
// straight from permissions.yaml (via @seip/backend-shared, which loads the LOCKED
// contract file itself — see packages/backend-shared/src/permissions.ts). There is
// no hand-typed copy of the matrix in apps/api to drift from it.
import { grantFor, type Role } from '@seip/backend-shared';
import { ApiError, forbiddenRole } from '@seip/backend-shared';
import type { AuthedRequest } from '../plugins/auth.js';
import { getSchoolAreaId, listEvaluateePersonnelIdsForCommitteeMember } from '@seip/database';

export type Grant = 'own' | 'own-revoke' | 'school' | 'area-r' | 'committee';

/**
 * Resolves the grant this request holds for `operationId` against `schoolId` (the
 * resource's school — usually auth.currentSchoolId, but callers touching a specific
 * resource should pass THAT resource's schoolId once known, so a multi-school user
 * is checked against the resource's actual owner, not just their "current" pick).
 * Throws PERM-001 if no role held anywhere applicable grants this operation at all.
 */
export async function resolveGrant(
  operationId: string,
  auth: AuthedRequest,
  schoolId: string,
): Promise<Grant> {
  const rolesAtSchool = auth.tenancy.schoolRoles.get(schoolId);
  if (rolesAtSchool) {
    for (const role of rolesAtSchool) {
      const g = grantFor(operationId, role);
      if (g) return g as Grant;
    }
  }

  // area_admin: only reachable if the resource's school belongs to an area the
  // caller administers (hasAreaReadAccess semantics, re-derived here from the
  // resource's own school rather than "current school" — an area_admin has no
  // single "current school" to begin with).
  const areaId = await getSchoolAreaId(schoolId);
  if (areaId && auth.tenancy.areaRoles.get(areaId)?.has('area_admin')) {
    const g = grantFor(operationId, 'area_admin');
    if (g) return g as Grant;
  }

  throw forbiddenRole();
}

/** For operations with an 'own' grant: verify the resource's owner matches the
 * caller's OWN personnel id at that school. Not enough to hold the role — must
 * also be the resource's owner, or the grant degrades to PERM-001. */
export function requireOwnership(auth: AuthedRequest, ownerPersonnelId: string): void {
  if (!auth.personnel || auth.personnel.id !== ownerPersonnelId) {
    throw forbiddenRole();
  }
}

/** For operations with a 'committee' grant on a personnel-owned resource
 * (evidence, mappings): verify the resource's owner is someone the caller
 * currently sits on a committee for. Mirrors requireOwnership's shape for the
 * 'own' grant — holding the evaluator/director role is not enough by itself. */
export async function requireCommitteeAccessToPersonnel(
  schoolId: string, evaluatorUserId: string, ownerPersonnelId: string,
): Promise<void> {
  const evaluateeIds = await listEvaluateePersonnelIdsForCommitteeMember(schoolId, evaluatorUserId);
  if (!evaluateeIds.includes(ownerPersonnelId)) throw forbiddenRole();
}
