// Members, personnel and invitations (CCR-014). Everything here is school-scoped
// through requireCurrentSchool + resolveGrant, exactly like cycles.ts — there is
// no cross-school write anywhere in this contract, deliberately (CCR-014
// decision 2: no role holds that authority, and inventing a system_admin to hold
// it would rewrite every row of the permissions matrix).
//
// The counterpart operation, acceptInvite, lives in routes/auth.ts because it is
// unauthenticated and belongs to the session lifecycle rather than to admin.
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  listPersonnelForSchool, listMembersForSchool, inviteMember, endMembership, rankLevelMatchesFamily,
} from '@seip/database';
import { generateInviteToken, hashInviteToken, inviteTokenExpiryDate } from '@seip/auth';
import { ApiError, forbiddenAreaWrite } from '@seip/backend-shared';
import { requireCurrentSchool } from '../plugins/auth.js';
import { resolveGrant, requireAcr } from '../lib/permission-guard.js';

function serializePersonnel(p: {
  id: string; fullName: string; employeeCode: string | null;
  positionRole: string; rankLevelCode: string; status: string;
}) {
  return {
    id: p.id,
    full_name: p.fullName,
    employee_code: p.employeeCode,
    position_role: p.positionRole,
    rank_level_code: p.rankLevelCode,
    status: p.status,
  };
}

function serializeMember(m: {
  id: string; userId: string; role: string; effectiveFrom: Date; effectiveTo: Date | null;
  user: { email: string; displayName: string; status: string };
  personnel?: {
    id: string; fullName: string; employeeCode: string | null;
    positionRole: string; rankLevelCode: string; status: string;
  } | null;
}) {
  return {
    membership_id: m.id,
    user_id: m.userId,
    email: m.user.email,
    display_name: m.user.displayName,
    role: m.role,
    user_status: m.user.status,
    effective_from: m.effectiveFrom.toISOString().slice(0, 10),
    effective_to: m.effectiveTo ? m.effectiveTo.toISOString().slice(0, 10) : null,
    personnel: m.personnel ? serializePersonnel(m.personnel) : null,
  };
}

const InviteBody = z.object({
  email: z.string().email().max(320),
  display_name: z.string().min(1).max(200),
  role: z.enum(['teacher', 'director', 'deputy', 'evaluator', 'school_admin', 'area_admin']),
  personnel: z.object({
    full_name: z.string().min(1).max(200),
    employee_code: z.string().max(50).nullish(),
    position_role: z.enum(['teacher', 'administrator']),
    rank_level_code: z.string().min(1),
  }).optional(),
});
type Invite = z.infer<typeof InviteBody>;

/** The checks an invite must pass before anything is written (inviteMember and importMembers). */
async function checkInvite(body: Invite): Promise<void> {
  // area_admin is an AREA-scoped role (membership_scope=area); granting it a
  // school-scoped membership would produce a row that violates the
  // membership_scope_ids CHECK and surface as a 500.
  if (body.role === 'area_admin') {
    throw new ApiError('VAL-002', 'area_admin is an area-scoped role and cannot be granted as a school membership');
  }
  // A teacher rank on an administrator profile silently selects the wrong
  // framework's rubric rows — VAL-003 (incompatible framework), not a 500.
  if (body.personnel && !(await rankLevelMatchesFamily(body.personnel.rank_level_code, body.personnel.position_role))) {
    throw new ApiError('VAL-003', 'rank_level_code does not belong to the given position_role framework family');
  }
}

/**
 * Writes one invite. The raw token is returned exactly once and never persisted,
 * so it cannot be recovered later. Null when the account already had a password:
 * issuing one there would turn this into an admin-triggered password reset for
 * any email in the system — see the repository note and openapi's description.
 */
async function performInvite(schoolId: string, actorUserId: string, body: Invite, requestId: string) {
  const rawToken = generateInviteToken();
  const expiresAt = inviteTokenExpiryDate();
  const result = await inviteMember({
    schoolId,
    actorUserId,
    email: body.email,
    displayName: body.display_name,
    role: body.role,
    personnel: body.personnel && {
      fullName: body.personnel.full_name,
      employeeCode: body.personnel.employee_code ?? null,
      positionRole: body.personnel.position_role,
      rankLevelCode: body.personnel.rank_level_code,
    },
    inviteTokenHash: hashInviteToken(rawToken),
    inviteExpiresAt: expiresAt,
    requestId,
  });
  if (!result.ok) throw new ApiError('RES-003', 'That email already holds a current membership in this school');
  return {
    membershipId: result.membershipId,
    inviteToken: result.issuedInvite ? rawToken : null,
    inviteExpiresAt: result.issuedInvite ? expiresAt.toISOString() : null,
  };
}

