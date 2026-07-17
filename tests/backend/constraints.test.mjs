// SEIP-DB-001 constraint tests — prove the database enforces the ว9/ว10 rules,
// not just that the app intends to. Uses node:test + pg against the dev database
// (docker-compose). These are the tests the "migration validation" gate will run.
//
// Each test asserts a WRITE THAT SHOULD FAIL actually fails at the DB layer, and a
// valid write succeeds. No ORM — raw SQL so we test the constraint, not Prisma.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

const url = process.env.DATABASE_URL
  ?? 'postgresql://seip:seip_dev_only@localhost:5433/seip?schema=public';
const client = new pg.Client({ connectionString: url });

// Expect a query to be rejected by the DB. A failed statement aborts the whole
// transaction (Postgres 25P02), so wrap each attempt in a SAVEPOINT and roll back
// to it — the surrounding test transaction stays usable for the valid-case insert.
async function rejects(sql, params, label) {
  await client.query('SAVEPOINT s');
  let threw = false;
  try {
    await client.query(sql, params);
  } catch (e) {
    threw = true;
    // 23xxx integrity, 0A000 feature-not-supported, 2Fxxx/P0001 raised, 428C9 generated-column write
    assert.match(e.code, /^(23|0A|2F|P0|428C9)/, `${label}: unexpected error ${e.code} ${e.message}`);
    await client.query('ROLLBACK TO SAVEPOINT s');
  }
  assert.ok(threw, `${label}: expected the write to be rejected, but it succeeded`);
  await client.query('RELEASE SAVEPOINT s');
}

async function rollback() {
  await client.query('ROLLBACK');
}

before(async () => {
  await client.connect();
});
after(async () => {
  await client.end();
});

test('rubric_level must be 1..4 (framework scoring model)', async (t) => {
  await client.query('BEGIN');
  t.after(rollback);
  const fwId = (await client.query(
    `INSERT INTO framework_version (id, code, role_family, legal_ref, revision_year, status, effective_from)
     VALUES (gen_random_uuid(), 't1-fw', 'teacher', 'ว9', 2564, 'active', '2021-05-20') RETURNING id`)).rows[0].id;
  const dId = (await client.query(
    `INSERT INTO evaluation_domain (id, framework_version_id, code, name_th, sort_order, part)
     VALUES (gen_random_uuid(), $1, 'D1', 'ด้าน1', 1, 'standards') RETURNING id`, [fwId])).rows[0].id;
  const iId = (await client.query(
    `INSERT INTO indicator (id, domain_id, framework_version_id, code, name_th, sort_order, is_scored, indicator_kind)
     VALUES (gen_random_uuid(), $1, $2, 'T-1.1', 'x', 1, true, 'standard') RETURNING id`, [dId, fwId])).rows[0].id;
  await client.query(
    `INSERT INTO rank_level (code, role_family, label_th, sort_order) VALUES ('kru','teacher','ครู',2)
     ON CONFLICT (code) DO NOTHING`);

  await rejects(
    `INSERT INTO indicator_level_description (id, indicator_id, rank_level_code, rubric_level, expected_practice_th)
     VALUES (gen_random_uuid(), $1, 'kru', 5, 'x')`, [iId], 'rubric_level 5 must be rejected');
  await client.query(
    `INSERT INTO indicator_level_description (id, indicator_id, rank_level_code, rubric_level, expected_practice_th)
     VALUES (gen_random_uuid(), $1, 'kru', 4, 'x')`, [iId]); // 4 is valid
});

