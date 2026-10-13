// The enforcement half of SEC-TEN-5: reads the grant for (operationId, role)
// straight from permissions.yaml (via @seip/backend-shared, which loads the LOCKED
// contract file itself — see packages/backend-shared/src/permissions.ts). There is
// no hand-typed copy of the matrix in apps/api to drift from it.
import { grantFor, minAcrFor, type Role } from '@seip/backend-shared';
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

/**
 * For reference data that is not tied to one school (taxonomy): the caller must
 * hold, somewhere, a role that permissions.yaml grants this operation. Being
 * authenticated is not enough — an account with no live membership at all (an
 * ended transfer, a never-placed invitee) gets PERM-001 (FR-095).
 */
export function requireAnyGrant(operationId: string, auth: AuthedRequest): void {
  for (const roles of [...auth.tenancy.schoolRoles.values(), ...auth.tenancy.areaRoles.values()]) {
    for (const role of roles) if (grantFor(operationId, role)) return;
  }
  throw forbiddenRole();
}

/**
 * Step-up (ADR-0014, permissions.yaml `min_acr`). Call AFTER the role check, so a
 * caller who could never do this gets PERM-001 rather than being sent to
 * re-authenticate for nothing. Pass `action` for an action-keyed entry
 * (actOnMapping); without it the strictest action applies.
 */
export function requireAcr(auth: AuthedRequest, operationId: string, action?: string): void {
  if (!auth.enforceMinAcr) return;
  const needed = minAcrFor(operationId, action);
  if (auth.acr < needed) {
    throw new ApiError('AUTH-006', `Step-up authentication required (acr ${needed}, token has ${auth.acr})`);
  }
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
