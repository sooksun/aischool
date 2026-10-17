// CCR-017 / ADR-0017: committee scoring and report approval are v2 — compiled,
// but served only when FEATURE_SCORING=true. (Phase-gated v1 operations answering
// 501 SYS-003 are covered in reports-and-ai.test.mjs and the permission matrix.)
process.env.NODE_ENV = 'test';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildServer } from '../dist/server.js';

async function serverWith(flag) {
  const before = process.env.FEATURE_SCORING;
  process.env.FEATURE_SCORING = flag;
  try {
    const { app } = await buildServer();
    await app.ready();
    return app;
  } finally {
    if (before === undefined) delete process.env.FEATURE_SCORING;
    else process.env.FEATURE_SCORING = before;
  }
}

// The global auth hook answers 401 before routing reaches not-found, so the
// assertion is on the route table itself.
const V2 = [
  ['PUT', '/api/v1/assignments/:assignmentId/my-scores'],
  ['GET', '/api/v1/assignments/:assignmentId/results'],
  ['GET', '/api/v1/reports'],
  ['POST', '/api/v1/reports'],
  ['GET', '/api/v1/reports/:reportId'],
];

test('FEATURE_SCORING=false: v2 scoring and report routes are not registered', async (t) => {
  const app = await serverWith('false');
  t.after(() => app.close());
  for (const [method, url] of V2) {
    assert.equal(app.hasRoute({ method, url }), false, `${method} ${url} must not exist with scoring frozen`);
  }
  // v1 scoring setup (rounds, assignments) stays served.
  assert.equal(app.hasRoute({ method: 'GET', url: '/api/v1/rounds/:roundId/assignments' }), true);
});

test('FEATURE_SCORING=true: the v2 routes are registered', async (t) => {
  const app = await serverWith('true');
  t.after(() => app.close());
  for (const [method, url] of V2) {
    assert.equal(app.hasRoute({ method, url }), true, `${method} ${url}`);
  }
});
