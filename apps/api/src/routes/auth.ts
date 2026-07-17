// POST /auth/login, GET /auth/me — the two operations in permissions.yaml's
// unauthenticated/any_authenticated exemptions (CCR-002 §GAP-1 for /me's
// `personnel` shape).
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { verifyPassword, signAccessToken, ACCESS_TOKEN_TTL_SECONDS, generateRefreshToken, hashRefreshToken, refreshTokenExpiryDate } from '@seip/auth';
import { findUserByEmailForLogin, getUserById, getMembershipsForUser, createRefreshToken } from '@seip/database';
import { ApiError } from '@seip/backend-shared';
import type { Env } from '../env.js';

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const authRoutes: FastifyPluginAsync<{ env: Env }> = async (app, { env }) => {
  app.post('/auth/login', { config: { operationId: 'login' } }, async (request, reply) => {
    const body = LoginBody.parse(request.body);

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
