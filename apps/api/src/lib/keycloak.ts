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

export interface Keycloak {
  verifyAccessToken(token: string): Promise<OidcClaims>;
  /** Null unless KEYCLOAK_WEB_CLIENT_SECRET and WEB_PUBLIC_ORIGIN are set. */
  web: WebClient | null;
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
  return { verifyAccessToken, web };
}
