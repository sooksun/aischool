import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateInviteToken,
  hashInviteToken,
  inviteTokenExpiryDate,
  isAcceptablePassword,
  MIN_PASSWORD_LENGTH,
  INVITE_TOKEN_TTL_SECONDS,
} from './invite-token.ts';
import { hashRefreshToken } from './refresh-token.ts';

test('two generated tokens are never equal (real entropy, not a stub)', () => {
  assert.notEqual(generateInviteToken(), generateInviteToken());
});

test('hashing is deterministic and never returns the raw token', () => {
  const raw = generateInviteToken();
  const h1 = hashInviteToken(raw);
  const h2 = hashInviteToken(raw);
  assert.equal(h1, h2);
  assert.notEqual(h1, raw);
  assert.match(h1, /^[a-f0-9]{64}$/);
});

test('the stored hash is what the unique column holds, so it must fit VARCHAR(191)', () => {
  // 20260719060000_invite_tokens declares invite_token_hash VARCHAR(191) UNIQUE.
  // sha256-hex is 64 chars; this fails loudly if the digest is ever widened.
  assert.equal(hashInviteToken(generateInviteToken()).length, 64);
});

test('expiry is in the future and matches the declared TTL', () => {
  const from = new Date('2026-07-19T00:00:00.000Z');
  const exp = inviteTokenExpiryDate(from);
  assert.ok(inviteTokenExpiryDate() > new Date());
  assert.equal(exp.getTime() - from.getTime(), INVITE_TOKEN_TTL_SECONDS * 1000);
});

test('a password at exactly the minimum is accepted; one character short is not', () => {
  assert.equal(MIN_PASSWORD_LENGTH, 12); // mirrored in openapi.yaml AcceptInviteRequest
  assert.ok(isAcceptablePassword('a'.repeat(MIN_PASSWORD_LENGTH)));
  assert.ok(!isAcceptablePassword('a'.repeat(MIN_PASSWORD_LENGTH - 1)));
});

test('invite and refresh tokens are separate namespaces despite identical construction', () => {
  // Both are sha256 of a 256-bit secret, so a raw token hashes to the same digest
  // under either helper. What keeps them from being interchangeable is that they
  // are stored in different columns and looked up by different queries — this
  // test records that the isolation is structural, not cryptographic, so nobody
  // later "simplifies" by sharing one column between them.
  const raw = generateInviteToken();
  assert.equal(hashInviteToken(raw), hashRefreshToken(raw));
});
