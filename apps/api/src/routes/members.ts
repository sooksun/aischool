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
import { resolveGrant } from '../lib/permission-guard.js';

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

    const body = z.object({
      email: z.string().email().max(320),
      display_name: z.string().min(1).max(200),
      role: z.enum(['teacher', 'director', 'deputy', 'evaluator', 'school_admin', 'area_admin']),
      personnel: z.object({
        full_name: z.string().min(1).max(200),
        employee_code: z.string().max(50).nullish(),
        position_role: z.enum(['teacher', 'administrator']),
        rank_level_code: z.string().min(1),
      }).optional(),
    }).parse(request.body);

    // area_admin is an AREA-scoped role (membership_scope=area); granting it a
    // school-scoped membership would produce a row that violates the
    // membership_scope_ids CHECK and surface as a 500.
    if (body.role === 'area_admin') {
      throw new ApiError('VAL-002', 'area_admin is an area-scoped role and cannot be granted as a school membership');
    }

    if (body.personnel) {
      // A teacher rank on an administrator profile silently selects the wrong
      // framework's rubric rows — VAL-003 (incompatible framework), not a 500.
      const ok = await rankLevelMatchesFamily(body.personnel.rank_level_code, body.personnel.position_role);
      if (!ok) {
        throw new ApiError('VAL-003', 'rank_level_code does not belong to the given position_role framework family');
      }
    }

    const rawToken = generateInviteToken();
    const expiresAt = inviteTokenExpiryDate();

    const result = await inviteMember({
      schoolId,
      actorUserId: auth.userId,
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
      requestId: request.id,
    });

    if (!result.ok) {
      throw new ApiError('RES-003', 'That email already holds a current membership in this school');
    }

    const rows = await listMembersForSchool(schoolId, { status: 'all' });
    const created = rows.find((r) => r.id === result.membershipId)!;

    // The raw token is returned exactly once and never persisted, so it cannot
    // be recovered later. Null when the account already had a password: issuing
    // one there would turn this into an admin-triggered password reset for any
    // email in the system — see the repository note and openapi's description.
    reply.status(201).send({
      member: serializeMember(created),
      invite_token: result.issuedInvite ? rawToken : null,
      invite_expires_at: result.issuedInvite ? expiresAt.toISOString() : null,
    });
  });

  app.post('/members/:membershipId/end', { config: { operationId: 'endMembership' } }, async (request) => {
    const auth = request.auth!;
    const schoolId = requireCurrentSchool(auth);
    const grant = await resolveGrant('endMembership', auth, schoolId);
    if (grant === 'area-r') throw forbiddenAreaWrite();

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