test('workload_gate indicator cannot be is_scored=true', async (t) => {
  await client.query('BEGIN');
  t.after(rollback);
  const fwId = (await client.query(
    `INSERT INTO framework_version (id, code, role_family, legal_ref, revision_year, status, effective_from)
     VALUES (gen_random_uuid(), 't2-fw', 'teacher', 'ว9', 2564, 'active', '2021-05-20') RETURNING id`)).rows[0].id;
  const dId = (await client.query(
    `INSERT INTO evaluation_domain (id, framework_version_id, code, name_th, sort_order, part)
     VALUES (gen_random_uuid(), $1, 'D1', 'ด้าน1', 1, 'standards') RETURNING id`, [fwId])).rows[0].id;
  await rejects(
    `INSERT INTO indicator (id, domain_id, framework_version_id, code, name_th, sort_order, is_scored, indicator_kind)
     VALUES (gen_random_uuid(), $1, $2, 'GATE', 'ภาระงาน', 9, true, 'workload_gate')`, [dId, fwId],
    'workload_gate with is_scored=true must be rejected');
});

test('membership scope must match the id that is set (tenancy)', async (t) => {
  await client.query('BEGIN');
  t.after(rollback);
  const uId = (await client.query(
    `INSERT INTO user_account (id, email, display_name, status) VALUES (gen_random_uuid(), 'a@x.io', 'A', 'active') RETURNING id`)).rows[0].id;
  // scope=school but no school_id → reject
  await rejects(
    `INSERT INTO school_membership (id, user_id, role, membership_scope, effective_from)
     VALUES (gen_random_uuid(), $1, 'teacher', 'school', '2026-01-01')`, [uId],
    'school scope without school_id must be rejected');
});

test('email must be lowercase', async (t) => {
  await client.query('BEGIN');
  t.after(rollback);
  await rejects(
    `INSERT INTO user_account (id, email, display_name, status) VALUES (gen_random_uuid(), 'MixedCase@x.io', 'A', 'active')`, [],
    'uppercase email must be rejected');
});

test('only one ACTIVE mapping per (evidence, indicator, cycle); revoked frees the slot', async (t) => {
  await client.query('BEGIN');
  t.after(rollback);
  const sId = (await client.query(`INSERT INTO school (id, code, name) VALUES (gen_random_uuid(),'S1','s') RETURNING id`)).rows[0].id;
  const uId = (await client.query(`INSERT INTO user_account (id, email, display_name, status) VALUES (gen_random_uuid(),'m@x.io','M','active') RETURNING id`)).rows[0].id;
  await client.query(`INSERT INTO rank_level (code, role_family, label_th, sort_order) VALUES ('kru2','teacher','ครู',2) ON CONFLICT (code) DO NOTHING`);
  const pId = (await client.query(`INSERT INTO personnel_profile (id, school_id, user_id, full_name, position_role, rank_level_code) VALUES (gen_random_uuid(),$1,$2,'p','teacher','kru2') RETURNING id`, [sId, uId])).rows[0].id;
  const cId = (await client.query(`INSERT INTO evidence_category (id, code, label_th, allowed_mime_types) VALUES (gen_random_uuid(),'pdf-t5','เอกสาร', ARRAY['application/pdf']) RETURNING id`)).rows[0].id;
  const eId = (await client.query(`INSERT INTO evidence (id, school_id, owner_personnel_id, uploaded_by_user_id, category_id, title, status) VALUES (gen_random_uuid(),$1,$2,$3,$4,'t','active') RETURNING id`, [sId, pId, uId, cId])).rows[0].id;
  const fwId = (await client.query(`INSERT INTO framework_version (id, code, role_family, legal_ref, revision_year, status, effective_from) VALUES (gen_random_uuid(),'t5-fw','teacher','ว9',2564,'active','2021-05-20') RETURNING id`)).rows[0].id;
  const dId = (await client.query(`INSERT INTO evaluation_domain (id, framework_version_id, code, name_th, sort_order, part) VALUES (gen_random_uuid(),$1,'D1','d',1,'standards') RETURNING id`, [fwId])).rows[0].id;
  const iId = (await client.query(`INSERT INTO indicator (id, domain_id, framework_version_id, code, name_th, sort_order, is_scored, indicator_kind) VALUES (gen_random_uuid(),$1,$2,'T-1.1','x',1,true,'standard') RETURNING id`, [dId, fwId])).rows[0].id;

  const mk = (status) => client.query(
    `INSERT INTO evidence_indicator_mapping (id, school_id, evidence_id, indicator_id, mapping_source, status, mapped_by_user_id)
     VALUES (gen_random_uuid(), $1, $2, $3, 'human', $4, $5)`, [sId, eId, iId, status, uId]);

  await mk('suggested');
  await rejects(`INSERT INTO evidence_indicator_mapping (id, school_id, evidence_id, indicator_id, mapping_source, status, mapped_by_user_id) VALUES (gen_random_uuid(),$1,$2,$3,'human','confirmed',$4)`, [sId, eId, iId, uId],
    'a second active (confirmed) mapping to the same indicator must be rejected');
  await client.query(`UPDATE evidence_indicator_mapping SET status='revoked' WHERE evidence_id=$1`, [eId]);
  await mk('suggested');
});

