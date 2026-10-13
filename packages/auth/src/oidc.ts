// Access tokens issued by Keycloak (ADR-0014): verified against the realm's JWKS,
// never against JWT_SECRET. Which verifier a token goes to is decided by its
// header `alg`: HS256 is the API's own token (jwt.ts), anything else must be an
// asymmetric Keycloak signature. A forged HS256 token claiming Keycloak's issuer
// therefore still meets JWT_SECRET, and an RS256 token never does.
//
// Imports use .ts (rewriteRelativeImportExtensions) so the source-run unit tests
// and the compiled package share one AccessToken*Error class.
//
// The SEIP account is the `seip_uid` claim — a user attribute only a realm admin
// can set (realm user profile: unmanagedAttributePolicy ADMIN_EDIT) — not `sub`,
// which is Keycloak's own id and changes if the user is re-created.
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, errors as joseErrors, type JWTVerifyGetKey } from 'jose';
import { AccessTokenExpiredError, AccessTokenInvalidError } from './jwt.ts';

/**
 * acr value → level of authentication. Mirrors the realm's `acr.loa.map`
 * (infra/keycloak/seip-realm.dev.json): password is 1, a second factor is 2.
 * An acr this table does not know counts as 0, so it never satisfies a step-up.
 */
export const ACR_LEVELS: Readonly<Record<string, number>> = { pwd: 1, mfa: 2 };

/** The level of the API's own HS256 tokens: password only. */
export const OWN_TOKEN_ACR = 1;

/**
 * How long a second factor counts (ADR-0014 step-up). Keycloak carries `acr`
 * unchanged through every refresh — measured: an offline (mobile) session that
 * did OTP once would otherwise hold acr 2 for 30 days, and a web session for its
 * 8 hours. Past this age, measured from the sign-in itself (`auth_time`, which a
 * refresh does not move), a level-2 sign-in counts as level 1 and the next
 * step-up operation asks for the OTP again.
 */
export const STEP_UP_MAX_AGE_S = 15 * 60;

/** The level an authentication still counts for at `nowMs`. */
export function effectiveAcr(level: number, authTimeS: number | null, nowMs = Date.now()): number {
  if (level < 2) return level;
  if (authTimeS === null || nowMs / 1000 - authTimeS > STEP_UP_MAX_AGE_S) return 1;
  return level;
}

export interface OidcClaims {
  /** UserAccount.id, from the `seip_uid` claim. */
  userId: string;
  /** Level of authentication (ACR_LEVELS), after effectiveAcr. */
  acr: number;
  /** Keycloak session id, for device-session revocation (P2). */
  sessionId: string | null;
}

export interface OidcVerifierOptions {
  issuer: string;
  audience: string;
  /** Injected in tests; defaults to the realm's remote JWKS. */
  jwks?: JWTVerifyGetKey;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True if the token is not one of ours (HS256), and so must go to the OIDC verifier. */
export function isExternalToken(token: string): boolean {
  try {
    return decodeProtectedHeader(token).alg !== 'HS256';
  } catch {
    return false; // not even a JWT header: let the own-token path reject it
  }
}

export function createOidcVerifier(opts: OidcVerifierOptions): (token: string) => Promise<OidcClaims> {
  const issuer = opts.issuer.replace(/\/+$/, '');
  const jwks = opts.jwks ?? createRemoteJWKSet(new URL(`${issuer}/protocol/openid-connect/certs`));
  return async (token) => {
    let payload;
    try {
      ({ payload } = await jwtVerify(token, jwks, {
        issuer,
        audience: opts.audience,
        algorithms: ['RS256', 'PS256', 'ES256'],
      }));
    } catch (e) {
      if (e instanceof joseErrors.JWTExpired) throw new AccessTokenExpiredError('access token expired');
      throw new AccessTokenInvalidError('access token invalid');
    }
    const userId = payload.seip_uid;
    // A Keycloak user not linked to a SEIP account is authenticated but is nobody here.
    if (typeof userId !== 'string' || !UUID.test(userId)) throw new AccessTokenInvalidError('token has no seip_uid');
    const level = typeof payload.acr === 'string' ? ACR_LEVELS[payload.acr] ?? 0 : 0;
    const authTime = typeof payload.auth_time === 'number' ? payload.auth_time : null;
    const acr = effectiveAcr(level, authTime);
    const sessionId = typeof payload.sid === 'string' ? payload.sid : null;
    return { userId, acr, sessionId };
  };
}
