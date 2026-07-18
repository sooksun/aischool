// SEIP-DB-001 constraint tests — prove the database enforces the ว9/ว10 rules,
// not just that the app intends to. Uses node:test + mysql2 against the dev
// database (Laragon MySQL, ADR-0008). These are the tests the "migration
// validation" gate will run.
//
// Each test asserts a WRITE THAT SHOULD FAIL actually fails at the DB layer, and a
// valid write succeeds. No ORM — raw SQL so we test the constraint, not Prisma.
//
// MySQL port notes (ADR-0008): ids are generated in JS (no RETURNING clause),
// JSON replaces text[] for allowed_mime_types, and booleans read back as 0/1.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';

const url = process.env.DATABASE_URL ?? 'mysql://root@localhost:3306/seip';
let conn;

const uid = () => randomUUID();

async function q(sql, params = []) {
  const [rows] = await conn.query(sql, params);
  return rows;
}

// Expect a statement to be rejected by the DB with a constraint-class error.
// Unlike Postgres, a failed statement does not abort the MySQL transaction, so
// no SAVEPOINT dance is needed — the surrounding test transaction stays usable.
//   3819 CHECK violated · 1644 SIGNAL 45000 (append-only triggers) · 1062 dup key
//   3105 write to generated column · 1048 NOT NULL · 1452 FK · 1264 out of range
async function rejects(sql, params, label) {
  let threw = false;
  try {
    await conn.query(sql, params);
  } catch (e) {
    threw = true;
    assert.ok(
      [3819, 1644, 1062, 3105, 1048, 1452, 1264].includes(e.errno),
      `${label}: unexpected error ${e.errno} ${e.message}`,
    );
  }
  assert.ok(threw, `${label}: expected the write to be rejected, but it succeeded`);
}

async function rollback() {
  await conn.query('ROLLBACK');
}

before(async () => {
  conn = await mysql.createConnection(url);
});
after(async () => {
  await conn.end();
});

async function mkFramework(code) {
  const id = uid();
  await q(
    `INSERT INTO framework_version (id, code, role_family, legal_ref, revision_year, status, effective_from)
     VALUES (?, ?, 'teacher', 'ว9', 2564, 'active', '2021-05-20')`, [id, code]);
  return id;
}

async function mkDomain(fwId, code = 'D1', part = 'standards', sort = 1) {
  const id = uid();
  await q(
    `INSERT INTO evaluation_domain (id, framework_version_id, code, name_th, sort_order, part)
     VALUES (?, ?, ?, 'ด้าน', ?, ?)`, [id, fwId, code, sort, part]);
  return id;
}

async function mkIndicator(dId, fwId, code, kind = 'standard', extra = {}) {
  const id = uid();
  await q(
    `INSERT INTO indicator (id, domain_id, framework_version_id, code, name_th, sort_order, is_scored, indicator_kind, max_points)
     VALUES (?, ?, ?, ?, 'x', 1, true, ?, ?)`, [id, dId, fwId, code, kind, extra.maxPoints ?? null]);
  return id;
}

test('rubric_level must be 1..4 (framework scoring model)', async (t) => {
  await conn.query('BEGIN');
  t.after(rollback);
  const fwId = await mkFramework('t1-fw');
  const dId = await mkDomain(fwId);
  const iId = await mkIndicator(dId, fwId, 'T-1.1');
  await q(`INSERT IGNORE INTO rank_level (code, role_family, label_th, sort_order) VALUES ('kru','teacher','ครู',2)`);

  await rejects(
    `INSERT INTO indicator_level_description (id, indicator_id, rank_level_code, rubric_level, expected_practice_th)
     VALUES (?, ?, 'kru', 5, 'x')`, [uid(), iId], 'rubric_level 5 must be rejected');
  await q(
    `INSERT INTO indicator_level_description (id, indicator_id, rank_level_code, rubric_level, expected_practice_th)
     VALUES (?, ?, 'kru', 4, 'x')`, [uid(), iId]); // 4 is valid
});