test('confirmed mapping requires confirmed_by + confirmed_at', async (t) => {
  await client.query('BEGIN');
  t.after(rollback);
  const sId = (await client.query(`INSERT INTO school (id, code, name) VALUES (gen_random_uuid(),'S-conf','s') RETURNING id`)).rows[0].id;
  const uId = (await client.query(`INSERT INTO user_account (id, email, display_name, status) VALUES (gen_random_uuid(),'conf@x.io','C','active') RETURNING id`)).rows[0].id;
  await client.query(`INSERT INTO rank_level (code, role_family, label_th, sort_order) VALUES ('kru-conf','teacher','ครู',2) ON CONFLICT (code) DO NOTHING`);
  const pId = (await client.query(`INSERT INTO personnel_profile (id, school_id, user_id, full_name, position_role, rank_level_code) VALUES (gen_random_uuid(),$1,$2,'p','teacher','kru-conf') RETURNING id`, [sId, uId])).rows[0].id;
  const cId = (await client.query(`INSERT INTO evidence_category (id, code, label_th, allowed_mime_types) VALUES (gen_random_uuid(),'pdf-conf','เอกสาร', ARRAY['application/pdf']) RETURNING id`)).rows[0].id;
  const eId = (await client.query(`INSERT INTO evidence (id, school_id, owner_personnel_id, uploaded_by_user_id, category_id, title, status) VALUES (gen_random_uuid(),$1,$2,$3,$4,'t','active') RETURNING id`, [sId, pId, uId, cId])).rows[0].id;
  const fwId = (await client.query(`INSERT INTO framework_version (id, code, role_family, legal_ref, revision_year, status, effective_from) VALUES (gen_random_uuid(),'t-conf-fw','teacher','ว9',2564,'active','2021-05-20') RETURNING id`)).rows[0].id;
  const dId = (await client.query(`INSERT INTO evaluation_domain (id, framework_version_id, code, name_th, sort_order, part) VALUES (gen_random_uuid(),$1,'D1','d',1,'standards') RETURNING id`, [fwId])).rows[0].id;
  const iId = (await client.query(`INSERT INTO indicator (id, domain_id, framework_version_id, code, name_th, sort_order, is_scored, indicator_kind) VALUES (gen_random_uuid(),$1,$2,'T-1.1','x',1,true,'standard') RETURNING id`, [dId, fwId])).rows[0].id;

  await rejects(
    `INSERT INTO evidence_indicator_mapping (id, school_id, evidence_id, indicator_id, mapping_source, status, mapped_by_user_id)
     VALUES (gen_random_uuid(), $1, $2, $3, 'human', 'confirmed', $4)`,
    [sId, eId, iId, uId],
    'confirmed without actor/timestamp must be rejected',
  );

  await client.query(
    `INSERT INTO evidence_indicator_mapping
       (id, school_id, evidence_id, indicator_id, mapping_source, status, mapped_by_user_id, confirmed_by_user_id, confirmed_at)
     VALUES (gen_random_uuid(), $1, $2, $3, 'human', 'confirmed', $4, $4, now())`,
    [sId, eId, iId, uId],
  );
});

