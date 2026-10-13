// POST /auth/login, POST /auth/refresh, POST /auth/logout, GET /auth/me — the
// operations in permissions.yaml's unauthenticated/any_authenticated exemptions
// (CCR-002 §GAP-1 for /me's `personnel` shape; CCR-008 for the session lifecycle).
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  verifyPassword, signAccessToken, ACCESS_TOKEN_TTL_SECONDS, generateRefreshToken, hashRefreshToken,
  refreshTokenExpiryDate, hashPassword, hashInviteToken, isAcceptablePassword, MIN_PASSWORD_LENGTH, isActiveNow,
} from '@seip/auth';
import {
  findUserByEmailForLogin, getUserById, getMembershipsForUser, createRefreshToken,
  findActiveRefreshToken, rotateRefreshToken, revokeRefreshToken, revokeAllRefreshTokensForUser,
  acceptInvite, markKeycloakLinked, redeemPasswordReset,
} from '@seip/database';
import { ApiError, type Role } from '@seip/backend-shared';
import type { FastifyBaseLogger } from 'fastify';
import type { Env } from '../env.js';
import type { Keycloak } from '../lib/keycloak.js';
import { getLoginRateLimiter, getInviteRateLimiter } from '../lib/login-rate-limit.js';

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const RefreshBody = z.object({
  refresh_token: z.string().min(1),
});

const LogoutBody = z.object({
  refresh_token: z.string().min(1).optional(),
});

const PasswordResetBody = z.object({
  reset_token: z.string().min(1),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(256),
});

const AcceptInviteBody = z.object({
  invite_token: z.string().min(1),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(256),
});

/** ADR-0014 §6: roles whose sign-in needs a second factor — enrolled at first SEIP ID sign-in. */
const SECOND_FACTOR_ROLES: ReadonlySet<Role> = new Set<Role>(['director', 'school_admin', 'evaluator', 'area_admin']);

