// SEIP-DB-001 — verifies seed data shape after `npm run db:seed`.
// Skips (pass with notice) if frameworks not seeded yet, so constraint CI can run
// on a fresh migrate without requiring seed first.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

const url = process.env.DATABASE_URL
  ?? 'postgresql://seip:seip_dev_only@localhost:5433/seip?schema=public';
const client = new pg.Client({ connectionString: url });

before(async () => {
  await client.connect();
});
after(async () => {
  await client.end();
});

async function frameworkId(code) {
  const r = await client.query(
    `SELECT id FROM framework_version WHERE code = $1`,
    [code],
  );
  return r.rows[0]?.id ?? null;
}

test('seeded ว9/ว10 frameworks exist with expected indicator counts', async (t) => {
  const v9 = await frameworkId('v9-2564-teacher');
  const v10 = await frameworkId('v10-2564-administrator');
  if (!v9 || !v10) {
    t.skip('taxonomy seed not applied yet — run npm run db:seed');
    return;
  }

  const count = async (fwId, kind = null) => {
    if (kind) {
      const r = await client.query(
        `SELECT count(*)::int AS c FROM indicator WHERE framework_version_id=$1 AND indicator_kind=$2`,
        [fwId, kind],
      );
      return r.rows[0].c;
    }
    const r = await client.query(
      `SELECT count(*)::int AS c FROM indicator WHERE framework_version_id=$1`,
      [fwId],
    );
    return r.rows[0].c;
  };

  // 15 standard + 3 challenge + 1 workload = 19
  assert.equal(await count(v9), 19, 'ว9 total indicators');
  assert.equal(await count(v9, 'standard'), 15, 'ว9 standard');
  assert.equal(await count(v9, 'challenge'), 3, 'ว9 challenge');
  assert.equal(await count(v9, 'workload_gate'), 1, 'ว9 workload gate');

  assert.equal(await count(v10), 19, 'ว10 total indicators');
  assert.equal(await count(v10, 'standard'), 15, 'ว10 standard');
  assert.equal(await count(v10, 'challenge'), 3, 'ว10 challenge');
  assert.equal(await count(v10, 'workload_gate'), 1, 'ว10 workload gate');

  // Codes from evaluation-framework.md
  for (const code of ['T-1.1', 'T-1.8', 'T-2.4', 'T-3.3', 'T-C.1', 'T-C.2.1', 'T-C.2.2', 'T-W.1']) {
    const r = await client.query(
      `SELECT 1 FROM indicator WHERE framework_version_id=$1 AND code=$2`,
      [v9, code],
    );
    assert.equal(r.rowCount, 1, `missing ว9 code ${code}`);
  }
  for (const code of ['A-1.1', 'A-1.6', 'A-5.2', 'A-C.1', 'A-C.2.2', 'A-W.1']) {
    const r = await client.query(
      `SELECT 1 FROM indicator WHERE framework_version_id=$1 AND code=$2`,
      [v10, code],
    );
    assert.equal(r.rowCount, 1, `missing ว10 code ${code}`);
  }

  // Weights are data
  for (const fw of [v9, v10]) {
    const w = await client.query(
      `SELECT weight_key, weight_value::float AS v FROM score_weight WHERE framework_version_id=$1 ORDER BY weight_key`,
      [fw],
    );
    const map = Object.fromEntries(w.rows.map((row) => [row.weight_key, row.v]));
    assert.equal(map.part1_total, 60);
    assert.equal(map.part2_total, 40);
    assert.equal(map.pass_threshold_percent, 70);
  }

  // Evidence categories include 10-minute inspiration video limit
  const cat = await client.query(
    `SELECT max_duration_seconds FROM evidence_category WHERE code='inspiration_video'`,
  );
  assert.equal(cat.rows[0].max_duration_seconds, 600);
});
