// Identity: UserAccount, SchoolMembership, PersonnelProfile, RefreshToken.
// Not school-scoped by a single schoolId parameter (a user's memberships SPAN
// schools) — tenancy here means "return only what belongs to this user", which
// every function does by construction (userId is always the filter root).
import type { Role, RoleFamily } from '@prisma/client';
import { prisma } from '../client.js';
import { writeAuditEvent } from '../audit.js';
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

// ── onboarding (CCR-014) ──
//
// Everything below IS school-scoped, unlike the user-rooted functions above:
// these serve a school_admin managing their own school, so schoolId is the first
// parameter and folds into the WHERE by construction (SEC-TEN-1), exactly like
// the evidence and cycles repositories.

export interface PersonnelSummaryRow {
  id: string;
  fullName: string;
  employeeCode: string | null;
  positionRole: RoleFamily;
  rankLevelCode: string;
  status: string;
}

export async function listPersonnelForSchool(
  schoolId: string,
  opts: { status?: 'active' | 'inactive' | 'all'; positionRole?: RoleFamily } = {},
): Promise<PersonnelSummaryRow[]> {
  const status = opts.status ?? 'active';
  return prisma.personnelProfile.findMany({
    where: {
      schoolId,
      ...(status === 'all' ? {} : { status }),
      ...(opts.positionRole ? { positionRole: opts.positionRole } : {}),
    },
    select: { id: true, fullName: true, employeeCode: true, positionRole: true, rankLevelCode: true, status: true },
    orderBy: [{ fullName: 'asc' }],
  });
}

/** A membership is "current" when it has not been ended. effectiveTo is a DATE,
 * so an offboarding recorded today is still >= today until tomorrow — matching
 * endMembership, which grants the rest of the day rather than retroactively
 * cutting a session that already exists. */
function currentMembershipWhere() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return { OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }] };
}

export async function listMembersForSchool(schoolId: string, opts: { status?: 'current' | 'all' } = {}) {
  const rows = await prisma.schoolMembership.findMany({
    where: {
      schoolId,
      ...(opts.status === 'all' ? {} : currentMembershipWhere()),
    },
    select: {
      id: true,
      userId: true,
      role: true,
      effectiveFrom: true,
      effectiveTo: true,
      user: { select: { email: true, displayName: true, status: true } },
    },
    orderBy: [{ effectiveFrom: 'desc' }],
  });

  // Personnel is per (school, user), not per membership — fetched in one query
  // rather than N, and matched in memory.
  const personnel = await prisma.personnelProfile.findMany({
    where: { schoolId, userId: { in: rows.map((r) => r.userId) } },
    select: { id: true, userId: true, fullName: true, employeeCode: true, positionRole: true, rankLevelCode: true, status: true },
  });
  const byUser = new Map(personnel.map((p) => [p.userId, p]));

  return rows.map((r) => ({ ...r, personnel: byUser.get(r.userId) ?? null }));
}

export interface InviteMemberInput {
  schoolId: string;
  actorUserId: string;
  email: string;
  displayName: string;
  role: Role;
  personnel?: {
    fullName: string;
    employeeCode?: string | null;
    positionRole: RoleFamily;
    rankLevelCode: string;
  };
  /** Pre-hashed by the caller; this layer never sees the raw token. */
  inviteTokenHash: string;
  inviteExpiresAt: Date;
  requestId?: string;
}

export type InviteMemberResult =
  | { ok: true; membershipId: string; userId: string; issuedInvite: boolean }
  | { ok: false; reason: 'already_a_member' };

/**
 * Creates account + membership + optional personnel atomically.
 *
 * Two things here are load-bearing:
 *
 * 1. **An existing account with a password NEVER receives an invite token.**
 *    Otherwise `inviteMember` doubles as an admin-triggered password reset for
 *    any email in the system, and any school_admin could take over an account in
 *    a school they have no membership in. `issuedInvite` reports which path ran
 *    so the route can null the token out of the response.
 *
 * 2. **The overlap check is done here, in the transaction, not by the database.**
 *    `schema.prisma` claims "no-overlapping-active-membership" is a constraint,
 *    but that partial unique index did not survive the Postgres → MySQL move
 *    (ADR-0008) — only `membership_scope_ids` exists in
 *    20260718210100_constraints. So the invariant is application-enforced, and
 *    the read and the write must share a transaction or two concurrent invites
 *    both pass the check.
 */