export const authRoutes: FastifyPluginAsync<{ env: Env; keycloak?: Keycloak | null }> = async (app, { env, keycloak = null }) => {
  /**
   * ADR-0014: make sure this account has its Keycloak user, so it can sign in
   * with SEIP ID. Runs only at accept-invite and password login — the two moments
   * the API holds the password, which therefore never has to be stored. Best
   * effort: Keycloak being down must not stop a sign-in; the next password login
   * tries again (kc_linked_at stays null until it works).
   */
  async function linkKeycloak(
    user: { id: string; email: string; displayName: string; kcLinkedAt: Date | null },
    password: string,
    log: FastifyBaseLogger,
  ): Promise<void> {
    const provisioner = keycloak?.provisioner;
    if (!provisioner || user.kcLinkedAt) return;
    try {
      const memberships = await getMembershipsForUser(user.id);
      const needsSecondFactor = memberships.some((m) => m.status === 'active' && SECOND_FACTOR_ROLES.has(m.role));
      const result = await provisioner.ensureAccount({
        userId: user.id, email: user.email, displayName: user.displayName, password, needsSecondFactor,
      });
      if (result === 'conflict') {
        log.warn({ userId: user.id }, 'keycloak: a user with this email is linked to another account; not provisioned');
        return;
      }
      await markKeycloakLinked(user.id);
    } catch (e) {
      log.warn({ err: e, userId: user.id }, 'keycloak provisioning failed; retried at the next password login');
    }
  }

  app.post('/auth/login', { config: { operationId: 'login' } }, async (request, reply) => {
    const body = LoginBody.parse(request.body);

    // SEC-AUTH-5 / OPS-004: throttle before password work (still constant AUTH-001 shape on fail).
    const ip = request.ip || 'unknown';
    const limited = getLoginRateLimiter().check(ip, body.email);
    if (!limited.ok) {
      if (limited.retryAfterSec) {
        reply.header('retry-after', String(limited.retryAfterSec));
      }
      throw new ApiError('AUTH-004', 'Too many login attempts — try again later');
    }

    const user = await findUserByEmailForLogin(body.email);
    // Constant-shape response whether the email exists or not (SEC-AUTH-5: never
    // reveal account existence). A dummy verify still runs so the response timing
    // for "unknown email" isn't measurably faster than "wrong password".
    const hash = user?.passwordHash ?? '$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const ok = await verifyPassword(body.password, hash);
    if (!user || !ok || user.status !== 'active') {
      throw new ApiError('AUTH-001', 'Invalid email or password');
    }
    await linkKeycloak(user, body.password, request.log);

    const accessToken = await signAccessToken(user.id, env.JWT_SECRET);
    const rawRefresh = generateRefreshToken();
    await createRefreshToken(user.id, hashRefreshToken(rawRefresh), refreshTokenExpiryDate());

    reply.status(200).send({
      access_token: accessToken,
      refresh_token: rawRefresh,
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
    });
  });

  app.post('/auth/refresh', { config: { operationId: 'refreshToken' } }, async (request, reply) => {
    const body = RefreshBody.parse(request.body);
    const row = await findActiveRefreshToken(hashRefreshToken(body.refresh_token));

    // One AUTH-001 shape for unknown/replayed tokens — never an oracle for
    // "this was once valid" (CCR-008). A replayed (already-rotated) token is
    // the SEC-AUTH-2 theft signal: kill the whole family before failing.
    if (!row) throw new ApiError('AUTH-001', 'Invalid refresh token');
    if (row.revokedAt) {
      await revokeAllRefreshTokensForUser(row.userId);
      throw new ApiError('AUTH-001', 'Invalid refresh token');
    }
    if (row.expiresAt < new Date()) throw new ApiError('AUTH-002', 'Refresh token expired');

    const user = await getUserById(row.userId);
    if (!user || user.status !== 'active') throw new ApiError('AUTH-003', 'Account disabled or not found');

    const rawRefresh = generateRefreshToken();
    const newRow = await createRefreshToken(user.id, hashRefreshToken(rawRefresh), refreshTokenExpiryDate());
    await rotateRefreshToken(row.id, newRow.id);
    const accessToken = await signAccessToken(user.id, env.JWT_SECRET);

    reply.status(200).send({
      access_token: accessToken,
      refresh_token: rawRefresh,
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
    });
  });

  // CCR-014. Unauthenticated by contract (permissions.yaml `unauthenticated:`):
  // an `invited` account has no password, so it cannot hold a bearer token, and
  // SEC-AUTH-3 would reject it at login anyway. The invite token IS the credential.
  app.post('/auth/accept-invite', { config: { operationId: 'acceptInvite' } }, async (request, reply) => {
    const body = AcceptInviteBody.parse(request.body);
    const tokenHash = hashInviteToken(body.invite_token);

    // Throttle before argon2 work (SEC-AUTH-5), same as login. The second bucket
    // is keyed on the token HASH, not a constant: a constant would be one global
    // bucket that any attacker could exhaust to block every real invite in the
    // school — a self-inflicted DoS. Per-IP is the bucket that actually resists
    // guessing; per-token just caps hammering one known token.
    const ip = request.ip || 'unknown';
    const limited = getInviteRateLimiter().check(ip, tokenHash);
    if (!limited.ok) {
      if (limited.retryAfterSec) reply.header('retry-after', String(limited.retryAfterSec));
      throw new ApiError('AUTH-004', 'Too many attempts — try again later');
    }

    // Length is re-checked here as well as in zod because MIN_PASSWORD_LENGTH is
    // the contract's number (openapi AcceptInviteRequest.minLength) and this is
    // the last point before it is hashed and becomes unrecoverable.
    if (!isAcceptablePassword(body.password)) {
      throw new ApiError('VAL-001', `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }

    const result = await acceptInvite(tokenHash, await hashPassword(body.password), request.id);
    // One code for unknown / expired / already-accepted. Distinguishing them
    // would tell an attacker which invite tokens once existed (AUTH-005).
    if (!result.ok) throw new ApiError('AUTH-005', 'Invite token is not usable');
    const accepted = await getUserById(result.userId);
    if (accepted) await linkKeycloak(accepted, body.password, request.log);

    // Deliberately no token pair: the caller logs in normally, so the
    // invited -> active gate stays enforced in exactly one place (login).
    reply.status(204).send();
  });

  // CCR-022 / FR-099: a one-time reset from the school admin. Same throttle and
  // single-answer shape as accept-invite. Ends every session, here and in SEIP ID.
  app.post('/auth/password-reset', { config: { operationId: 'completePasswordReset' } }, async (request, reply) => {
    const body = PasswordResetBody.parse(request.body);
    const tokenHash = hashInviteToken(body.reset_token);
    const limited = getInviteRateLimiter().check(request.ip || 'unknown', tokenHash);
    if (!limited.ok) {
      if (limited.retryAfterSec) reply.header('retry-after', String(limited.retryAfterSec));
      throw new ApiError('AUTH-004', 'Too many attempts — try again later');
    }
    if (!isAcceptablePassword(body.password)) {
      throw new ApiError('VAL-001', `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    const done = await redeemPasswordReset(tokenHash, await hashPassword(body.password), request.id);
    if (!done) throw new ApiError('AUTH-008', 'Password reset token is not usable');

    // Best effort, like provisioning: the sessions here are already ended, and
    // a SEIP ID account that is not reset now keeps its old password until the
    // next attempt — never a reason to fail what the person just did.
    const provisioner = keycloak?.provisioner;
    if (provisioner) {
      await provisioner.resetPassword(done.userId, body.password, done.kcSessionIds).catch((err) => {
        request.log.warn({ err, userId: done.userId }, 'password reset: SEIP ID not updated');
      });
    }
    reply.status(204).send();
  });

  app.post('/auth/logout', { config: { operationId: 'logout' } }, async (request, reply) => {
    const auth = request.auth!; // any_authenticated — preHandler populated this
    const body = LogoutBody.parse(request.body ?? {});

    if (body.refresh_token) {
      const row = await findActiveRefreshToken(hashRefreshToken(body.refresh_token));
      // Only the caller's own token; someone else's (or a bogus one) is ignored —
      // idempotent 204 either way, never an existence oracle (CCR-008).
      if (row && row.userId === auth.userId && !row.revokedAt) {
        await revokeRefreshToken(row.id);
      }
    } else {
      await revokeAllRefreshTokensForUser(auth.userId);
    }
    reply.status(204).send();
  });

  app.get('/auth/me', { config: { operationId: 'getCurrentUser' } }, async (request) => {
    const auth = request.auth!; // any_authenticated — the preHandler already populated this
    const user = await getUserById(auth.userId);
    if (!user) throw new ApiError('AUTH-001', 'Account no longer exists');
    const memberships = await getMembershipsForUser(auth.userId);

    return {
      id: user.id,
      email: user.email,
      display_name: user.displayName,
      personnel: auth.personnel
        ? {
          id: auth.personnel.id, position_role: auth.personnel.positionRole, rank_level_code: auth.personnel.rankLevelCode,
          full_name: auth.personnel.fullName,
          rank_since: auth.personnel.rankSince ? auth.personnel.rankSince.toISOString().slice(0, 10) : null,
          confirmed_at: auth.personnel.confirmedAt ? auth.personnel.confirmedAt.toISOString() : null,
          correction_note: auth.personnel.correctionNote,
        }
        : null,
      // Only what is in effect now (CCR-020): an ended membership grants nothing
      // in the API, so the client must not offer its screens either.
      memberships: memberships.filter((m) => isActiveNow(m, new Date())).map((m) => ({
        role: m.role,
        membership_scope: m.membershipScope,
        school_id: m.schoolId,
        school_name: m.schoolName,
        area_id: m.areaId,
      })),
    };
  });
};
