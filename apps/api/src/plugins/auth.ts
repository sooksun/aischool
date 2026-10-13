// Populates request.auth for every route except the ones listed in
// permissions.yaml's `unauthenticated:` section (currently just login — see
// scripts/security/validate-contracts.mjs, which fails CI if a route is ever
// added without a disposition here or in that file).
import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyInstance, FastifyRequest } from 'fastify';
import {
  verifyAccessToken, AccessTokenExpiredError, resolveTenancy, hasSchoolRole, hasAreaReadAccess,
  isExternalToken, OWN_TOKEN_ACR, effectiveAcr,
  type TenancyContext,
} from '@seip/auth';
import {
  getUserById, getMembershipsForUser, getPersonnelForUser, getSchoolAreaId,
  getLiveWebSession, touchWebSession, claimKeycloakCheck, recordKeycloakCheck, revokeWebSession,
} from '@seip/database';
import { ApiError, isExempt } from '@seip/backend-shared';
import type { Env } from '../env.js';
import type { Keycloak } from '../lib/keycloak.js';
import {
  KC_CHECK_EVERY_MS, SESSION_COOKIE, equalSecrets, openRefreshToken, parseCookies, sealRefreshToken, sha256,
} from '../lib/web-session.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
/** A request that wins the Keycloak check holds it this long before another may try. */
const KC_CHECK_LEASE_MS = 30 * 1000;

