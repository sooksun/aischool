// Web sign-in through Keycloak behind the BFF (CCR-018, ADR-0014 §4):
// webLogin → Keycloak → webCallback → session cookie; webLogout ends it.
// Session checks on every other request live in plugins/auth.ts.
import { createHash, randomBytes } from 'node:crypto';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  createWebSession, getUserById, getWebSessionByTokenHash, revokeWebSession, writeAuditEvent,
} from '@seip/database';
import { ApiError } from '@seip/backend-shared';
import type { Env } from '../env.js';
import type { Keycloak } from '../lib/keycloak.js';
import {
  CSRF_COOKIE, KC_CHECK_EVERY_MS, OIDC_COOKIE, OIDC_COOKIE_MAX_AGE, SESSION_COOKIE, clearCookie, equalSecrets, openRefreshToken,
  parseCookies, randomToken, readOidcState, safeReturnTo, sealRefreshToken, setCookie, sha256, signOidcState,
} from '../lib/web-session.js';
import { WEB_SESSION_MAX_MS } from '@seip/database';

export const webAuthRoutes: FastifyPluginAsync<{ env: Env; keycloak: Keycloak | null }> = async (app, { env, keycloak }) => {
  const web = keycloak?.web ?? null;
  const fail = (reply: FastifyReply) => reply
    .header('set-cookie', clearCookie(OIDC_COOKIE))
    .redirect('/login?error=sso', 302);

  app.get('/auth/web/login', { config: { operationId: 'webLogin' } }, async (request, reply) => {
    if (!web) throw new ApiError('SYS-003', 'Web sign-in is not configured on this deployment');
    const q = z.object({ return_to: z.string().optional(), acr: z.enum(['pwd', 'mfa']).default('pwd') }).parse(request.query);
    const state = randomToken();
    const nonce = randomToken();
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const cookie = signOidcState(env.JWT_SECRET, { state, nonce, verifier, returnTo: safeReturnTo(q.return_to), acr: q.acr });
    return reply
      .header('set-cookie', setCookie(OIDC_COOKIE, cookie, { maxAge: OIDC_COOKIE_MAX_AGE, httpOnly: true, sameSite: 'Lax' }))
      .redirect(web.authorizeUrl({ state, nonce, challenge, acr: q.acr }), 302);
  });

  app.get('/auth/web/callback', { config: { operationId: 'webCallback' } }, async (request, reply) => {
    if (!web || !keycloak) return fail(reply);
    const q = request.query as Record<string, string | undefined>;
    const cookies = parseCookies(request.headers.cookie);
    const saved = readOidcState(env.JWT_SECRET, cookies[OIDC_COOKIE]);
    if (!saved || !q.state || !equalSecrets(q.state, saved.state) || q.error || !q.code) return fail(reply);

    let userId: string;
    let acr: number;
    let sessionId: string | null;
    let refreshToken: string;
    try {
      const tokens = await web.exchangeCode(q.code, saved.verifier);
      if (!tokens.idToken || !(await web.verifyIdToken(tokens.idToken, saved.nonce))) return fail(reply);
      ({ userId, acr, sessionId } = await keycloak.verifyAccessToken(tokens.accessToken));
      refreshToken = tokens.refreshToken;
    } catch (e) {
      request.log.warn({ err: e }, 'web sign-in: code exchange or token check failed');
      return fail(reply);
    }
    const user = await getUserById(userId);
    if (!user || user.status !== 'active') return fail(reply);

    // A new sign-in (including a step-up) replaces whatever session this browser
    // had: the session's acr is exactly what this sign-in proved, never upgraded.
    const previous = cookies[SESSION_COOKIE];
    if (previous) {
      const old = await getWebSessionByTokenHash(sha256(previous));
      if (old) await revokeWebSession(old.id);
    }
    const token = randomToken();
    const csrf = randomToken();
    const session = await createWebSession({
      userId, tokenHash: sha256(token), csrfHash: sha256(csrf), acr, kcSessionId: sessionId,
      kcRefreshToken: sealRefreshToken(env.JWT_SECRET, refreshToken),
      kcCheckDueAt: new Date(Date.now() + KC_CHECK_EVERY_MS),
    });
    await writeAuditEvent({
      schoolId: null, actorUserId: userId, action: 'signed_in', entityType: 'WebSession', entityId: session.id,
      after: session, requestId: request.id,
    });
    const maxAge = Math.floor(WEB_SESSION_MAX_MS / 1000);
    return reply
      .header('set-cookie', [
        clearCookie(OIDC_COOKIE),
        setCookie(SESSION_COOKIE, token, { maxAge, httpOnly: true, sameSite: 'Lax' }),
        setCookie(CSRF_COOKIE, csrf, { maxAge, httpOnly: false, sameSite: 'Strict' }),
      ])
      .redirect(saved.returnTo, 302);
  });

  app.post('/auth/web/logout', { config: { operationId: 'webLogout' } }, async (request, reply) => {
    const cookies = parseCookies(request.headers.cookie);
    const token = cookies[SESSION_COOKIE];
    const session = token ? await getWebSessionByTokenHash(sha256(token)) : null;
    if (session && !session.revokedAt) {
      // A third-party page must not be able to sign the user out.
      const header = request.headers['x-csrf-token'];
      if (typeof header !== 'string' || !equalSecrets(sha256(header), session.csrfHash)) {
        throw new ApiError('AUTH-007', 'X-CSRF-Token missing or does not match the session');
      }
      await revokeWebSession(session.id);
      await writeAuditEvent({
        schoolId: null, actorUserId: session.userId, action: 'signed_out', entityType: 'WebSession', entityId: session.id,
        before: session, requestId: request.id,
      });
      if (web) await web.logout(openRefreshToken(env.JWT_SECRET, session.kcRefreshToken));
    }
    return reply.header('set-cookie', [clearCookie(SESSION_COOKIE), clearCookie(CSRF_COOKIE)]).code(204).send();
  });
};