test('workload_gate indicator cannot be is_scored=true', async (t) => {
  await conn.query('BEGIN');
  t.after(rollback);
  const fwId = await mkFramework('t2-fw');
  const dId = await mkDomain(fwId);
  await rejects(
    `INSERT INTO indicator (id, domain_id, framework_version_id, code, name_th, sort_order, is_scored, indicator_kind)
     VALUES (?, ?, ?, 'GATE', 'ภาระงาน', 9, true, 'workload_gate')`, [uid(), dId, fwId],
    'workload_gate with is_scored=true must be rejected');
});

test('membership scope must match the id that is set (tenancy)', async (t) => {
  await conn.query('BEGIN');
  t.after(rollback);
  const uId = uid();
  await q(`INSERT INTO user_account (id, email, display_name, status) VALUES (?, 'a@x.io', 'A', 'active')`, [uId]);
  // scope=school but no school_id → reject
  await rejects(
    `INSERT INTO school_membership (id, user_id, role, membership_scope, effective_from)
     VALUES (?, ?, 'teacher', 'school', '2026-01-01')`, [uid(), uId],
    'school scope without school_id must be rejected');
});

test('email must be lowercase', async (t) => {
  await conn.query('BEGIN');
  t.after(rollback);
  await rejects(
    `INSERT INTO user_account (id, email, display_name, status) VALUES (?, 'MixedCase@x.io', 'A', 'active')`, [uid()],
    'uppercase email must be rejected');
});

async function mkEvidenceGraph(prefix) {
  const sId = uid(); const uId = uid(); const pId = uid(); const cId = uid(); const eId = uid();
  await q(`INSERT INTO school (id, code, name) VALUES (?, ?, 's')`, [sId, `S-${prefix}`]);
  await q(`INSERT INTO user_account (id, email, display_name, status) VALUES (?, ?, 'M', 'active')`, [uId, `${prefix}@x.io`]);
  await q(`INSERT IGNORE INTO rank_level (code, role_family, label_th, sort_order) VALUES (?, 'teacher', 'ครู', 2)`, [`kru-${prefix}`]);
  await q(`INSERT INTO personnel_profile (id, school_id, user_id, full_name, position_role, rank_level_code) VALUES (?, ?, ?, 'p', 'teacher', ?)`, [pId, sId, uId, `kru-${prefix}`]);
  await q(`INSERT INTO evidence_category (id, code, label_th, allowed_mime_types) VALUES (?, ?, 'เอกสาร', '["application/pdf"]')`, [cId, `pdf-${prefix}`]);
  await q(`INSERT INTO evidence (id, school_id, owner_personnel_id, uploaded_by_user_id, category_id, title, status) VALUES (?, ?, ?, ?, ?, 't', 'active')`, [eId, sId, pId, uId, cId]);
  const fwId = await mkFramework(`${prefix}-fw`);
  const dId = await mkDomain(fwId);
  const iId = await mkIndicator(dId, fwId, 'T-1.1');
  return { sId, uId, pId, cId, eId, fwId, dId, iId };
}

test('only one ACTIVE mapping per (evidence, indicator, cycle); revoked frees the slot', async (t) => {
  await conn.query('BEGIN');
  t.after(rollback);
  const { sId, uId, eId, iId } = await mkEvidenceGraph('t5');

  const mk = (status) => q(
    `INSERT INTO evidence_indicator_mapping (id, school_id, evidence_id, indicator_id, mapping_source, status, mapped_by_user_id)
     VALUES (?, ?, ?, ?, 'human', ?, ?)`, [uid(), sId, eId, iId, status, uId]);

  await mk('suggested');
  await rejects(
    `INSERT INTO evidence_indicator_mapping (id, school_id, evidence_id, indicator_id, mapping_source, status, mapped_by_user_id)
     VALUES (?, ?, ?, ?, 'human', 'confirmed', ?)`, [uid(), sId, eId, iId, uId],
    'a second active (confirmed) mapping to the same indicator must be rejected');
  await q(`UPDATE evidence_indicator_mapping SET status='revoked' WHERE evidence_id=?`, [eId]);
  await mk('suggested');
});

