// Who may act on a person-owned evidence item (ADR-0015, CCR-017).
//
// Evidence used to be school-owned, and access was "a role at THIS school". A
// portfolio now belongs to a person and moves with them, so there are three
// independent routes in, checked in this order:
//
//   1. the caller IS the owner, and holds some role whose grant for this
//      operation is `own` / `own-revoke` — from any school. A teacher who moved
//      schools keeps their portfolio.
//   2. a grant at the item's ORIGIN school (director / school_admin `school`,
//      area_admin `area-r` via the school's ESA). An `own` grant at that school
//      does NOT let a non-owner in.
//   3. a `committee` grant, if the caller sits on a committee for the owner.
//
// A caller with no route at all gets RES-001 — the same answer as a missing id,
// so the item's existence never leaks (permissions.yaml tenancy rule). PERM-001 is
// reserved for "you can see this school, but your role may not do this".
import { grantFor, ApiError, forbiddenRole } from '@seip/backend-shared';
import { getSchoolAreaId, listEvaluateePersonIdsForCommitteeMember } from '@seip/database';
import type { AuthedRequest } from '../plugins/auth.js';
import { resolveGrant, type Grant } from './permission-guard.js';

export interface EvidenceRef {
  ownerPersonId: string;
  originSchoolId: string;
}

/** Roles the caller holds anywhere (any school, any area). */
function allRoles(auth: AuthedRequest): Set<string> {
  const roles = new Set<string>();
  for (const set of auth.tenancy.schoolRoles.values()) for (const r of set) roles.add(r);
  for (const set of auth.tenancy.areaRoles.values()) for (const r of set) roles.add(r);
  return roles;
}

/** The caller's own-type grant for an operation, from any role they hold. */
export function ownGrant(operationId: string, auth: AuthedRequest): Grant | null {
  for (const role of allRoles(auth)) {
    const g = grantFor(operationId, role as never);
    if (g === 'own' || g === 'own-revoke') return g as Grant;
  }
  return null;
}

export function isOwner(auth: AuthedRequest, ev: EvidenceRef): boolean {
  return auth.personId !== null && auth.personId === ev.ownerPersonId;
}

export async function authorizeEvidence(operationId: string, auth: AuthedRequest, ev: EvidenceRef): Promise<Grant> {
  if (isOwner(auth, ev)) {
    const g = ownGrant(operationId, auth);
    if (g) return g;
  }

  let grant: Grant;
  try {
    grant = await resolveGrant(operationId, auth, ev.originSchoolId);
  } catch (e) {
    // No role at the origin school (or its ESA) at all. Before answering
    // "not found", the committee route may still apply — a committee member is
    // often from another school.
    if (await onCommitteeFor(operationId, auth, ev)) return 'committee';
    if (e instanceof ApiError && e.code === 'PERM-001' && !(await hasAnyFootholdAt(auth, ev.originSchoolId))) {
      throw new ApiError('RES-001', 'Evidence not found');
    }
    throw e;
  }

  if (grant === 'own' || grant === 'own-revoke') {
    // The role's grant is own-scoped and the caller is not the owner.
    if (await onCommitteeFor(operationId, auth, ev)) return 'committee';
    throw new ApiError('RES-001', 'Evidence not found');
  }
  if (grant === 'committee') {
    if (await onCommitteeFor(operationId, auth, ev)) return 'committee';
    throw forbiddenRole();
  }
  return grant;
}

async function onCommitteeFor(operationId: string, auth: AuthedRequest, ev: EvidenceRef): Promise<boolean> {
  const roles = allRoles(auth);
  const canCommittee = [...roles].some((r) => grantFor(operationId, r as never) === 'committee');
  if (!canCommittee) return false;
  const persons = await listEvaluateePersonIdsForCommitteeMember(auth.userId);
  return persons.includes(ev.ownerPersonId);
}

/** A membership at the school, or area_admin over its area: the caller can see
 * the school exists, so a role denial there is PERM-001, not a hidden RES-001. */
async function hasAnyFootholdAt(auth: AuthedRequest, schoolId: string): Promise<boolean> {
  if (auth.tenancy.schoolRoles.has(schoolId)) return true;
  const areaId = await getSchoolAreaId(schoolId);
  return !!areaId && !!auth.tenancy.areaRoles.get(areaId)?.has('area_admin');
}
