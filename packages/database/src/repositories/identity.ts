// Identity: UserAccount, SchoolMembership, PersonnelProfile, RefreshToken.
// Not school-scoped by a single schoolId parameter (a user's memberships SPAN
// schools) — tenancy here means "return only what belongs to this user", which
// every function does by construction (userId is always the filter root).
import { prisma } from '../client.js';
import type { MembershipRow } from '@seip/auth';

export async function findUserByEmail(email: string) {
  // email is stored lowercase (DB CHECK constraint) — normalize on the way in too.
  return prisma.userAccount.findUnique({ where: { email: email.toLowerCase() } });
}

/** Login-only: the general findUserByEmail/getUserById deliberately omit
 * passwordHash so the hash doesn't casually flow through code that never needs it. */
export async function findUserByEmailForLogin(email: string) {
  return prisma.userAccount.findUnique({
    where: { email: email.toLowerCase() },
    select: { id: true, email: true, displayName: true, status: true, passwordHash: true },
  });
}

export async function getUserById(userId: string) {
  return prisma.userAccount.findUnique({ where: { id: userId } });
}

export async function getMembershipsForUser(userId: string): Promise<MembershipRow[]> {
  const rows = await prisma.schoolMembership.findMany({ where: { userId } });
  return rows.map((r) => ({
    role: r.role,
    membershipScope: r.membershipScope,
    schoolId: r.schoolId,
    areaId: r.areaId,
    status: r.status,
    effectiveFrom: r.effectiveFrom,
    effectiveTo: r.effectiveTo,
  }));
}

/** The caller's own PersonnelProfile at a given school, if they are staff there
 * (vs. e.g. an area_admin with no employment record). Drives CurrentUser.personnel
 * in the API (position_role + rank_level_code select the ว9/ว10 framework + rubric text). */
export async function getPersonnelForUser(userId: string, schoolId: string) {
  return prisma.personnelProfile.findFirst({
    where: { userId, schoolId, status: 'active' },
    select: { id: true, positionRole: true, rankLevelCode: true },
  });
}

export async function getSchoolAreaId(schoolId: string): Promise<string | null> {
  const school = await prisma.school.findUnique({ where: { id: schoolId }, select: { areaId: true } });
  return school?.areaId ?? null;
}

export async function getPersonnelById(personnelId: string) {
  return prisma.personnelProfile.findUnique({
    where: { id: personnelId },
    select: { id: true, schoolId: true, positionRole: true, fullName: true, userId: true },
  });
}

/** Existence check for a batch of user ids — used before creating rows with a
 * user FK (e.g. committee members) so a bad id surfaces as VAL-002, not a P2003
 * foreign-key crash mapped to a generic 500. */
export async function countExistingUserIds(userIds: string[]): Promise<number> {
  return prisma.userAccount.count({ where: { id: { in: userIds } } });
}

/** Committee eligibility (2026-07-18 audit fix): a committee seat requires an
 * ACTIVE evaluator or director membership at the assignment's school — the only
 * two roles permissions.yaml grants `submitMyScores` to, so any other seat could
 * never actually score and the ≥70%-per-evaluator rule could never be met.
 * Returns how many of the given userIds qualify; the caller compares to the
 * committee size. Distinct so a user with duplicate memberships can't inflate. */
export async function countCommitteeEligibleUserIds(schoolId: string, userIds: string[]): Promise<number> {
  const rows = await prisma.schoolMembership.findMany({
    where: {
      schoolId,
      userId: { in: userIds },
      status: 'active',
      role: { in: ['evaluator', 'director'] },
    },
    select: { userId: true },
    distinct: ['userId'],
  });
  return rows.length;
}

// ── refresh tokens (SEC-AUTH-2: rotation with reuse detection) ──

export async function createRefreshToken(userId: string, tokenHash: string, expiresAt: Date) {
  return prisma.refreshToken.create({ data: { userId, tokenHash, expiresAt } });
}

export async function findActiveRefreshToken(tokenHash: string) {
  return prisma.refreshToken.findUnique({ where: { tokenHash } });
}

/** Rotation: revoke the presented token and mint its replacement's hash into the
 * same row (replacedById) so a later replay of the OLD token is detectable — its
 * revokedAt is set, which the caller treats as a theft signal (SEC-AUTH-2). */
export async function rotateRefreshToken(oldTokenId: string, newTokenId: string) {
  await prisma.refreshToken.update({
    where: { id: oldTokenId },
    data: { revokedAt: new Date(), replacedById: newTokenId },
  });
}

export async function revokeRefreshToken(tokenId: string) {
  await prisma.refreshToken.update({ where: { id: tokenId }, data: { revokedAt: new Date() } });
}

/** Logout-everywhere / theft response: revoke every live token for the user. */
export async function revokeAllRefreshTokensForUser(userId: string) {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
