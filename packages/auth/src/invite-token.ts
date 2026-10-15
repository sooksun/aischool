// Invite tokens (CCR-014): the single-use secret that lets an `invited` account
// set its first password. Same shape as refresh tokens — opaque, 256-bit, only
// the sha256 is ever stored — and for the same reason: a DB read (backup leak,
// insider, SQL injection) must never yield something replayable.
//
// Pure module, no datasource: persistence lives in packages/database's identity
// repository and apps/api wires the two together (module-boundaries.md).
import { randomBytes, createHash } from 'node:crypto';

// 14 days. Long enough that a teacher who is away for a week can still accept,
// short enough that a slip of paper found next term is worthless.
export const INVITE_TOKEN_TTL_SECONDS = 14 * 24 * 60 * 60;

/** SEC-AUTH-1 fixes how passwords are stored (argon2id) but sets no length
 * floor. CCR-014 sets one, so the first password policy in this system is
 * written down rather than implied. Mirrored by
 * `AcceptInviteRequest.password.minLength` in openapi.yaml — change both. */
export const MIN_PASSWORD_LENGTH = 12;

/** 256 bits of entropy, base64url — the bearer secret. Never store this raw. */
export function generateInviteToken(): string {
  return randomBytes(32).toString('base64url');
}

/** sha256 of the raw token; this is what the `invite_token_hash` column holds. */
export function hashInviteToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function inviteTokenExpiryDate(from: Date = new Date()): Date {
  return new Date(from.getTime() + INVITE_TOKEN_TTL_SECONDS * 1000);
}

/** Shape-only check. Deliberately not a complexity rule: length is the property
 * that actually resists guessing, and composition rules push people toward
 * `Passw0rd!` — NIST 800-63B stopped recommending them for that reason. */
export function isAcceptablePassword(plain: string): boolean {
  return plain.length >= MIN_PASSWORD_LENGTH;
}