export interface AuthedRequest {
  userId: string;
  tenancy: TenancyContext;
  /** Resolved per CCR-003 — null if ambiguous/absent and the route needs one. */
  currentSchoolId: string | null;
  personnel: { id: string; positionRole: 'teacher' | 'administrator'; rankLevelCode: string } | null;
  /** The person this account belongs to (ADR-0015) — the owner key of a
   * portfolio. Null only for an account that has no person yet. */
  personId: string | null;
  /** Level of authentication of this token (ADR-0014): 1 password, 2 second
   * factor. The API's own tokens are 1; Keycloak's say what the login did. */
  acr: number;
  /** Whether permissions.yaml `min_acr` is enforced (ENFORCE_MIN_ACR). */
  enforceMinAcr: boolean;
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

type AuthPluginOptions = { env: Env; keycloak: Keycloak | null };

export const authPlugin: FastifyPluginAsync<AuthPluginOptions> = fp(async (app: FastifyInstance, { env, keycloak }: AuthPluginOptions) => {
  /** Bearer token (mobile, scripts, tests): HS256 is ours; anything else is
   * Keycloak's, and only if a realm is configured. Without one an RS256 token is
   * simply invalid (AUTH-001). */
  async function fromBearer(token: string): Promise<{ userId: string; acr: number }> {
    try {
      if (keycloak && isExternalToken(token)) {
        const { userId, acr } = await keycloak.verifyAccessToken(token);
        return { userId, acr };
      }
      const { sub } = await verifyAccessToken(token, env.JWT_SECRET);
      return { userId: sub, acr: OWN_TOKEN_ACR };
    } catch (e) {
      if (e instanceof AccessTokenExpiredError) throw new ApiError('AUTH-002', 'Token expired');
      throw new ApiError('AUTH-001', 'Invalid token');
    }
  }

  /** Cookie session (web BFF, CCR-018): live row, CSRF on writes, and at most
   * once a minute a refresh against Keycloak so a session ended there (logout
   * elsewhere, admin revoke) ends here too. */
  async function fromSession(request: FastifyRequest, cookie: string): Promise<{ userId: string; acr: number }> {
    const session = await getLiveWebSession(sha256(cookie));
    if (!session) throw new ApiError('AUTH-001', 'Session expired or unknown');
    if (!SAFE_METHODS.has(request.method)) {
      const header = request.headers['x-csrf-token'];
      if (typeof header !== 'string' || !equalSecrets(sha256(header), session.csrfHash)) {
        throw new ApiError('AUTH-007', 'X-CSRF-Token missing or does not match the session');
      }
    }
    const web = keycloak?.web;
    if (web && session.kcCheckDueAt <= new Date() && await claimKeycloakCheck(session.id, KC_CHECK_LEASE_MS)) {
      try {
        const fresh = await web.refresh(openRefreshToken(env.JWT_SECRET, session.kcRefreshToken));
        if (!fresh) {
          await revokeWebSession(session.id);
          throw new ApiError('AUTH-001', 'Session ended at the identity provider');
        }
        await recordKeycloakCheck(session.id, sealRefreshToken(env.JWT_SECRET, fresh.refreshToken), new Date(Date.now() + KC_CHECK_EVERY_MS));
      } catch (e) {
        if (e instanceof ApiError) throw e;
        // Keycloak unreachable: keep the session and try again after the lease.
        // Revocation waits for Keycloak to answer; availability does not.
        request.log.warn({ err: e }, 'web session: keycloak check failed; retrying later');
      }
    }
    await touchWebSession(session);
    // The session's sign-in is its auth time; a step-up does not last its 8 h.
    return { userId: session.userId, acr: effectiveAcr(session.acr, session.createdAt.getTime() / 1000) };
  }

  app.addHook('preHandler', async (request: FastifyRequest) => {
    const operationId = request.routeOptions?.config?.operationId as string | undefined;
    if (operationId && isExempt(operationId) === 'unauthenticated') return;

    const header = request.headers.authorization;
    const cookie = parseCookies(request.headers.cookie)[SESSION_COOKIE];
    let identity: { userId: string; acr: number };
    if (header?.startsWith('Bearer ')) identity = await fromBearer(header.slice('Bearer '.length));
    else if (cookie) identity = await fromSession(request, cookie);
    else throw new ApiError('AUTH-001', 'Missing bearer token or session');
    const { userId, acr } = identity;

    const user = await getUserById(userId);
    if (!user || user.status !== 'active') throw new ApiError('AUTH-003', 'Account disabled or not found');

    const memberships = await getMembershipsForUser(userId);
    const tenancy = resolveTenancy(userId, memberships);
    const currentSchoolId = await resolveCurrentSchool(request, tenancy);
    const personnel = currentSchoolId ? await getPersonnelForUser(userId, currentSchoolId) : null;

    request.auth = {
      userId, tenancy, currentSchoolId, personnel, personId: user.personId ?? null,
      acr, enforceMinAcr: env.ENFORCE_MIN_ACR,
    };
  });
});

/** CCR-003: one active school membership -> implicit; more than one -> X-School-Id
 * header, validated against the caller's own memberships (never trust the header
 * to grant access on its own — it only DISAMBIGUATES which of the caller's real
 * memberships applies).
 *
 * A caller with NO direct school membership but an area_admin membership (e.g. a
 * pure area role, never also school staff) has no schoolIds to pick from at all —
 * their only route to a "current school" is via X-School-Id naming a school inside
 * an area they administer. Found by tests/security/permission-matrix.test.mjs: the
 * first version of this function rejected every area_admin header with PERM-002
 * because `schoolIds` (direct memberships only) is legitimately empty for them,
 * which is a false denial, not a security gap — but it made every area-scoped
 * write correctly fail for the WRONG reason (couldn't resolve a school at all,
 * rather than "resolved it, then had no write grant"). */
async function resolveCurrentSchool(request: FastifyRequest, tenancy: TenancyContext): Promise<string | null> {
  const schoolIds = [...tenancy.schoolRoles.keys()];
  if (schoolIds.length === 1) return schoolIds[0];

  const headerValue = request.headers['x-school-id'];
  const requested = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (!requested) return null; // ambiguous or none — routes needing one will reject via requireCurrentSchool

  if (schoolIds.includes(requested)) return requested;

  const requestedAreaId = await getSchoolAreaId(requested);
  if (requestedAreaId && hasAreaReadAccess(tenancy, requestedAreaId)) return requested;

  throw new ApiError('PERM-002', 'X-School-Id does not match an active membership');
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
