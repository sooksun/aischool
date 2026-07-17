// SEC-AUTH-2: access token TTL <= 60 min. Payload carries only `sub` (user id) —
// NOT memberships/roles. Roles are re-derived from SchoolMembership on every
// request (packages/database), so a revoked or changed membership takes effect
// immediately instead of waiting for token expiry. This trades a DB read per
// request for correctness; at SEIP's scale that trade is free.
import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // well under the 60-min ceiling

export interface AccessTokenClaims {
  sub: string; // UserAccount.id
}

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signAccessToken(userId: string, secret: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(secretKey(secret));
}

export class AccessTokenExpiredError extends Error {}
export class AccessTokenInvalidError extends Error {}

export async function verifyAccessToken(token: string, secret: string): Promise<AccessTokenClaims> {
  try {
    const { payload } = await jwtVerify(token, secretKey(secret));
    if (!payload.sub) throw new AccessTokenInvalidError('token has no subject');
    return { sub: payload.sub };
  } catch (e) {
    if (e instanceof joseErrors.JWTExpired) throw new AccessTokenExpiredError('access token expired');
    throw new AccessTokenInvalidError('access token invalid');
  }
}