test('confirmed mapping requires confirmed_by + confirmed_at', async (t) => {
  await conn.query('BEGIN');
  t.after(rollback);
  const { sId, uId, eId, iId } = await mkEvidenceGraph('conf');

  await rejects(
    `INSERT INTO evidence_indicator_mapping (id, school_id, evidence_id, indicator_id, mapping_source, status, mapped_by_user_id)
     VALUES (?, ?, ?, ?, 'human', 'confirmed', ?)`,
    [uid(), sId, eId, iId, uId],
    'confirmed without actor/timestamp must be rejected',
  );

  await q(
    `INSERT INTO evidence_indicator_mapping
       (id, school_id, evidence_id, indicator_id, mapping_source, status, mapped_by_user_id, confirmed_by_user_id, confirmed_at)
     VALUES (?, ?, ?, ?, 'human', 'confirmed', ?, ?, NOW())`,
    [uid(), sId, eId, iId, uId, uId],
  );
});

async function mkAssignmentGraph(prefix) {
  const sId = uid(); const uId = uid(); const pId = uid(); const cyId = uid(); const rId = uid(); const aId = uid();
  await q(`INSERT INTO school (id, code, name) VALUES (?, ?, 's')`, [sId, `S-${prefix}`]);
  await q(`INSERT INTO user_account (id, email, display_name, status) VALUES (?, ?, 'E', 'active')`, [uId, `${prefix}@x.io`]);
  await q(`INSERT IGNORE INTO rank_level (code, role_family, label_th, sort_order) VALUES (?, 'teacher', 'ครู', 2)`, [`kru-${prefix}`]);
  await q(`INSERT INTO personnel_profile (id, school_id, user_id, full_name, position_role, rank_level_code) VALUES (?, ?, ?, 'p', 'teacher', ?)`, [pId, sId, uId, `kru-${prefix}`]);
  const fwId = await mkFramework(`${prefix}-fw`);
  await q(`INSERT INTO evaluation_cycle (id, school_id, framework_version_id, fiscal_year, evaluation_kind, title, status, starts_on, ends_on) VALUES (?, ?, ?, 2569, 'pa', 'c', 'open', '2025-10-01', '2026-09-30')`, [cyId, sId, fwId]);
  await q(`INSERT INTO evaluation_round (id, cycle_id, round_number, purpose, period_start, period_end, status) VALUES (?, ?, 1, 'formal', '2025-10-01', '2026-09-30', 'scoring')`, [rId, cyId]);
  await q(`INSERT INTO evaluation_assignment (id, school_id, round_id, evaluatee_personnel_id, status) VALUES (?, ?, ?, ?, 'in_progress')`, [aId, sId, rId, pId]);
  return { sId, uId, pId, fwId, cyId, rId, aId };
}

test('passed_individual_threshold is generated (>=70) and cannot be written', async (t) => {
  await conn.query('BEGIN');
  t.after(rollback);
  const { uId, aId } = await mkAssignmentGraph('t6');

  await rejects(
    `INSERT INTO round_result (id, assignment_id, evaluator_user_id, part1_percent, part2_percent, total_percent, passed_workload_gate, passed_individual_threshold)
     VALUES (?, ?, ?, 50, 20, 68, true, true)`, [uid(), aId, uId],
    'writing the generated column must be rejected');

  await q(
    `INSERT INTO round_result (id, assignment_id, evaluator_user_id, part1_percent, part2_percent, total_percent, passed_workload_gate)
     VALUES (?, ?, ?, 48, 20, 68, true)`, [uid(), aId, uId]);
  const r = await q(`SELECT passed_individual_threshold AS p FROM round_result WHERE assignment_id=?`, [aId]);
  assert.equal(Number(r[0].p), 0, '68% must derive to NOT passed');

  // 70% boundary → pass
  const u2 = uid();
  await q(`INSERT INTO user_account (id, email, display_name, status) VALUES (?, 'ev2-t6@x.io', 'E2', 'active')`, [u2]);
  await q(
    `INSERT INTO round_result (id, assignment_id, evaluator_user_id, part1_percent, part2_percent, total_percent, passed_workload_gate)
     VALUES (?, ?, ?, 50, 20, 70, true)`, [uid(), aId, u2]);
  const r2 = await q(`SELECT passed_individual_threshold AS p FROM round_result WHERE assignment_id=? AND evaluator_user_id=?`, [aId, u2]);
  assert.equal(Number(r2[0].p), 1, '70% must derive to passed');
});

