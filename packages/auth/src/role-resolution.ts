// Turns raw SchoolMembership rows (fetched fresh per request by packages/database)
// into the tenancy context apps/api's permission middleware checks against. Pure
// function — no I/O — so it's trivially unit-testable and has no framework coupling.
import type { Role } from '@seip/backend-shared';

export interface MembershipRow {
  role: Role;
  membershipScope: 'school' | 'area';
  schoolId: string | null;
  areaId: string | null;
  status: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

export interface TenancyContext {
  userId: string;
  /** schoolId -> roles held at that school (a user may hold different roles at different schools). */
  schoolRoles: Map<string, Set<Role>>;
  /** areaId -> roles held (always area_admin per permissions.yaml, but kept general). */
  areaRoles: Map<string, Set<Role>>;
}

function isActiveNow(m: MembershipRow, now: Date): boolean {
  if (m.status !== 'active') return false;
  if (m.effectiveFrom > now) return false;
  if (m.effectiveTo && m.effectiveTo < now) return false;
  return true;
}

export function resolveTenancy(userId: string, memberships: MembershipRow[], now = new Date()): TenancyContext {
  const schoolRoles = new Map<string, Set<Role>>();
  const areaRoles = new Map<string, Set<Role>>();

  for (const m of memberships) {
    if (!isActiveNow(m, now)) continue;
    if (m.membershipScope === 'school' && m.schoolId) {
      const set = schoolRoles.get(m.schoolId) ?? new Set<Role>();
      set.add(m.role);
      schoolRoles.set(m.schoolId, set);
    } else if (m.membershipScope === 'area' && m.areaId) {
      const set = areaRoles.get(m.areaId) ?? new Set<Role>();
      set.add(m.role);
      areaRoles.set(m.areaId, set);
    }
  }

  return { userId, schoolRoles, areaRoles };
}

/** Does this context hold `role` at `schoolId` (direct membership only — area-wide
 * read access is a SEPARATE check, see hasAreaReadAccess, because it grants a
 * different grant level ('area-r'), never a same-role match). */
export function hasSchoolRole(ctx: TenancyContext, schoolId: string, role: Role): boolean {
  return ctx.schoolRoles.get(schoolId)?.has(role) ?? false;
}

/** True if the user holds area_admin over an area, and that area contains schoolId.
 * Caller supplies the school's areaId (School.areaId) since this module has no DB access. */
export function hasAreaReadAccess(ctx: TenancyContext, schoolAreaId: string | null): boolean {
  if (!schoolAreaId) return false;
  return ctx.areaRoles.get(schoolAreaId)?.has('area_admin') ?? false;
}
