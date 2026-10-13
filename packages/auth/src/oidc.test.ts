import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { createOidcVerifier, effectiveAcr, isExternalToken, STEP_UP_MAX_AGE_S } from './oidc.ts';
import { signAccessToken, AccessTokenExpiredError, AccessTokenInvalidError } from './jwt.ts';

const ISSUER = 'http://kc.test/realms/seip';
const UID = '11111111-1111-4111-8111-111111111111';

const { publicKey, privateKey } = await generateKeyPair('RS256');
const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
const verify = createOidcVerifier({ issuer: ISSUER, audience: 'seip-api', jwks: createLocalJWKSet({ keys: [jwk] }) });

function kcToken(claims: Record<string, unknown>, { exp = '60s', iss = ISSUER, aud = 'seip-api', key = privateKey } = {}) {
  return new SignJWT({ seip_uid: UID, acr: 'pwd', sid: 's1', auth_time: Math.floor(Date.now() / 1000), ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(iss).setAudience(aud).setSubject('kc-sub').setIssuedAt().setExpirationTime(exp)
    .sign(key);
}

test('maps seip_uid to the account and acr to its level', async () => {
  assert.deepEqual(await verify(await kcToken({})), { userId: UID, acr: 1, sessionId: 's1' });
  assert.equal((await verify(await kcToken({ acr: 'mfa' }))).acr, 2);
});

test('an acr the map does not know is level 0, never a step-up', async () => {
  assert.equal((await verify(await kcToken({ acr: '0' }))).acr, 0);
  assert.equal((await verify(await kcToken({ acr: undefined }))).acr, 0);
});

test('wrong issuer, wrong audience, foreign key or missing seip_uid are invalid', async () => {
  const other = (await generateKeyPair('RS256')).privateKey;
  for (const token of [
    await kcToken({}, { iss: 'http://evil/realms/seip' }),
    await kcToken({}, { aud: 'account' }),
    await kcToken({}, { key: other }),
    await kcToken({ seip_uid: undefined }),
    await kcToken({ seip_uid: 'not-a-uuid' }),
  ]) {
    await assert.rejects(() => verify(token), AccessTokenInvalidError);
  }
});

test('an expired token is reported as expired (AUTH-002), not invalid', async () => {
  const expired = await kcToken({}, { exp: '-10s' });
  await assert.rejects(() => verify(expired), AccessTokenExpiredError);
});

test('routing: HS256 is ours; an HS256 token never reaches the OIDC verifier', async () => {
  const own = await signAccessToken(UID, 'x'.repeat(32));
  assert.equal(isExternalToken(own), false);
  assert.equal(isExternalToken(await kcToken({})), true);
  assert.equal(isExternalToken('garbage'), false);
  // Even if it were handed over, the verifier only accepts asymmetric algorithms.
  await assert.rejects(() => verify(own), AccessTokenInvalidError);
});

test('a second factor counts for STEP_UP_MAX_AGE_S after the sign-in, then as a password', async () => {
  const now = Math.floor(Date.now() / 1000);
  assert.equal((await verify(await kcToken({ acr: 'mfa', auth_time: now - 60 }))).acr, 2);
  assert.equal((await verify(await kcToken({ acr: 'mfa', auth_time: now - STEP_UP_MAX_AGE_S - 5 }))).acr, 1,
    'a refreshed token keeps acr mfa and the old auth_time — it must not keep the step-up');
  assert.equal((await verify(await kcToken({ acr: 'mfa', auth_time: undefined }))).acr, 1, 'no auth_time, no step-up');
  assert.equal(effectiveAcr(1, null), 1);
  assert.equal(effectiveAcr(0, null), 0);
});
