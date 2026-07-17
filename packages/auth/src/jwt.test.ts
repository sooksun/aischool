import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signAccessToken, verifyAccessToken, AccessTokenInvalidError, ACCESS_TOKEN_TTL_SECONDS } from './jwt.ts';

const SECRET = 'test-secret-do-not-use-in-prod';

test('signs and verifies a round-trip access token', async () => {
  const token = await signAccessToken('user-123', SECRET);
  const claims = await verifyAccessToken(token, SECRET);
  assert.equal(claims.sub, 'user-123');
});

test('rejects a token signed with a different secret', async () => {
  const token = await signAccessToken('user-123', SECRET);
  await assert.rejects(() => verifyAccessToken(token, 'wrong-secret'), AccessTokenInvalidError);
});

test('TTL is well under the SEC-AUTH-2 60-minute ceiling', () => {
  assert.ok(ACCESS_TOKEN_TTL_SECONDS <= 3600);
});
