// SEIP-DB-001 — schema vs entity-dictionary checklist (PostgreSQL 18, ADR-0012).
// Asserts the tables that implement the dictionary exist (and ChallengeScore is merged).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

const url = process.env.DATABASE_URL
  ?? 'postgresql://seip_app:seip_app_dev@localhost:5432/seip';
const client = new pg.Client({ connectionString: url });

const toPg = (sql) => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };
async function q(sql, params = []) {
  return (await client.query(toPg(sql), params)).rows;
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
  await client.connect();
});
after(async () => {
  await client.end();
});

test('all entity-dictionary tables exist', async () => {
  const r = await q(
    `SELECT table_name AS table_name FROM information_schema.tables
     WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'`,
  );
  const have = new Set(r.map((row) => row.table_name));
  for (const t of EXPECTED_TABLES) {
    assert.ok(have.has(t), `missing table ${t} from entity-dictionary`);
  }
});

test('ChallengeScore has no separate table (merged into indicator_score)', async () => {
  const r = await q(
    `SELECT COUNT(*) AS c FROM information_schema.tables
     WHERE table_schema = current_schema() AND table_name = 'challenge_score'`,
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
       WHERE table_schema = current_schema() AND table_name = ? AND column_name = 'school_id'`,
      [table],
    );
    assert.equal(r.length, 1, `${table} must have school_id for tenancy`);
  }
});

test('DB constraint objects from constraints migration are present', async () => {
  const checks = await q(
    `SELECT tc.constraint_name AS constraint_name
     FROM information_schema.table_constraints tc
     WHERE tc.constraint_schema = current_schema() AND tc.constraint_type = 'CHECK'`,
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
    `SELECT indexname AS index_name, indexdef FROM pg_indexes WHERE schemaname = current_schema()`,
  );
  const idx = new Map(indexes.map((r) => [r.index_name, r.indexdef]));
  // Partial unique indexes (ADR-0012 §3) — not generated key columns or triggers.
  assert.match(idx.get('evidence_indicator_mapping_active_uk') ?? '', /UNIQUE.*NULLS NOT DISTINCT.*WHERE/);
  assert.match(idx.get('evaluation_cycle_pa_uk') ?? '', /UNIQUE.*WHERE/);

  const gen = await q(
    `SELECT table_name AS table_name, column_name AS column_name FROM information_schema.columns
     WHERE table_schema = current_schema() AND is_generated = 'ALWAYS'`,
  );
  const genSet = new Set(gen.map((r) => `${r.table_name}.${r.column_name}`));
  assert.ok(genSet.has('round_result.passed_individual_threshold'), 'passed_individual_threshold must be generated');

  const triggers = await q(
    `SELECT DISTINCT trigger_name AS trigger_name FROM information_schema.triggers
     WHERE trigger_schema = current_schema()`,
  );
  const tgnames = triggers.map((r) => r.trigger_name).sort();
  assert.deepEqual(tgnames, ['audit_event_no_delete', 'audit_event_no_update'],
    'the only triggers are audit immutability (ADR-0012: partial unique, not triggers)');
});

test('roles: nobody is superuser, and seip_app cannot rewrite audit_event (ADR-0012 §4)', async () => {
  const roles = await q(
    `SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname IN ('seip_migrator', 'seip_app')`,
  );
  assert.equal(roles.length, 2, 'run scripts/db/bootstrap-roles.sql first');
  for (const r of roles) {
    assert.equal(r.rolsuper, false, `${r.rolname} must not be superuser`);
    assert.equal(r.rolbypassrls, false, `${r.rolname} must not bypass RLS`);
  }
  const [own] = await q(`SELECT tableowner FROM pg_tables WHERE schemaname = current_schema() AND tablename = 'audit_event'`);
  assert.equal(own.tableowner, 'seip_migrator', 'tables are owned by the migrator, never the app');
  const [p] = await q(
    `SELECT has_table_privilege('seip_app', 'audit_event', 'INSERT') AS ins,
            has_table_privilege('seip_app', 'audit_event', 'UPDATE') AS upd,
            has_table_privilege('seip_app', 'audit_event', 'DELETE') AS del,
            has_table_privilege('seip_app', 'audit_event', 'TRUNCATE') AS trn`,
  );
  assert.deepEqual(p, { ins: true, upd: false, del: false, trn: false });
});
