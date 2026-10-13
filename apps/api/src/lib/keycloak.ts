// The Keycloak realm as the API sees it (ADR-0014): the access-token verifier the
// auth plugin uses, and — when the web BFF is configured — the confidential
// client calls behind /auth/web/* (CCR-018). One JWKS cache for both.
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { createOidcVerifier, type OidcClaims } from '@seip/auth';
import type { Env } from '../env.js';

export interface KeycloakTokens {
  accessToken: string;
  refreshToken: string;
  idToken: string | null;
}

export interface WebClient {
  clientId: string;
  /** `${WEB_PUBLIC_ORIGIN}/api/v1/auth/web/callback` — never derived from Host. */
  redirectUri: string;
  /** Where the browser lands when it has nowhere better to go. */
  publicOrigin: string;
  authorizeUrl(params: { state: string; nonce: string; challenge: string; acr: 'pwd' | 'mfa' }): string;
  exchangeCode(code: string, verifier: string): Promise<KeycloakTokens>;
  /** Refresh grant. Null when Keycloak says the session is gone. */
  refresh(refreshToken: string): Promise<KeycloakTokens | null>;
  /** Ends the Keycloak session behind a refresh token. Best effort. */
  logout(refreshToken: string): Promise<void>;
  /** The ID token's signature, issuer, audience and nonce. */
  verifyIdToken(idToken: string, nonce: string): Promise<boolean>;
}

export interface ProvisionInput {
  userId: string;
  email: string;
  displayName: string;
  /** The password the person just proved or chose — the only time the API has it. */
  password: string;
  /** Holds a role ADR-0014 §6 puts behind a second factor: enrol TOTP at first sign-in. */
  needsSecondFactor: boolean;
}

/** created / exists → the account is linked; conflict → a Keycloak user with
 * that email belongs to another seip_uid (left alone, for an admin to resolve). */
export type ProvisionResult = 'created' | 'exists' | 'conflict';

export interface Provisioner {
  ensureAccount(input: ProvisionInput): Promise<ProvisionResult>;
  /** Deletes a user session — offline (an app's) or online. Gone already is fine. */
  endSession(kcSessionId: string, offline: boolean): Promise<void>;
}

export interface Keycloak {
  verifyAccessToken(token: string): Promise<OidcClaims>;
  /** Null unless KEYCLOAK_WEB_CLIENT_SECRET and WEB_PUBLIC_ORIGIN are set. */
  web: WebClient | null;
  /** Null unless KEYCLOAK_ADMIN_CLIENT_SECRET is set. */
  provisioner: Provisioner | null;
}

/**
 * Creates the realm user for a SEIP account through the seip-provisioner
 * service account (client credentials, manage-users in this realm only).
 * Idempotent: an existing user with this seip_uid is left exactly as it is —
 * a password or second factor changed in Keycloak is never overwritten.
 */
function createProvisioner(issuer: string, clientId: string, secret: string): Provisioner {
  const admin = issuer.replace('/realms/', '/admin/realms/');
  let cached: { token: string; until: number } | null = null;
  const token = async () => {
    if (cached && cached.until > Date.now()) return cached.token;
    const res = await fetch(`${issuer}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: secret }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`keycloak provisioner token ${res.status}`);
    const j = (await res.json()) as { access_token: string; expires_in: number };
    cached = { token: j.access_token, until: Date.now() + (j.expires_in - 15) * 1000 };
    return j.access_token;
  };
  const call = async (path: string, init: RequestInit = {}) => fetch(`${admin}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${await token()}`, 'content-type': 'application/json', ...init.headers },
    signal: AbortSignal.timeout(5000),
  });

  return {
    async ensureAccount(input) {
      const found = await call(`/users?${new URLSearchParams({ q: `seip_uid:${input.userId}`, exact: 'true', max: '2' })}`);
      if (!found.ok) throw new Error(`keycloak user search ${found.status}`);
      if (((await found.json()) as unknown[]).length > 0) return 'exists';

      const created = await call('/users', {
        method: 'POST',
        body: JSON.stringify({
          username: input.email, email: input.email,
          // SEIP proved the address: the invite token was delivered to it.
          emailVerified: true, enabled: true,
          firstName: input.displayName,
          attributes: { seip_uid: [input.userId] },
          credentials: [{ type: 'password', value: input.password, temporary: false }],
          requiredActions: input.needsSecondFactor ? ['CONFIGURE_TOTP'] : [],
        }),
      });
      if (created.status === 201) return 'created';
      if (created.status === 409) return 'conflict';
      throw new Error(`keycloak create user ${created.status}`);
    },
    async endSession(kcSessionId, offline) {
      // The admin "sign out" of a user does not reliably end offline sessions;
      // deleting the session itself does (tests/helpers/keycloak.mjs).
      const res = await call(`/sessions/${encodeURIComponent(kcSessionId)}?isOffline=${offline}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) throw new Error(`keycloak delete session ${res.status}`);
    },
  };
}

