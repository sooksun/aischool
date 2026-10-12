// SEIP-DB-001 — schema vs entity-dictionary checklist (MySQL edition, ADR-0008).
// Asserts the tables that implement the dictionary exist (and ChallengeScore is merged).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';

const url = process.env.DATABASE_URL ?? 'mysql://root@localhost:3306/seip';
let conn;

async function q(sql, params = []) {
  const [rows] = await conn.query(sql, params);
  return rows;
}

/** entity-dictionary.md entities → expected physical table (snake_case @@map). */
const EXPECTED_TABLES = [
  'area',
  'school',
  'user_account',
  'school_membership',
  'rank_level',
  'personnel_profile',
  'framework_version',
  'evaluation_domain',
  'indicator',
  'indicator_level_description',
  'score_weight',
  'evidence_category',
  'evaluation_cycle',
  'evaluation_round',
  'performance_agreement',
  'workload_declaration',
  'agreement_challenge',
  'evidence',
  'evidence_file',
  'evidence_indicator_mapping',
  'evaluation_assignment',
  'committee_member',
  'indicator_score', // IndicatorScore + ChallengeScore merged (DB-001 decision)
  'round_result',
  'report',
  'report_section_ref',
  'approval',
  'audit_event',
];

const MERGED_AWAY = ['challenge_score'];

before(async () => {
  conn = await mysql.createConnection(url);
});
after(async () => {
  await conn.end();
});

test('all entity-dictionary tables exist', async () => {
  const r = await q(
    `SELECT table_name AS table_name FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'`,
  );
  const have = new Set(r.map((row) => row.table_name));
  for (const t of EXPECTED_TABLES) {
    assert.ok(have.has(t), `missing table ${t} from entity-dictionary`);
  }
});

test('ChallengeScore has no separate table (merged into indicator_score)', async () => {
  const r = await q(
    `SELECT COUNT(*) AS c FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = 'challenge_score'`,
  );
  assert.equal(Number(r[0].c), 0);
  for (const t of MERGED_AWAY) {
    assert.ok(!EXPECTED_TABLES.includes(t));
  }
});

test('operational tables that need tenancy carry school_id', async () => {
  // From entity-dictionary + module rules: school-scoped operational aggregates.
  const needSchoolId = [
    'personnel_profile',
    'evaluation_cycle',
    'performance_agreement',
    'evidence',
    'evidence_indicator_mapping',
    'evaluation_assignment',
    'report',
    'approval',
  ];
  for (const table of needSchoolId) {
    const r = await q(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = ? AND column_name = 'school_id'`,
      [table],
    );
    assert.equal(r.length, 1, `${table} must have school_id for tenancy`);
  }
});

test('DB constraint objects from constraints migration are present', async () => {
  const checks = await q(
    `SELECT tc.constraint_name AS constraint_name
     FROM information_schema.table_constraints tc
     WHERE tc.constraint_schema = DATABASE() AND tc.constraint_type = 'CHECK'`,
  );
  const names = new Set(checks.map((r) => r.constraint_name));
  for (const need of [
    'ild_rubric_level_range',
    'score_rubric_level_range',
    'committee_seat_range',
    'round_number_positive',
    'membership_scope_ids',
    'user_email_lowercase',
    'workload_gate_not_scored',
    'mapping_confirmed_has_actor',
    'round_result_percent_range',
  ]) {
    assert.ok(names.has(need), `missing CHECK constraint ${need}`);
  }

  const indexes = await q(
    `SELECT DISTINCT index_name AS index_name FROM information_schema.statistics
     WHERE table_schema = DATABASE()`,
  );
  const idx = new Set(indexes.map((r) => r.index_name));
  assert.ok(idx.has('evidence_indicator_mapping_active_uk'));
  assert.ok(idx.has('evaluation_cycle_pa_uk'));

  // passed_individual_threshold + pa_uk_key are STORED GENERATED; active_uk_key is
  // trigger-maintained because InnoDB refuses evidence's ON DELETE CASCADE on a
  // generated base column (see the constraints migration header).
  const gen = await q(
    `SELECT table_name AS table_name, column_name AS column_name FROM information_schema.columns
     WHERE table_schema = DATABASE() AND extra LIKE '%GENERATED%'`,
  );
  const genSet = new Set(gen.map((r) => `${r.table_name}.${r.column_name}`));
  assert.ok(genSet.has('round_result.passed_individual_threshold'), 'passed_individual_threshold must be generated');
  assert.ok(genSet.has('evaluation_cycle.pa_uk_key'), 'pa_uk_key must be generated');

  const triggers = await q(
    `SELECT trigger_name AS trigger_name FROM information_schema.triggers
     WHERE trigger_schema = DATABASE()`,
  );
  const tgnames = triggers.map((r) => r.trigger_name);
  assert.ok(tgnames.includes('audit_event_no_update'));
  assert.ok(tgnames.includes('audit_event_no_delete'));
  assert.ok(tgnames.includes('eim_active_uk_key_ins'), 'active_uk_key insert trigger');
  assert.ok(tgnames.includes('eim_active_uk_key_upd'), 'active_uk_key update trigger');
});