test('passed_individual_threshold is generated (>=70) and cannot be written', async (t) => {
  await client.query('BEGIN');
  t.after(rollback);
  const sId = (await client.query(`INSERT INTO school (id, code, name) VALUES (gen_random_uuid(),'S2','s') RETURNING id`)).rows[0].id;
  const uId = (await client.query(`INSERT INTO user_account (id, email, display_name, status) VALUES (gen_random_uuid(),'ev@x.io','E','active') RETURNING id`)).rows[0].id;
  await client.query(`INSERT INTO rank_level (code, role_family, label_th, sort_order) VALUES ('kru3','teacher','ครู',2) ON CONFLICT (code) DO NOTHING`);
  const pId = (await client.query(`INSERT INTO personnel_profile (id, school_id, user_id, full_name, position_role, rank_level_code) VALUES (gen_random_uuid(),$1,$2,'p','teacher','kru3') RETURNING id`, [sId, uId])).rows[0].id;
  const fwId = (await client.query(`INSERT INTO framework_version (id, code, role_family, legal_ref, revision_year, status, effective_from) VALUES (gen_random_uuid(),'t6-fw','teacher','ว9',2564,'active','2021-05-20') RETURNING id`)).rows[0].id;
  const cyId = (await client.query(`INSERT INTO evaluation_cycle (id, school_id, framework_version_id, fiscal_year, evaluation_kind, title, status, starts_on, ends_on) VALUES (gen_random_uuid(),$1,$2,2569,'pa','c','open','2025-10-01','2026-09-30') RETURNING id`, [sId, fwId])).rows[0].id;
  const rId = (await client.query(`INSERT INTO evaluation_round (id, cycle_id, round_number, purpose, period_start, period_end, status) VALUES (gen_random_uuid(),$1,1,'formal','2025-10-01','2026-09-30','scoring') RETURNING id`, [cyId])).rows[0].id;
  const aId = (await client.query(`INSERT INTO evaluation_assignment (id, school_id, round_id, evaluatee_personnel_id, status) VALUES (gen_random_uuid(),$1,$2,$3,'in_progress') RETURNING id`, [sId, rId, pId])).rows[0].id;

  await rejects(
    `INSERT INTO round_result (id, assignment_id, evaluator_user_id, part1_percent, part2_percent, total_percent, passed_workload_gate, passed_individual_threshold)
     VALUES (gen_random_uuid(), $1, $2, 50, 20, 68, true, true)`, [aId, uId],
    'writing the generated column must be rejected');

  await client.query(
    `INSERT INTO round_result (id, assignment_id, evaluator_user_id, part1_percent, part2_percent, total_percent, passed_workload_gate)
     VALUES (gen_random_uuid(), $1, $2, 48, 20, 68, true)`, [aId, uId]);
  const r = await client.query(`SELECT passed_individual_threshold FROM round_result WHERE assignment_id=$1`, [aId]);
  assert.equal(r.rows[0].passed_individual_threshold, false, '68% must derive to NOT passed');

  // 70% boundary → pass
  const u2 = (await client.query(`INSERT INTO user_account (id, email, display_name, status) VALUES (gen_random_uuid(),'ev2@x.io','E2','active') RETURNING id`)).rows[0].id;
  await client.query(
    `INSERT INTO round_result (id, assignment_id, evaluator_user_id, part1_percent, part2_percent, total_percent, passed_workload_gate)
     VALUES (gen_random_uuid(), $1, $2, 50, 20, 70, true)`, [aId, u2]);
  const r2 = await client.query(`SELECT passed_individual_threshold FROM round_result WHERE assignment_id=$1 AND evaluator_user_id=$2`, [aId, u2]);
  assert.equal(r2.rows[0].passed_individual_threshold, true, '70% must derive to passed');
});

test('audit_event is append-only: UPDATE and DELETE are blocked', async (t) => {
  await client.query('BEGIN');
  t.after(rollback);
  const id = (await client.query(
    `INSERT INTO audit_event (id, action, entity_type, entity_id) VALUES (gen_random_uuid(), 'created', 'evidence', gen_random_uuid()) RETURNING id`)).rows[0].id;
  await rejects(`UPDATE audit_event SET action='tampered' WHERE id=$1`, [id], 'UPDATE on audit_event must be blocked');
  await rejects(`DELETE FROM audit_event WHERE id=$1`, [id], 'DELETE on audit_event must be blocked');
});

