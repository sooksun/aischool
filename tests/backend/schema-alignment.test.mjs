// SEIP-DB-001 — schema vs entity-dictionary checklist.
// Asserts the tables that implement the dictionary exist (and ChallengeScore is merged).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

const url = process.env.DATABASE_URL
  ?? 'postgresql://seip:seip_dev_only@localhost:5433/seip?schema=public';
const client = new pg.Client({ connectionString: url });

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
  const r = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
  );
  const have = new Set(r.rows.map((row) => row.table_name));
  for (const t of EXPECTED_TABLES) {
    assert.ok(have.has(t), `missing table ${t} from entity-dictionary`);
  }
});

test('ChallengeScore has no separate table (merged into indicator_score)', async () => {
  const r = await client.query(
    `SELECT to_regclass('public.challenge_score') AS reg`,
  );
  assert.equal(r.rows[0].reg, null);
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
    const r = await client.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name=$1 AND column_name='school_id'`,
      [table],
    );
    assert.equal(r.rowCount, 1, `${table} must have school_id for tenancy`);
  }
});

test('DB constraint objects from constraints migration are present', async () => {
  const checks = await client.query(
    `SELECT conname FROM pg_constraint
     WHERE contype = 'c'
       AND conrelid::regclass::text IN (
         'indicator_level_description','indicator_score','committee_member',
         'evaluation_round','evaluation_cycle','school_membership','user_account',
         'indicator','evidence_indicator_mapping','round_result'
       )`,
  );
  const names = new Set(checks.rows.map((r) => r.conname));
  for (const need of [
    'ild_rubric_level_range',
    'score_rubric_level_range',
    'committee_seat_range',
    'round_number_positive',
    'membership_scope_ids',
    'user_email_lowercase',
    'workload_gate_not_scored',
    'mapping_confirmed_has_actor',
  ]) {
    assert.ok(names.has(need), `missing CHECK constraint ${need}`);
  }

  const indexes = await client.query(
    `SELECT indexname FROM pg_indexes WHERE schemaname='public'`,
  );
  const idx = new Set(indexes.rows.map((r) => r.indexname));
  assert.ok(idx.has('evidence_indicator_mapping_active_uk'));
  assert.ok(idx.has('evaluation_cycle_pa_uk'));

  const triggers = await client.query(
    `SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgrelid = 'audit_event'::regclass`,
  );
  const tgnames = triggers.rows.map((r) => r.tgname);
  assert.ok(tgnames.includes('audit_event_no_update'));
  assert.ok(tgnames.includes('audit_event_no_delete'));
});