export const memberRoutes: FastifyPluginAsync = async (app) => {
  app.get('/personnel', { config: { operationId: 'listPersonnel' } }, async (request) => {
    const auth = request.auth!;
    const schoolId = requireCurrentSchool(auth);
    // Wider matrix row than the writes below (director/evaluator/area_admin can
    // read) — resolveGrant's throw-if-none IS the enforcement; no row filtering,
    // because this returns identity only, never evaluation data.
    await resolveGrant('listPersonnel', auth, schoolId);

    const q = z.object({
      status: z.enum(['active', 'inactive', 'all']).optional(),
      position_role: z.enum(['teacher', 'administrator']).optional(),
    }).parse(request.query);

    const rows = await listPersonnelForSchool(schoolId, {
      status: q.status,
      positionRole: q.position_role,
    });
    return rows.map(serializePersonnel);
  });

  app.get('/members', { config: { operationId: 'listMembers' } }, async (request) => {
    const auth = request.auth!;
    const schoolId = requireCurrentSchool(auth);
    await resolveGrant('listMembers', auth, schoolId);

    const q = z.object({ status: z.enum(['current', 'all']).optional() }).parse(request.query);
    const rows = await listMembersForSchool(schoolId, { status: q.status });
    return rows.map(serializeMember);
  });

  app.post('/members', { config: { operationId: 'inviteMember' } }, async (request, reply) => {
    const auth = request.auth!;
    // The school comes from the CALLER, never the body. MemberInvite has no
    // school_id property at all, so this is not a validation that could be
    // forgotten — there is nothing to forget. Accepting one would make this a
    // cross-tenant account factory.
    const schoolId = requireCurrentSchool(auth);
    const grant = await resolveGrant('inviteMember', auth, schoolId);
    if (grant === 'area-r') throw forbiddenAreaWrite();
    requireAcr(auth, 'inviteMember');

    const body = InviteBody.parse(request.body);
    await checkInvite(body);
    const done = await performInvite(schoolId, auth.userId, body, request.id);
    const created = (await listMembersForSchool(schoolId, { status: 'all' })).find((r) => r.id === done.membershipId)!;
    reply.status(201).send({ member: serializeMember(created), invite_token: done.inviteToken, invite_expires_at: done.inviteExpiresAt });
  });

  // CCR-019 / FR-091: the same invite, many rows. Each row passes or fails on its
  // own; a dry run runs every check and writes nothing.
  app.post('/members/import', { config: { operationId: 'importMembers' } }, async (request) => {
    const auth = request.auth!;
    const schoolId = requireCurrentSchool(auth);
    const grant = await resolveGrant('importMembers', auth, schoolId);
    if (grant === 'area-r') throw forbiddenAreaWrite();
    requireAcr(auth, 'importMembers');

    const body = z.object({
      rows: z.array(z.unknown()).min(1).max(500),
      dry_run: z.boolean().default(false),
    }).parse(request.body);

    // Emails already holding a current membership here: RES-003 per row, as the
    // single invite would answer, but found without touching the database again.
    const current = new Set((await listMembersForSchool(schoolId, { status: 'current' })).map((m) => m.user.email.toLowerCase()));
    const seen = new Set<string>();
    type RowResult = { row: number; status: 'invited' | 'would_invite' | 'rejected'; membershipId?: string;
      invite_token?: string | null; invite_expires_at?: string | null; error?: ReturnType<ApiError['toBody']> };
    const results: RowResult[] = [];

    for (const [i, raw] of body.rows.entries()) {
      const row = i + 1;
      try {
        const parsed = InviteBody.safeParse(raw);
        if (!parsed.success) {
          throw new ApiError('VAL-001', 'Row is not a valid invite', parsed.error.issues.map((x) => ({ field: x.path.join('.') || '(row)', issue: x.message })));
        }
        const invite = parsed.data;
        const email = invite.email.toLowerCase();
        if (seen.has(email)) throw new ApiError('VAL-002', 'The same email appears earlier in this import', [{ field: 'email', issue: 'duplicate in import' }]);
        seen.add(email);
        if (current.has(email)) throw new ApiError('RES-003', 'That email already holds a current membership in this school');
        await checkInvite(invite);
        if (body.dry_run) {
          results.push({ row, status: 'would_invite' });
          continue;
        }
        const done = await performInvite(schoolId, auth.userId, invite, request.id);
        current.add(email);
        results.push({ row, status: 'invited', membershipId: done.membershipId, invite_token: done.inviteToken, invite_expires_at: done.inviteExpiresAt });
      } catch (e) {
        if (!(e instanceof ApiError)) throw e;
        results.push({ row, status: 'rejected', error: e.toBody(request.id) });
      }
    }

    const members = results.some((r) => r.membershipId)
      ? new Map((await listMembersForSchool(schoolId, { status: 'all' })).map((m) => [m.id, m]))
      : new Map();
    return {
      dry_run: body.dry_run,
      results: results.map(({ membershipId, ...r }) => (membershipId ? { ...r, member: serializeMember(members.get(membershipId)!) } : r)),
    };
  });

  app.post('/members/:membershipId/end', { config: { operationId: 'endMembership' } }, async (request) => {
    const auth = request.auth!;
    const schoolId = requireCurrentSchool(auth);
    const grant = await resolveGrant('endMembership', auth, schoolId);
    if (grant === 'area-r') throw forbiddenAreaWrite();
    requireAcr(auth, 'endMembership');

    const { membershipId } = z.object({ membershipId: z.string().uuid() }).parse(request.params);

    // An admin ending their own last membership would lock the school out of its
    // own administration with no way back through the API (bootstrap is a CLI).
    const members = await listMembersForSchool(schoolId, { status: 'current' });
    const target = members.find((m) => m.id === membershipId);
    if (target?.userId === auth.userId && target.role === 'school_admin') {
      const otherAdmins = members.filter((m) => m.role === 'school_admin' && m.id !== membershipId);
      if (otherAdmins.length === 0) {
        throw new ApiError('VAL-002', 'Cannot end the last school_admin membership — invite another admin first');
      }
    }

    // Scoped by schoolId inside the repository, so a valid membership id from
    // another school misses and returns null → RES-001, never confirming it exists.
    const updated = await endMembership(schoolId, membershipId, auth.userId, request.id);
    if (!updated) throw new ApiError('RES-001', 'Membership not found');

    return serializeMember({ ...updated, personnel: null });
  });
};