test('committee seat_number must be 1..3', async (t) => {
  await client.query('BEGIN');
  t.after(rollback);
  const sId = (await client.query(`INSERT INTO school (id, code, name) VALUES (gen_random_uuid(),'S3','s') RETURNING id`)).rows[0].id;
  const uId = (await client.query(`INSERT INTO user_account (id, email, display_name, status) VALUES (gen_random_uuid(),'seat@x.io','S','active') RETURNING id`)).rows[0].id;
  await client.query(`INSERT INTO rank_level (code, role_family, label_th, sort_order) VALUES ('kru4','teacher','ครู',2) ON CONFLICT (code) DO NOTHING`);
  const pId = (await client.query(`INSERT INTO personnel_profile (id, school_id, user_id, full_name, position_role, rank_level_code) VALUES (gen_random_uuid(),$1,$2,'p','teacher','kru4') RETURNING id`, [sId, uId])).rows[0].id;
  const fwId = (await client.query(`INSERT INTO framework_version (id, code, role_family, legal_ref, revision_year, status, effective_from) VALUES (gen_random_uuid(),'t7-fw','teacher','ว9',2564,'active','2021-05-20') RETURNING id`)).rows[0].id;
  const cyId = (await client.query(`INSERT INTO evaluation_cycle (id, school_id, framework_version_id, fiscal_year, evaluation_kind, title, status, starts_on, ends_on) VALUES (gen_random_uuid(),$1,$2,2569,'pa','c','open','2025-10-01','2026-09-30') RETURNING id`, [sId, fwId])).rows[0].id;
  const rId = (await client.query(`INSERT INTO evaluation_round (id, cycle_id, round_number, purpose, period_start, period_end, status) VALUES (gen_random_uuid(),$1,1,'formal','2025-10-01','2026-09-30','open') RETURNING id`, [cyId])).rows[0].id;
  const aId = (await client.query(`INSERT INTO evaluation_assignment (id, school_id, round_id, evaluatee_personnel_id, status) VALUES (gen_random_uuid(),$1,$2,$3,'pending') RETURNING id`, [sId, rId, pId])).rows[0].id;

  await rejects(
    `INSERT INTO committee_member (id, assignment_id, evaluator_user_id, committee_role, seat_number)
     VALUES (gen_random_uuid(), $1, $2, 'chair', 4)`, [aId, uId],
    'seat 4 must be rejected');
  await client.query(
    `INSERT INTO committee_member (id, assignment_id, evaluator_user_id, committee_role, seat_number)
     VALUES (gen_random_uuid(), $1, $2, 'chair', 1)`, [aId, uId]);
});

test('rounds are configurable 1..n per cycle (no hard-coded max of 2)', async (t) => {
  await client.query('BEGIN');
  t.after(rollback);
  const sId = (await client.query(`INSERT INTO school (id, code, name) VALUES (gen_random_uuid(),'S4','s') RETURNING id`)).rows[0].id;
  const fwId = (await client.query(`INSERT INTO framework_version (id, code, role_family, legal_ref, revision_year, status, effective_from) VALUES (gen_random_uuid(),'t8-fw','teacher','ว9',2564,'active','2021-05-20') RETURNING id`)).rows[0].id;
  const cyId = (await client.query(`INSERT INTO evaluation_cycle (id, school_id, framework_version_id, fiscal_year, evaluation_kind, title, status, starts_on, ends_on) VALUES (gen_random_uuid(),$1,$2,2570,'pa','c','open','2026-10-01','2027-09-30') RETURNING id`, [sId, fwId])).rows[0].id;

  await rejects(
    `INSERT INTO evaluation_round (id, cycle_id, round_number, purpose, period_start, period_end, status)
     VALUES (gen_random_uuid(), $1, 0, 'bad', '2026-10-01', '2026-12-31', 'planned')`, [cyId],
    'round_number 0 must be rejected');

  // Three rounds in one cycle must succeed (acceptance: configurable 1..n, not hard-coded to 2).
  for (const n of [1, 2, 3]) {
    await client.query(
      `INSERT INTO evaluation_round (id, cycle_id, round_number, purpose, period_start, period_end, status)
       VALUES (gen_random_uuid(), $1, $2, $3, '2026-10-01', '2027-09-30', 'planned')`,
      [cyId, n, `round-${n}`],
    );
  }
  const count = await client.query(`SELECT count(*)::int AS c FROM evaluation_round WHERE cycle_id=$1`, [cyId]);
  assert.equal(count.rows[0].c, 3);
});