export async function inviteMember(input: InviteMemberInput): Promise<InviteMemberResult> {
  const email = input.email.toLowerCase(); // DB CHECK compares against LOWER(email) as BINARY
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.userAccount.findUnique({
      where: { email },
      select: { id: true, passwordHash: true, status: true },
    });

    if (existing) {
      const clash = await tx.schoolMembership.findFirst({
        where: { userId: existing.id, schoolId: input.schoolId, ...currentMembershipWhere() },
        select: { id: true },
      });
      if (clash) return { ok: false, reason: 'already_a_member' } as const;
    }

    const hasCredential = Boolean(existing?.passwordHash);
    const issuedInvite = !hasCredential;

    const user = existing
      ? // Only re-issue an invite to an account that never completed one. An
        // account with a password keeps it untouched (see note 1 above).
        issuedInvite
        ? await tx.userAccount.update({
            where: { id: existing.id },
            data: { inviteTokenHash: input.inviteTokenHash, inviteExpiresAt: input.inviteExpiresAt },
            select: { id: true, status: true },
          })
        : { id: existing.id, status: existing.status }
      : await tx.userAccount.create({
          data: {
            email,
            displayName: input.displayName,
            status: 'invited',
            inviteTokenHash: input.inviteTokenHash,
            inviteExpiresAt: input.inviteExpiresAt,
          },
          select: { id: true, status: true },
        });

    const membership = await tx.schoolMembership.create({
      data: {
        userId: user.id,
        schoolId: input.schoolId,
        role: input.role,
        membershipScope: 'school',
        effectiveFrom: today,
        status: 'active',
      },
      select: { id: true },
    });

    if (input.personnel) {
      const profile = await tx.personnelProfile.create({
        data: {
          schoolId: input.schoolId,
          userId: user.id,
          fullName: input.personnel.fullName,
          employeeCode: input.personnel.employeeCode ?? null,
          positionRole: input.personnel.positionRole,
          rankLevelCode: input.personnel.rankLevelCode,
          status: 'active',
        },
        select: { id: true, schoolId: true, userId: true, positionRole: true, rankLevelCode: true, status: true },
      });
      await writeAuditEvent(
        {
          schoolId: input.schoolId,
          actorUserId: input.actorUserId,
          action: 'personnel_created',
          entityType: 'PersonnelProfile',
          entityId: profile.id,
          after: profile,
          requestId: input.requestId,
        },
        tx,
      );
    }

    // Membership changes who can reach PDPA-scoped evidence — audited, in the
    // same transaction, so a rollback un-says it.
    await writeAuditEvent(
      {
        schoolId: input.schoolId,
        actorUserId: input.actorUserId,
        action: 'membership_granted',
        entityType: 'SchoolMembership',
        entityId: membership.id,
        after: { id: membership.id, userId: user.id, schoolId: input.schoolId, role: input.role, status: 'active' },
        requestId: input.requestId,
      },
      tx,
    );

    return { ok: true, membershipId: membership.id, userId: user.id, issuedInvite } as const;
  });
}

export type AcceptInviteResult = { ok: true; userId: string } | { ok: false };

/**
 * Consumes an invite: sets the password, activates the account, and clears the
 * token in ONE transaction — that is what makes the token single-use.
 *
 * The lookup is by hash and includes the expiry test, so an expired token is
 * indistinguishable from an unknown one at this layer too; the caller cannot
 * accidentally leak the difference (AUTH-005).
 */
export async function acceptInvite(
  inviteTokenHash: string,
  passwordHash: string,
  requestId?: string,
): Promise<AcceptInviteResult> {
  return prisma.$transaction(async (tx) => {
    const candidate = await tx.userAccount.findUnique({
      where: { inviteTokenHash },
      select: { id: true },
    });
    if (!candidate) return { ok: false } as const;

    // updateMany, not update: the WHERE is re-evaluated at write time, so the
    // token hash and expiry are checked again against the row being written.
    // Two concurrent accepts of the same token cannot both succeed — the loser
    // matches 0 rows. Same compare-and-swap shape as the outbox claim.
    const claimed = await tx.userAccount.updateMany({
      where: { id: candidate.id, inviteTokenHash, inviteExpiresAt: { gt: new Date() } },
      data: { passwordHash, status: 'active', inviteTokenHash: null, inviteExpiresAt: null },
    });
    if (claimed.count === 0) return { ok: false } as const;

    const user = { id: candidate.id };

    await writeAuditEvent(
      {
        schoolId: null, // account-level event; the account may span schools
        actorUserId: user.id,
        action: 'invite_accepted',
        entityType: 'UserAccount',
        entityId: user.id,
        after: { id: user.id, status: 'active' },
        requestId,
      },
      tx,
    );
    return { ok: true, userId: user.id } as const;
  });
}

/** Offboarding. Scoped by schoolId so an admin cannot end a membership at
 * another school even with a valid membership id (SEC-TEN-1); a miss returns
 * null and the route maps that to RES-001, never revealing existence. */
export async function endMembership(schoolId: string, membershipId: string, actorUserId: string, requestId?: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const existing = await prisma.schoolMembership.findFirst({
    where: { id: membershipId, schoolId },
    select: { id: true, userId: true, role: true, status: true, effectiveTo: true },
  });
  if (!existing) return null;

  // Idempotent: an already-ended membership keeps its original end date rather
  // than being pushed forward by a second call.
  if (existing.effectiveTo === null) {
    await prisma.schoolMembership.update({ where: { id: membershipId }, data: { effectiveTo: today, status: 'ended' } });
    await writeAuditEvent({
      schoolId,
      actorUserId,
      action: 'membership_ended',
      entityType: 'SchoolMembership',
      entityId: membershipId,
      before: { id: existing.id, userId: existing.userId, schoolId, role: existing.role, status: existing.status },
      after: { id: existing.id, userId: existing.userId, schoolId, role: existing.role, status: 'ended' },
      requestId,
    });
  }

  return prisma.schoolMembership.findFirst({
    where: { id: membershipId, schoolId },
    select: {
      id: true,
      userId: true,
      role: true,
      effectiveFrom: true,
      effectiveTo: true,
      user: { select: { email: true, displayName: true, status: true } },
    },
  });
}

/** Validates that a rank code exists AND belongs to the given framework family.
 * A teacher rank on an administrator profile would silently select the wrong
 * framework's rubric rows, so this is VAL-003 territory, not a 500. */
export async function rankLevelMatchesFamily(rankLevelCode: string, positionRole: RoleFamily): Promise<boolean> {
  const row = await prisma.rankLevel.findUnique({
    where: { code: rankLevelCode },
    select: { roleFamily: true },
  });
  return row?.roleFamily === positionRole;
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
