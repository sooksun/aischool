// SEIP-DB-001 — verifies seed data shape after `npm run db:seed` (MySQL, ADR-0008).
// Skips (pass with notice) if frameworks not seeded yet, so constraint CI can run
// on a fresh migrate without requiring seed first.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';

const url = process.env.DATABASE_URL ?? 'mysql://root@localhost:3306/seip';
let conn;

async function q(sql, params = []) {
  const [rows] = await conn.query(sql, params);
  return rows;
}

before(async () => {
  conn = await mysql.createConnection(url);
});
after(async () => {
  await conn.end();
});

async function frameworkId(code) {
  const r = await q(`SELECT id FROM framework_version WHERE code = ?`, [code]);
  return r[0]?.id ?? null;
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
      const r = await q(
        `SELECT CAST(COUNT(*) AS SIGNED) AS c FROM indicator WHERE framework_version_id=? AND indicator_kind=?`,
        [fwId, kind],
      );
      return Number(r[0].c);
    }
    const r = await q(
      `SELECT CAST(COUNT(*) AS SIGNED) AS c FROM indicator WHERE framework_version_id=?`,
      [fwId],
    );
    return Number(r[0].c);
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
    const r = await q(
      `SELECT 1 FROM indicator WHERE framework_version_id=? AND code=?`,
      [v9, code],
    );
    assert.equal(r.length, 1, `missing ว9 code ${code}`);
  }
  for (const code of ['A-1.1', 'A-1.6', 'A-5.2', 'A-C.1', 'A-C.2.2', 'A-W.1']) {
    const r = await q(
      `SELECT 1 FROM indicator WHERE framework_version_id=? AND code=?`,
      [v10, code],
    );
    assert.equal(r.length, 1, `missing ว10 code ${code}`);
  }

  // Weights are data
  for (const fw of [v9, v10]) {
    const w = await q(
      `SELECT weight_key AS weight_key, CAST(weight_value AS DOUBLE) AS v
       FROM score_weight WHERE framework_version_id=? ORDER BY weight_key`,
      [fw],
    );
    const map = Object.fromEntries(w.map((row) => [row.weight_key, Number(row.v)]));
    assert.equal(map.part1_total, 60);
    assert.equal(map.part2_total, 40);
    assert.equal(map.pass_threshold_percent, 70);
  }

  // Evidence categories include 10-minute inspiration video limit
  const cat = await q(
    `SELECT max_duration_seconds AS max_duration_seconds FROM evidence_category WHERE code='inspiration_video'`,
  );
  assert.equal(Number(cat[0].max_duration_seconds), 600);
});

test('SEIP-DB-003: level descriptions cover scored indicators × ranks × rubric 1..4', async (t) => {
  const v9 = await frameworkId('v9-2564-teacher');
  const v10 = await frameworkId('v10-2564-administrator');
  if (!v9 || !v10) {
    t.skip('taxonomy seed not applied yet — run npm run db:seed');
    return;
  }

  // 18 scored × 6 ranks × 4 levels = 432; admin 18 × 5 × 4 = 360
  const countForFw = async (fwId) => {
    const r = await q(
      `SELECT CAST(COUNT(*) AS SIGNED) AS c
       FROM indicator_level_description ild
       JOIN indicator i ON i.id = ild.indicator_id
       WHERE i.framework_version_id = ?`,
      [fwId],
    );
    return Number(r[0].c);
  };
  assert.equal(await countForFw(v9), 432, 'ว9 level-description rows');
  assert.equal(await countForFw(v10), 360, 'ว10 level-description rows');

  // Every scored indicator has 4 levels for a representative rank
  const sample = await q(
    `SELECT i.code AS code, CAST(COUNT(*) AS SIGNED) AS c
     FROM indicator i
     JOIN indicator_level_description ild ON ild.indicator_id = i.id
     WHERE i.framework_version_id = ?
       AND i.indicator_kind = 'standard'
       AND ild.rank_level_code = 'apply_adapt'
     GROUP BY i.code
     ORDER BY i.code`,
    [v9],
  );
  assert.equal(sample.length, 15, '15 standard indicators with apply_adapt rows');
  for (const row of sample) {
    assert.equal(Number(row.c), 4, `${row.code} must have rubric levels 1..4`);
  }

  // Workload gate must not get level rows
  const gate = await q(
    `SELECT CAST(COUNT(*) AS SIGNED) AS c
     FROM indicator_level_description ild
     JOIN indicator i ON i.id = ild.indicator_id
     WHERE i.framework_version_id = ? AND i.indicator_kind = 'workload_gate'`,
    [v9],
  );
  assert.equal(Number(gate[0].c), 0, 'workload_gate must have no level descriptions');

  // Rubric CHECK still holds for seeded data (1..4 only)
  const bad = await q(
    `SELECT CAST(COUNT(*) AS SIGNED) AS c FROM indicator_level_description WHERE rubric_level NOT BETWEEN 1 AND 4`,
  );
  assert.equal(Number(bad[0].c), 0);

  // Text is non-empty and mentions rubric anchor language from the framework
  const text = await q(
    `SELECT expected_practice_th AS expected_practice_th FROM indicator_level_description ild
     JOIN indicator i ON i.id = ild.indicator_id
     WHERE i.code = 'T-1.1' AND ild.rank_level_code = 'apply_adapt' AND ild.rubric_level = 3
     LIMIT 1`,
  );
  assert.equal(text.length, 1);
  assert.match(text[0].expected_practice_th, /ตามที่คาดหวัง/);
  assert.match(text[0].expected_practice_th, /T-1\.1/);

  // SEIP-DB-004: real PA 2/ส text has replaced the DB-003 template placeholder
  // for ranks that have a PA 2/ส form (regression guard against the swap
  // silently reverting). The real T-1.1/apply_adapt anchor text does not
  // literally contain "T-1.1" or "หลักสูตร" (see level-description-anchors.mjs),
  // but does contain "หน่วยการเรียนรู้" — check for that plus absence of the
  // old template's own self-describing marker string.
  assert.match(text[0].expected_practice_th, /หน่วยการเรียนรู้/);
  assert.doesNotMatch(text[0].expected_practice_th, /seed โครงสร้าง SEIP-DB-003/);

  // execute_learn (ครูผู้ช่วย) has no PA 2/ส form of its own — it keeps the
  // structural placeholder, and the placeholder must say so explicitly rather
  // than silently reusing generic template wording.
  const placeholder = await q(
    `SELECT expected_practice_th AS expected_practice_th FROM indicator_level_description ild
     JOIN indicator i ON i.id = ild.indicator_id
     WHERE i.code = 'T-1.1' AND ild.rank_level_code = 'execute_learn' AND ild.rubric_level = 3
     LIMIT 1`,
  );
  assert.equal(placeholder.length, 1);
  assert.match(placeholder[0].expected_practice_th, /ไม่มีแบบฟอร์ม PA 2\/ส/);
});