export function createKeycloak(env: Env): Keycloak | null {
  if (!env.KEYCLOAK_ISSUER) return null;
  const issuer = env.KEYCLOAK_ISSUER.replace(/\/+$/, '');
  const oidc = `${issuer}/protocol/openid-connect`;
  const jwks = createRemoteJWKSet(new URL(`${oidc}/certs`));
  const verifyAccessToken = createOidcVerifier({ issuer, audience: env.KEYCLOAK_AUDIENCE, jwks });

  let web: WebClient | null = null;
  if (env.KEYCLOAK_WEB_CLIENT_SECRET && env.WEB_PUBLIC_ORIGIN) {
    const clientId = env.KEYCLOAK_WEB_CLIENT_ID;
    const secret = env.KEYCLOAK_WEB_CLIENT_SECRET;
    const publicOrigin = env.WEB_PUBLIC_ORIGIN.replace(/\/+$/, '');
    const redirectUri = `${publicOrigin}/api/v1/auth/web/callback`;
    const tokenCall = async (body: Record<string, string>) => fetch(`${oidc}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: secret, ...body }),
    });
    const tokensOf = async (res: Response): Promise<KeycloakTokens> => {
      const j = (await res.json()) as { access_token: string; refresh_token: string; id_token?: string };
      return { accessToken: j.access_token, refreshToken: j.refresh_token, idToken: j.id_token ?? null };
    };

    web = {
      clientId, redirectUri, publicOrigin,
      authorizeUrl: ({ state, nonce, challenge, acr }) => `${oidc}/auth?${new URLSearchParams({
        client_id: clientId, response_type: 'code', scope: 'openid', redirect_uri: redirectUri,
        state, nonce, code_challenge: challenge, code_challenge_method: 'S256', acr_values: acr,
      })}`,
      async exchangeCode(code, verifier) {
        const res = await tokenCall({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier });
        if (!res.ok) throw new Error(`keycloak code exchange ${res.status}`);
        return tokensOf(res);
      },
      async refresh(refreshToken) {
        const res = await tokenCall({ grant_type: 'refresh_token', refresh_token: refreshToken });
        if (res.status === 400 || res.status === 401) return null; // invalid_grant: session ended
        if (!res.ok) throw new Error(`keycloak refresh ${res.status}`);
        return tokensOf(res);
      },
      async logout(refreshToken) {
        await fetch(`${oidc}/logout`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ client_id: clientId, client_secret: secret, refresh_token: refreshToken }),
        }).catch(() => undefined);
      },
      async verifyIdToken(idToken, nonce) {
        try {
          const { payload } = await jwtVerify(idToken, jwks, { issuer, audience: clientId, algorithms: ['RS256', 'PS256', 'ES256'] });
          return payload.nonce === nonce;
        } catch {
          return false;
        }
      },
    };
  }
  const provisioner = env.KEYCLOAK_ADMIN_CLIENT_SECRET
    ? createProvisioner(issuer, env.KEYCLOAK_ADMIN_CLIENT_ID, env.KEYCLOAK_ADMIN_CLIENT_SECRET)
    : null;
  return { verifyAccessToken, web, provisioner };
}
