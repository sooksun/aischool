// POST /auth/login, POST /auth/refresh, POST /auth/logout, GET /auth/me — the
// operations in permissions.yaml's unauthenticated/any_authenticated exemptions
// (CCR-002 §GAP-1 for /me's `personnel` shape; CCR-008 for the session lifecycle).
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { verifyPassword, signAccessToken, ACCESS_TOKEN_TTL_SECONDS, generateRefreshToken, hashRefreshToken, refreshTokenExpiryDate } from '@seip/auth';
import {
  findUserByEmailForLogin, getUserById, getMembershipsForUser, createRefreshToken,
  findActiveRefreshToken, rotateRefreshToken, revokeRefreshToken, revokeAllRefreshTokensForUser,
} from '@seip/database';
import { ApiError } from '@seip/backend-shared';
import type { Env } from '../env.js';
import { getLoginRateLimiter } from '../lib/login-rate-limit.js';

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

export const authRoutes: FastifyPluginAsync<{ env: Env }> = async (app, { env }) => {
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
        ? { id: auth.personnel.id, position_role: auth.personnel.positionRole, rank_level_code: auth.personnel.rankLevelCode }
        : null,
      memberships: memberships.map((m) => ({
        role: m.role,
        membership_scope: m.membershipScope,
        school_id: m.schoolId,
        area_id: m.areaId,
      })),
    };
  });
};