test('PA cycle unique per (school, fiscal_year, framework); DPA may repeat', async (t) => {
  await client.query('BEGIN');
  t.after(rollback);
  const sId = (await client.query(`INSERT INTO school (id, code, name) VALUES (gen_random_uuid(),'S5','s') RETURNING id`)).rows[0].id;
  const fwId = (await client.query(`INSERT INTO framework_version (id, code, role_family, legal_ref, revision_year, status, effective_from) VALUES (gen_random_uuid(),'t9-fw','teacher','ว9',2564,'active','2021-05-20') RETURNING id`)).rows[0].id;

  await client.query(
    `INSERT INTO evaluation_cycle (id, school_id, framework_version_id, fiscal_year, evaluation_kind, title, status, starts_on, ends_on)
     VALUES (gen_random_uuid(), $1, $2, 2571, 'pa', 'PA1', 'open', '2027-10-01', '2028-09-30')`,
    [sId, fwId],
  );
  await rejects(
    `INSERT INTO evaluation_cycle (id, school_id, framework_version_id, fiscal_year, evaluation_kind, title, status, starts_on, ends_on)
     VALUES (gen_random_uuid(), $1, $2, 2571, 'pa', 'PA-dup', 'open', '2027-10-01', '2028-09-30')`,
    [sId, fwId],
    'duplicate PA cycle must be rejected',
  );

  // DPA on-demand may appear more than once for the same school/year/framework.
  await client.query(
    `INSERT INTO evaluation_cycle (id, school_id, framework_version_id, fiscal_year, evaluation_kind, title, status, starts_on, ends_on)
     VALUES (gen_random_uuid(), $1, $2, 2571, 'dpa', 'DPA-1', 'open', '2027-10-01', '2028-09-30')`,
    [sId, fwId],
  );
  await client.query(
    `INSERT INTO evaluation_cycle (id, school_id, framework_version_id, fiscal_year, evaluation_kind, title, status, starts_on, ends_on)
     VALUES (gen_random_uuid(), $1, $2, 2571, 'dpa', 'DPA-2', 'open', '2027-10-01', '2028-09-30')`,
    [sId, fwId],
  );
});

