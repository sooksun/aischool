import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, shouldRehash } from './password.ts';

test('hashPassword produces a verifiable argon2id hash, never the plaintext', async () => {
  const hash = await hashPassword('correct horse battery staple');
  assert.ok(hash.startsWith('$argon2id$'));
  assert.notEqual(hash, 'correct horse battery staple');
  assert.ok(await verifyPassword('correct horse battery staple', hash));
  assert.equal(await verifyPassword('wrong password', hash), false);
});

test('shouldRehash is false for a hash made with current params', async () => {
  const hash = await hashPassword('x');
  assert.equal(shouldRehash(hash), false);
});