test('audit_event is append-only: UPDATE and DELETE are blocked', async (t) => {
  await conn.query('BEGIN');
  t.after(rollback);
  const id = uid();
  await q(`INSERT INTO audit_event (id, action, entity_type, entity_id) VALUES (?, 'created', 'evidence', ?)`, [id, uid()]);
  await rejects(`UPDATE audit_event SET action='tampered' WHERE id=?`, [id], 'UPDATE on audit_event must be blocked');
  await rejects(`DELETE FROM audit_event WHERE id=?`, [id], 'DELETE on audit_event must be blocked');
});

test('committee seat_number must be 1..3', async (t) => {
  await conn.query('BEGIN');
  t.after(rollback);
  const { uId, aId } = await mkAssignmentGraph('t7');

  await rejects(
    `INSERT INTO committee_member (id, assignment_id, evaluator_user_id, committee_role, seat_number)
     VALUES (?, ?, ?, 'chair', 4)`, [uid(), aId, uId],
    'seat 4 must be rejected');
  await q(
    `INSERT INTO committee_member (id, assignment_id, evaluator_user_id, committee_role, seat_number)
     VALUES (?, ?, ?, 'chair', 1)`, [uid(), aId, uId]);
});

test('rounds are configurable 1..n per cycle (no hard-coded max of 2)', async (t) => {
  await conn.query('BEGIN');
  t.after(rollback);
  const sId = uid(); const cyId = uid();
  await q(`INSERT INTO school (id, code, name) VALUES (?, 'S-t8', 's')`, [sId]);
  const fwId = await mkFramework('t8-fw');
  await q(`INSERT INTO evaluation_cycle (id, school_id, framework_version_id, fiscal_year, evaluation_kind, title, status, starts_on, ends_on) VALUES (?, ?, ?, 2570, 'pa', 'c', 'open', '2026-10-01', '2027-09-30')`, [cyId, sId, fwId]);

  await rejects(
    `INSERT INTO evaluation_round (id, cycle_id, round_number, purpose, period_start, period_end, status)
     VALUES (?, ?, 0, 'bad', '2026-10-01', '2026-12-31', 'planned')`, [uid(), cyId],
    'round_number 0 must be rejected');

  // Three rounds in one cycle must succeed (acceptance: configurable 1..n, not hard-coded to 2).
  for (const n of [1, 2, 3]) {
    await q(
      `INSERT INTO evaluation_round (id, cycle_id, round_number, purpose, period_start, period_end, status)
       VALUES (?, ?, ?, ?, '2026-10-01', '2027-09-30', 'planned')`,
      [uid(), cyId, n, `round-${n}`],
    );
  }
  const count = await q(`SELECT CAST(COUNT(*) AS SIGNED) AS c FROM evaluation_round WHERE cycle_id=?`, [cyId]);
  assert.equal(Number(count[0].c), 3);
});

