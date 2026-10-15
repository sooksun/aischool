// CCR-021 (FR-090): an area admin manages the schools of their own สพท. — the
// only writes an area-scoped role holds (permissions.yaml area_admin_writes).
// Another area's school or area is RES-001 (it does not exist for this caller);
// a caller who administers no area at all is PERM-001.
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  getAreaById, getSchoolRecord, listMembersForSchool, listSchoolsInArea, createSchoolInArea, updateSchoolRecord,
  listAreaDpos, appointAreaDpo,
} from '@seip/database';
import { generateInviteToken, hashInviteToken, inviteTokenExpiryDate } from '@seip/auth';
import { ApiError, forbiddenRole } from '@seip/backend-shared';
import type { AuthedRequest } from '../plugins/auth.js';
import { requireAcr } from '../lib/permission-guard.js';
import { checkInvite, performInvite, serializeMember } from './members.js';

function serializeSchool(s: { id: string; code: string; name: string; areaId: string | null; status: string }) {
  return { id: s.id, code: s.code, name: s.name, area_id: s.areaId, status: s.status };
}

function requireAreaAdmin(auth: AuthedRequest, areaId: string | null): string {
  const administered = [...auth.tenancy.areaRoles].filter(([, roles]) => roles.has('area_admin')).map(([id]) => id);
  if (administered.length === 0) throw forbiddenRole();
  if (!areaId || !administered.includes(areaId)) throw new ApiError('RES-001', 'Not found');
  return areaId;
}

async function requireManagedSchool(auth: AuthedRequest, schoolId: string) {
  const school = await getSchoolRecord(schoolId);
  requireAreaAdmin(auth, school?.areaId ?? null);
  return school!;
}

function serializeDpo(m: Awaited<ReturnType<typeof listAreaDpos>>[number]) {
  return {
    membership_id: m.id, user_id: m.user.id, email: m.user.email, display_name: m.user.displayName,
    user_status: m.user.status, effective_from: m.effectiveFrom.toISOString().slice(0, 10),
  };
}

const Uuid = z.string().uuid();
const CreateBody = z.object({ code: z.string().min(1).max(50), name: z.string().min(1).max(200) });
const PatchBody = z.object({
  name: z.string().min(1).max(200).optional(),
  status: z.enum(['active', 'inactive']).optional(),
}).refine((b) => b.name !== undefined || b.status !== undefined, 'at least one field');
const AppointBody = z.object({ email: z.string().email().max(320), display_name: z.string().min(1).max(200) });

export const areaRoutes: FastifyPluginAsync = async (app) => {
  app.get('/areas/:areaId/schools', { config: { operationId: 'listAreaSchools' } }, async (request) => {
    const { areaId } = z.object({ areaId: Uuid }).parse(request.params);
    requireAreaAdmin(request.auth!, (await getAreaById(areaId))?.id ?? null);
    return (await listSchoolsInArea(areaId)).map(serializeSchool);
  });

  app.post('/areas/:areaId/schools', { config: { operationId: 'createSchool' } }, async (request, reply) => {
    const auth = request.auth!;
    const { areaId } = z.object({ areaId: Uuid }).parse(request.params);
    requireAreaAdmin(auth, (await getAreaById(areaId))?.id ?? null);
    requireAcr(auth, 'createSchool');
    const body = CreateBody.parse(request.body);
    const school = await createSchoolInArea({ areaId, code: body.code, name: body.name }, auth.userId, request.id);
    if (!school) throw new ApiError('RES-002', 'A school with that code already exists');
    return reply.code(201).send(serializeSchool(school));
  });

  app.patch('/schools/:schoolId', { config: { operationId: 'updateSchool' } }, async (request) => {
    const auth = request.auth!;
    const { schoolId } = z.object({ schoolId: Uuid }).parse(request.params);
    await requireManagedSchool(auth, schoolId);
    requireAcr(auth, 'updateSchool');
    const body = PatchBody.parse(request.body);
    return serializeSchool(await updateSchoolRecord(schoolId, body, auth.userId, request.id));
  });

  // CCR-029: the area's DPO — an area-scoped membership whose only grants are the
  // data-subject request register. Listed and appointed by the area admin.
  app.get('/areas/:areaId/dpos', { config: { operationId: 'listAreaDpos' } }, async (request) => {
    const { areaId } = z.object({ areaId: Uuid }).parse(request.params);
    requireAreaAdmin(request.auth!, (await getAreaById(areaId))?.id ?? null);
    return (await listAreaDpos(areaId)).map(serializeDpo);
  });

  app.post('/areas/:areaId/dpos', { config: { operationId: 'appointDpo' } }, async (request, reply) => {
    const auth = request.auth!;
    const { areaId } = z.object({ areaId: Uuid }).parse(request.params);
    requireAreaAdmin(auth, (await getAreaById(areaId))?.id ?? null);
    requireAcr(auth, 'appointDpo');
    const body = AppointBody.parse(request.body);
    const rawToken = generateInviteToken();
    const expiresAt = inviteTokenExpiryDate();
    const r = await appointAreaDpo({
      areaId, email: body.email, displayName: body.display_name, actorUserId: auth.userId,
      inviteTokenHash: hashInviteToken(rawToken), inviteExpiresAt: expiresAt, requestId: request.id,
    });
    if (!r.ok) throw new ApiError('RES-003', 'That account is already a DPO of this area');
    const dpo = (await listAreaDpos(areaId)).find((m) => m.id === r.membershipId)!;
    return reply.code(201).send({
      dpo: serializeDpo(dpo),
      invite_token: r.issuedInvite ? rawToken : null,
      invite_expires_at: r.issuedInvite ? expiresAt.toISOString() : null,
    });
  });

  app.post('/schools/:schoolId/admins', { config: { operationId: 'appointSchoolAdmin' } }, async (request, reply) => {
    const auth = request.auth!;
    const { schoolId } = z.object({ schoolId: Uuid }).parse(request.params);
    const school = await requireManagedSchool(auth, schoolId);
    requireAcr(auth, 'appointSchoolAdmin');
    if (school.status !== 'active') throw new ApiError('VAL-002', 'The school is closed');
    const body = AppointBody.parse(request.body);
    const invite = { ...body, role: 'school_admin' as const };
    await checkInvite(invite);
    const done = await performInvite(schoolId, auth.userId, invite, request.id);
    const created = (await listMembersForSchool(schoolId, { status: 'all' })).find((r) => r.id === done.membershipId)!;
    return reply.code(201).send({
      member: serializeMember(created), invite_token: done.inviteToken, invite_expires_at: done.inviteExpiresAt,
    });
  });
};