test('standard and challenge scores share indicator_score (ChallengeScore merge)', async (t) => {
  await client.query('BEGIN');
  t.after(rollback);
  const sId = (await client.query(`INSERT INTO school (id, code, name) VALUES (gen_random_uuid(),'S6','s') RETURNING id`)).rows[0].id;
  const uId = (await client.query(`INSERT INTO user_account (id, email, display_name, status) VALUES (gen_random_uuid(),'sc@x.io','SC','active') RETURNING id`)).rows[0].id;
  await client.query(`INSERT INTO rank_level (code, role_family, label_th, sort_order) VALUES ('kru5','teacher','ครู',2) ON CONFLICT (code) DO NOTHING`);
  const pId = (await client.query(`INSERT INTO personnel_profile (id, school_id, user_id, full_name, position_role, rank_level_code) VALUES (gen_random_uuid(),$1,$2,'p','teacher','kru5') RETURNING id`, [sId, uId])).rows[0].id;
  const fwId = (await client.query(`INSERT INTO framework_version (id, code, role_family, legal_ref, revision_year, status, effective_from) VALUES (gen_random_uuid(),'t10-fw','teacher','ว9',2564,'active','2021-05-20') RETURNING id`)).rows[0].id;
  const dStd = (await client.query(`INSERT INTO evaluation_domain (id, framework_version_id, code, name_th, sort_order, part) VALUES (gen_random_uuid(),$1,'D1','d',1,'standards') RETURNING id`, [fwId])).rows[0].id;
  const dCh = (await client.query(`INSERT INTO evaluation_domain (id, framework_version_id, code, name_th, sort_order, part) VALUES (gen_random_uuid(),$1,'C','c',2,'challenge') RETURNING id`, [fwId])).rows[0].id;
  const iStd = (await client.query(`INSERT INTO indicator (id, domain_id, framework_version_id, code, name_th, sort_order, is_scored, indicator_kind) VALUES (gen_random_uuid(),$1,$2,'T-1.1','s',1,true,'standard') RETURNING id`, [dStd, fwId])).rows[0].id;
  const iCh = (await client.query(`INSERT INTO indicator (id, domain_id, framework_version_id, code, name_th, sort_order, is_scored, indicator_kind, max_points) VALUES (gen_random_uuid(),$1,$2,'T-C.1','c',1,true,'challenge',20) RETURNING id`, [dCh, fwId])).rows[0].id;
  const cyId = (await client.query(`INSERT INTO evaluation_cycle (id, school_id, framework_version_id, fiscal_year, evaluation_kind, title, status, starts_on, ends_on) VALUES (gen_random_uuid(),$1,$2,2572,'pa','c','open','2028-10-01','2029-09-30') RETURNING id`, [sId, fwId])).rows[0].id;
  const rId = (await client.query(`INSERT INTO evaluation_round (id, cycle_id, round_number, purpose, period_start, period_end, status) VALUES (gen_random_uuid(),$1,1,'formal','2028-10-01','2029-09-30','scoring') RETURNING id`, [cyId])).rows[0].id;
  const aId = (await client.query(`INSERT INTO evaluation_assignment (id, school_id, round_id, evaluatee_personnel_id, status) VALUES (gen_random_uuid(),$1,$2,$3,'in_progress') RETURNING id`, [sId, rId, pId])).rows[0].id;

  // No separate challenge_score table — both kinds write indicator_score.
  const tables = await client.query(
    `SELECT to_regclass('public.challenge_score') AS challenge_score, to_regclass('public.indicator_score') AS indicator_score`,
  );
  assert.equal(tables.rows[0].challenge_score, null, 'challenge_score table must not exist (merged)');
  assert.ok(tables.rows[0].indicator_score, 'indicator_score table must exist');

  await client.query(
    `INSERT INTO indicator_score (id, assignment_id, indicator_id, evaluator_user_id, rubric_level, points_awarded)
     VALUES (gen_random_uuid(), $1, $2, $3, 3, NULL)`, [aId, iStd, uId]);
  await client.query(
    `INSERT INTO indicator_score (id, assignment_id, indicator_id, evaluator_user_id, rubric_level, points_awarded)
     VALUES (gen_random_uuid(), $1, $2, $3, 4, 20)`, [aId, iCh, uId]);

  const n = await client.query(`SELECT count(*)::int AS c FROM indicator_score WHERE assignment_id=$1`, [aId]);
  assert.equal(n.rows[0].c, 2);
});

test('evidence_file is metadata-only columns (no bytea payload)', async (t) => {
  await client.query('BEGIN');
  t.after(rollback);
  const cols = await client.query(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema='public' AND table_name='evidence_file'
     ORDER BY ordinal_position`,
  );
  const names = cols.rows.map((r) => r.column_name);
  assert.ok(names.includes('storage_uri'));
  assert.ok(names.includes('storage_provider'));
  assert.ok(names.includes('checksum_sha256'));
  assert.ok(!names.includes('bytes'), 'must not store file bytes in Postgres (ADR-0005 / SEC-UPL-1)');
  assert.ok(!cols.rows.some((r) => r.data_type === 'bytea'), 'no bytea column on evidence_file');
});
