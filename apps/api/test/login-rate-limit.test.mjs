// SEIP-OPS-004 / SEC-AUTH-5 — login throttle per IP + per email.
// Cleanup M4: tests intentionally mutate the process-global singleton
// (installLoginRateLimiterForTests) and restore it so other files in the same
// node process are not left throttled.
process.env.NODE_ENV = 'test';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { hash as argonHash } from '@node-rs/argon2';
import { buildServer } from '../dist/server.js';
import {
  LoginRateLimiter,
  getLoginRateLimiter,
  installLoginRateLimiterForTests,
  resetLoginRateLimiterState,
  setLoginRateLimiter,
} from '../dist/lib/login-rate-limit.js';

const prisma = new PrismaClient();
let app;
let email;
const password = 'rate-limit-test-password-99';
/** Restores generous post-suite limits (process-global). */
let restoreAfterSuite;

before(async () => {
  ({ app } = await buildServer());
  await app.ready();
  // Override after buildServer (which installs env defaults) — tight limits for inject tests.
  restoreAfterSuite = installLoginRateLimiterForTests(new LoginRateLimiter({
    windowMs: 60_000,
    maxPerIp: 100,
    maxPerEmail: 3,
  }));

  email = `rate-${randomUUID()}@x.io`;
  const user = await prisma.userAccount.create({
    data: {
      email,
      displayName: 'Rate',
      status: 'active',
      passwordHash: await argonHash(password),
    },
  });
  const school = await prisma.school.create({
    data: { code: `rate-${randomUUID()}`, name: 'Rate School' },
  });
  await prisma.schoolMembership.create({
    data: {
      userId: user.id,
      schoolId: school.id,
      role: 'teacher',
      membershipScope: 'school',
      effectiveFrom: new Date('2020-01-01'),
      status: 'active',
    },
  });
});

after(async () => {
  // Restore process singleton so other test files are not throttled (M4).
  restoreAfterSuite?.();
  setLoginRateLimiter(new LoginRateLimiter({
    windowMs: 60_000,
    maxPerIp: 100_000,
    maxPerEmail: 100_000,
  }));
  await app.close();
  await prisma.$disconnect();
});

test('process-global singleton: getLoginRateLimiter is stable identity', () => {
  const a = getLoginRateLimiter();
  const b = getLoginRateLimiter();
  assert.equal(a, b, 'same process slot');
  const custom = new LoginRateLimiter({ maxPerIp: 1, maxPerEmail: 1, windowMs: 1000 });
  const restore = installLoginRateLimiterForTests(custom);
  assert.equal(getLoginRateLimiter(), custom);
  restore();
  assert.equal(getLoginRateLimiter(), a);
});

test('LoginRateLimiter unit: blocks after maxPerEmail', () => {
  const lim = new LoginRateLimiter({ windowMs: 60_000, maxPerIp: 100, maxPerEmail: 3 });
  assert.equal(lim.check('1.1.1.1', 'a@b.co').ok, true);
  assert.equal(lim.check('1.1.1.1', 'a@b.co').ok, true);
  assert.equal(lim.check('1.1.1.1', 'a@b.co').ok, true);
  const blocked = lim.check('1.1.1.1', 'a@b.co');
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'email');
  assert.ok((blocked.retryAfterSec ?? 0) >= 1);
});

test('LoginRateLimiter unit: blocks after maxPerIp independent of email', () => {
  const lim = new LoginRateLimiter({ windowMs: 60_000, maxPerIp: 2, maxPerEmail: 100 });
  assert.equal(lim.check('9.9.9.9', 'one@x.io').ok, true);
  assert.equal(lim.check('9.9.9.9', 'two@x.io').ok, true);
  const blocked = lim.check('9.9.9.9', 'three@x.io');
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'ip');
});

test('POST /auth/login returns AUTH-004 after too many attempts (process singleton)', async () => {
  const restore = installLoginRateLimiterForTests(new LoginRateLimiter({
    windowMs: 60_000,
    maxPerIp: 100,
    maxPerEmail: 3,
  }));
  try {
    const bad = { email, password: 'definitely-wrong-password-xx' };
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: bad,
      });
      assert.equal(res.statusCode, 401, `attempt ${i + 1} should still be AUTH-001`);
      assert.equal(res.json().code, 'AUTH-001');
    }

    const limited = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: bad,
    });
    assert.equal(limited.statusCode, 429);
    assert.equal(limited.json().code, 'AUTH-004');
    assert.ok(limited.headers['retry-after']);
  } finally {
    restore();
  }
});

test('resetLoginRateLimiterState clears process counters without replacing instance', () => {
  const lim = new LoginRateLimiter({ windowMs: 60_000, maxPerIp: 2, maxPerEmail: 2 });
  const restore = installLoginRateLimiterForTests(lim);
  try {
    assert.equal(getLoginRateLimiter().check('8.8.8.8', 'reset@x.io').ok, true);
    assert.equal(getLoginRateLimiter().check('8.8.8.8', 'reset@x.io').ok, true);
    assert.equal(getLoginRateLimiter().check('8.8.8.8', 'reset@x.io').ok, false);
    resetLoginRateLimiterState();
    assert.equal(getLoginRateLimiter(), lim, 'same instance after reset');
    assert.equal(getLoginRateLimiter().check('8.8.8.8', 'reset@x.io').ok, true);
  } finally {
    restore();
  }
});

test('API responses carry baseline security headers', async () => {
  const restore = installLoginRateLimiterForTests(new LoginRateLimiter({
    windowMs: 60_000,
    maxPerIp: 1000,
    maxPerEmail: 1000,
  }));
  try {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: `other-${randomUUID()}@x.io`, password: 'wrong-password-xx' },
    });
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['x-frame-options'], 'DENY');
    assert.equal(res.headers['referrer-policy'], 'strict-origin-when-cross-origin');
    assert.equal(res.headers['cache-control'], 'no-store');
  } finally {
    restore();
  }
});
