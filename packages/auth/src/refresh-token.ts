// Opaque refresh tokens (not JWTs): the server is the only party that can look one
// up, which is what makes revocation-on-logout and reuse detection possible
// (SEC-AUTH-2). This module is pure — generation and hashing only. Persistence
// (create/find/revoke rows) lives in packages/database's refreshToken repository;
// apps/api wires the two together. Keeping DB access out of this package matches
// module-boundaries.md (packages/auth has no datasource of its own).
import { randomBytes, createHash } from 'node:crypto';

export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

/** 256 bits of entropy, base64url — the bearer secret. Never store this raw. */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

/** sha256 of the raw token — this is what gets stored, so a DB read (backup leak,
 * SQL injection, insider) can never itself be replayed as a valid session. */
export function hashRefreshToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function refreshTokenExpiryDate(from: Date = new Date()): Date {
  return new Date(from.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000);
}