test('PA cycle unique per (school, fiscal_year, framework); DPA may repeat', async (t) => {
  await conn.query('BEGIN');
  t.after(rollback);
  const sId = uid();
  await q(`INSERT INTO school (id, code, name) VALUES (?, 'S-t9', 's')`, [sId]);
  const fwId = await mkFramework('t9-fw');

  await q(
    `INSERT INTO evaluation_cycle (id, school_id, framework_version_id, fiscal_year, evaluation_kind, title, status, starts_on, ends_on)
     VALUES (?, ?, ?, 2571, 'pa', 'PA1', 'open', '2027-10-01', '2028-09-30')`,
    [uid(), sId, fwId],
  );
  await rejects(
    `INSERT INTO evaluation_cycle (id, school_id, framework_version_id, fiscal_year, evaluation_kind, title, status, starts_on, ends_on)
     VALUES (?, ?, ?, 2571, 'pa', 'PA-dup', 'open', '2027-10-01', '2028-09-30')`,
    [uid(), sId, fwId],
    'duplicate PA cycle must be rejected',
  );

  // DPA on-demand may appear more than once for the same school/year/framework.
  for (const title of ['DPA-1', 'DPA-2']) {
    await q(
      `INSERT INTO evaluation_cycle (id, school_id, framework_version_id, fiscal_year, evaluation_kind, title, status, starts_on, ends_on)
       VALUES (?, ?, ?, 2571, 'dpa', ?, 'open', '2027-10-01', '2028-09-30')`,
      [uid(), sId, fwId, title],
    );
  }
});

test('standard and challenge scores share indicator_score (ChallengeScore merge)', async (t) => {
  await conn.query('BEGIN');
  t.after(rollback);
  const { uId, fwId, aId } = await mkAssignmentGraph('t10');
  const dCh = await mkDomain(fwId, 'C', 'challenge', 2);
  const dStd = await mkDomain(fwId, 'D2', 'standards', 3);
  const iStd = await mkIndicator(dStd, fwId, 'T-1.1');
  const iCh = await mkIndicator(dCh, fwId, 'T-C.1', 'challenge', { maxPoints: 20 });

  // No separate challenge_score table — both kinds write indicator_score.
  const tables = await q(
    `SELECT
       (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'challenge_score') AS challenge_score,
       (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'indicator_score') AS indicator_score`,
  );
  assert.equal(Number(tables[0].challenge_score), 0, 'challenge_score table must not exist (merged)');
  assert.equal(Number(tables[0].indicator_score), 1, 'indicator_score table must exist');

  await q(
    `INSERT INTO indicator_score (id, assignment_id, indicator_id, evaluator_user_id, rubric_level, points_awarded)
     VALUES (?, ?, ?, ?, 3, NULL)`, [uid(), aId, iStd, uId]);
  await q(
    `INSERT INTO indicator_score (id, assignment_id, indicator_id, evaluator_user_id, rubric_level, points_awarded)
     VALUES (?, ?, ?, ?, 4, 20)`, [uid(), aId, iCh, uId]);

  const n = await q(`SELECT CAST(COUNT(*) AS SIGNED) AS c FROM indicator_score WHERE assignment_id=?`, [aId]);
  assert.equal(Number(n[0].c), 2);
});

test('evidence_file is metadata-only columns (no bytea payload)', async (t) => {
  await conn.query('BEGIN');
  t.after(rollback);
  const cols = await q(
    `SELECT column_name AS column_name, data_type AS data_type FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'evidence_file'
     ORDER BY ordinal_position`,
  );
  const names = cols.map((r) => r.column_name);
  assert.ok(names.includes('storage_uri'));
  assert.ok(names.includes('storage_provider'));
  assert.ok(names.includes('checksum_sha256'));
  assert.ok(!names.includes('bytes'), 'must not store file bytes in the DB (ADR-0005 / SEC-UPL-1)');
  const blobTypes = ['blob', 'mediumblob', 'longblob', 'tinyblob', 'binary', 'varbinary'];
  assert.ok(
    !cols.some((r) => blobTypes.includes(String(r.data_type).toLowerCase())),
    'no blob/binary column on evidence_file',
  );
});
