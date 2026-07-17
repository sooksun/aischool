// Populates request.auth for every route except the ones listed in
// permissions.yaml's `unauthenticated:` section (currently just login — see
// scripts/security/validate-contracts.mjs, which fails CI if a route is ever
// added without a disposition here or in that file).
import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyInstance, FastifyRequest } from 'fastify';
import {
  verifyAccessToken, AccessTokenExpiredError, resolveTenancy, hasSchoolRole, hasAreaReadAccess,
  type TenancyContext,
} from '@seip/auth';
import { getUserById, getMembershipsForUser, getPersonnelForUser, getSchoolAreaId } from '@seip/database';
import { ApiError, isExempt } from '@seip/backend-shared';
import type { Env } from '../env.js';

export interface AuthedRequest {
  userId: string;
  tenancy: TenancyContext;
  /** Resolved per CCR-003 — null if ambiguous/absent and the route needs one. */
  currentSchoolId: string | null;
  personnel: { id: string; positionRole: 'teacher' | 'administrator'; rankLevelCode: string } | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthedRequest;
  }
  interface FastifyContextConfig {
    /** Set on every route (config: { operationId: '<openapi.yaml operationId>' }) —
     * this is how the auth/error/permission layers stay keyed to the contract
     * instead of re-deriving an id from the URL. */
    operationId?: string;
  }
}

export const authPlugin: FastifyPluginAsync<{ env: Env }> = fp(async (app: FastifyInstance, { env }: { env: Env }) => {
  app.addHook('preHandler', async (request: FastifyRequest) => {
    const operationId = request.routeOptions?.config?.operationId as string | undefined;
    if (operationId && isExempt(operationId) === 'unauthenticated') return;

    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new ApiError('AUTH-001', 'Missing bearer token');
    const token = header.slice('Bearer '.length);

    let userId: string;
    try {
      ({ sub: userId } = await verifyAccessToken(token, env.JWT_SECRET));
    } catch (e) {
      if (e instanceof AccessTokenExpiredError) throw new ApiError('AUTH-002', 'Token expired');
      throw new ApiError('AUTH-001', 'Invalid token');
    }

    const user = await getUserById(userId);
    if (!user || user.status !== 'active') throw new ApiError('AUTH-003', 'Account disabled or not found');

    const memberships = await getMembershipsForUser(userId);
    const tenancy = resolveTenancy(userId, memberships);
    const currentSchoolId = await resolveCurrentSchool(request, tenancy);
    const personnel = currentSchoolId ? await getPersonnelForUser(userId, currentSchoolId) : null;

    request.auth = { userId, tenancy, currentSchoolId, personnel };
  });
});

/** CCR-003: one active school membership -> implicit; more than one -> X-School-Id
 * header, validated against the caller's own memberships (never trust the header
 * to grant access on its own — it only DISAMBIGUATES which of the caller's real
 * memberships applies). */
async function resolveCurrentSchool(request: FastifyRequest, tenancy: TenancyContext): Promise<string | null> {
  const schoolIds = [...tenancy.schoolRoles.keys()];
  if (schoolIds.length === 1) return schoolIds[0];

  const headerValue = request.headers['x-school-id'];
  const requested = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (!requested) return schoolIds.length === 0 ? null : null; // ambiguous or none — routes needing one will reject

  if (!schoolIds.includes(requested)) {
    throw new ApiError('PERM-002', 'X-School-Id does not match an active membership');
  }
  return requested;
}

/** Route helper: throws VAL-002 if no school context could be resolved. Call this
 * from any handler that requires request.auth.currentSchoolId to be non-null. */
export function requireCurrentSchool(auth: AuthedRequest): string {
  if (!auth.currentSchoolId) {
    throw new ApiError('VAL-002', 'Ambiguous or missing school context — send X-School-Id');
  }
  return auth.currentSchoolId;
}

export { hasSchoolRole, hasAreaReadAccess };
