import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateRefreshToken, hashRefreshToken, refreshTokenExpiryDate } from './refresh-token.ts';

test('two generated tokens are never equal (real entropy, not a stub)', () => {
  assert.notEqual(generateRefreshToken(), generateRefreshToken());
});

test('hashing is deterministic and never returns the raw token', () => {
  const raw = generateRefreshToken();
  const h1 = hashRefreshToken(raw);
  const h2 = hashRefreshToken(raw);
  assert.equal(h1, h2);
  assert.notEqual(h1, raw);
  assert.match(h1, /^[a-f0-9]{64}$/);
});

test('expiry is in the future', () => {
  assert.ok(refreshTokenExpiryDate() > new Date());
});
