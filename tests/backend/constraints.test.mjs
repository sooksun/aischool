// SEIP-DB-001 constraint tests — prove the database enforces the ว9/ว10 rules,
// not just that the app intends to. Uses node:test + pg against the dev database
// (docker-compose). These are the tests the "migration validation" gate will run.
//
// Each test asserts a WRITE THAT SHOULD FAIL actually fails at the DB layer, and a
// valid write succeeds. No ORM — raw SQL so we test the constraint, not Prisma.
import { test, before, after, beforeEach } from 'node:test';
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

let fw, teacherRank, domain, stdIndicator, gateDomain;

before(async () => {
  await client.connect();
});
after(async () => {
  await client.end();
});

// Fresh reference rows per test group; wrapped so a failing test can't poison the next.
beforeEach(async () => {
  await client.query('BEGIN');
});
async function rollback() { await client.query('ROLLBACK'); }

test('rubric_level must be 1..4 (framework scoring model)', async (t) => {
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
    `INSERT INTO rank_level (code, role_family, label_th, sort_order) VALUES ('kru','teacher','ครู',2)`);

  await rejects(
    `INSERT INTO indicator_level_description (id, indicator_id, rank_level_code, rubric_level, expected_practice_th)
     VALUES (gen_random_uuid(), $1, 'kru', 5, 'x')`, [iId], 'rubric_level 5 must be rejected');
  await client.query(
    `INSERT INTO indicator_level_description (id, indicator_id, rank_level_code, rubric_level, expected_practice_th)
     VALUES (gen_random_uuid(), $1, 'kru', 4, 'x')`, [iId]); // 4 is valid
});

test('workload_gate indicator cannot be is_scored=true', async (t) => {
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
  t.after(rollback);
  await rejects(
    `INSERT INTO user_account (id, email, display_name, status) VALUES (gen_random_uuid(), 'MixedCase@x.io', 'A', 'active')`, [],
    'uppercase email must be rejected');
});

test('only one ACTIVE mapping per (evidence, indicator, cycle); revoked frees the slot', async (t) => {
  t.after(rollback);
  // minimal graph: school, personnel(user), category, evidence, framework/domain/indicator
  const sId = (await client.query(`INSERT INTO school (id, code, name) VALUES (gen_random_uuid(),'S1','s') RETURNING id`)).rows[0].id;
  const uId = (await client.query(`INSERT INTO user_account (id, email, display_name, status) VALUES (gen_random_uuid(),'m@x.io','M','active') RETURNING id`)).rows[0].id;
  await client.query(`INSERT INTO rank_level (code, role_family, label_th, sort_order) VALUES ('kru2','teacher','ครู',2)`);
  const pId = (await client.query(`INSERT INTO personnel_profile (id, school_id, user_id, full_name, position_role, rank_level_code) VALUES (gen_random_uuid(),$1,$2,'p','teacher','kru2') RETURNING id`, [sId, uId])).rows[0].id;
  const cId = (await client.query(`INSERT INTO evidence_category (id, code, label_th, allowed_mime_types) VALUES (gen_random_uuid(),'pdf','เอกสาร', ARRAY['application/pdf']) RETURNING id`)).rows[0].id;
  const eId = (await client.query(`INSERT INTO evidence (id, school_id, owner_personnel_id, uploaded_by_user_id, category_id, title, status) VALUES (gen_random_uuid(),$1,$2,$3,$4,'t','active') RETURNING id`, [sId, pId, uId, cId])).rows[0].id;
  const fwId = (await client.query(`INSERT INTO framework_version (id, code, role_family, legal_ref, revision_year, status, effective_from) VALUES (gen_random_uuid(),'t5-fw','teacher','ว9',2564,'active','2021-05-20') RETURNING id`)).rows[0].id;
  const dId = (await client.query(`INSERT INTO evaluation_domain (id, framework_version_id, code, name_th, sort_order, part) VALUES (gen_random_uuid(),$1,'D1','d',1,'standards') RETURNING id`, [fwId])).rows[0].id;
  const iId = (await client.query(`INSERT INTO indicator (id, domain_id, framework_version_id, code, name_th, sort_order, is_scored, indicator_kind) VALUES (gen_random_uuid(),$1,$2,'T-1.1','x',1,true,'standard') RETURNING id`, [dId, fwId])).rows[0].id;

  const mk = (status) => client.query(
    `INSERT INTO evidence_indicator_mapping (id, school_id, evidence_id, indicator_id, mapping_source, status, mapped_by_user_id)
     VALUES (gen_random_uuid(), $1, $2, $3, 'human', $4, $5)`, [sId, eId, iId, status, uId]);

  await mk('suggested');                                   // first active mapping OK
  await rejects(`INSERT INTO evidence_indicator_mapping (id, school_id, evidence_id, indicator_id, mapping_source, status, mapped_by_user_id) VALUES (gen_random_uuid(),$1,$2,$3,'human','confirmed',$4)`, [sId, eId, iId, uId],
    'a second active (confirmed) mapping to the same indicator must be rejected');
  await client.query(`UPDATE evidence_indicator_mapping SET status='revoked' WHERE evidence_id=$1`, [eId]);
  await mk('suggested');                                   // slot freed after revoke → OK
});

test('passed_individual_threshold is generated (>=70) and cannot be written', async (t) => {
  t.after(rollback);
  // build enough graph for an assignment + result
  const sId = (await client.query(`INSERT INTO school (id, code, name) VALUES (gen_random_uuid(),'S2','s') RETURNING id`)).rows[0].id;
  const uId = (await client.query(`INSERT INTO user_account (id, email, display_name, status) VALUES (gen_random_uuid(),'ev@x.io','E','active') RETURNING id`)).rows[0].id;
  await client.query(`INSERT INTO rank_level (code, role_family, label_th, sort_order) VALUES ('kru3','teacher','ครู',2)`);
  const pId = (await client.query(`INSERT INTO personnel_profile (id, school_id, user_id, full_name, position_role, rank_level_code) VALUES (gen_random_uuid(),$1,$2,'p','teacher','kru3') RETURNING id`, [sId, uId])).rows[0].id;
  const fwId = (await client.query(`INSERT INTO framework_version (id, code, role_family, legal_ref, revision_year, status, effective_from) VALUES (gen_random_uuid(),'t6-fw','teacher','ว9',2564,'active','2021-05-20') RETURNING id`)).rows[0].id;
  const cyId = (await client.query(`INSERT INTO evaluation_cycle (id, school_id, framework_version_id, fiscal_year, evaluation_kind, title, status, starts_on, ends_on) VALUES (gen_random_uuid(),$1,$2,2569,'pa','c','open','2025-10-01','2026-09-30') RETURNING id`, [sId, fwId])).rows[0].id;
  const rId = (await client.query(`INSERT INTO evaluation_round (id, cycle_id, round_number, purpose, period_start, period_end, status) VALUES (gen_random_uuid(),$1,1,'formal','2025-10-01','2026-09-30','scoring') RETURNING id`, [cyId])).rows[0].id;
  const aId = (await client.query(`INSERT INTO evaluation_assignment (id, school_id, round_id, evaluatee_personnel_id, status) VALUES (gen_random_uuid(),$1,$2,$3,'in_progress') RETURNING id`, [sId, rId, pId])).rows[0].id;

  // cannot INSERT into a generated column
  await rejects(
    `INSERT INTO round_result (id, assignment_id, evaluator_user_id, part1_percent, part2_percent, total_percent, passed_workload_gate, passed_individual_threshold)
     VALUES (gen_random_uuid(), $1, $2, 50, 20, 68, true, true)`, [aId, uId],
    'writing the generated column must be rejected');

  // valid insert: 68% → generated flag must be false
  await client.query(
    `INSERT INTO round_result (id, assignment_id, evaluator_user_id, part1_percent, part2_percent, total_percent, passed_workload_gate)
     VALUES (gen_random_uuid(), $1, $2, 48, 20, 68, true)`, [aId, uId]);
  const r = await client.query(`SELECT passed_individual_threshold FROM round_result WHERE assignment_id=$1`, [aId]);
  assert.equal(r.rows[0].passed_individual_threshold, false, '68% must derive to NOT passed');
});

test('audit_event is append-only: UPDATE and DELETE are blocked', async (t) => {
  t.after(rollback);
  const id = (await client.query(
    `INSERT INTO audit_event (id, action, entity_type, entity_id) VALUES (gen_random_uuid(), 'created', 'evidence', gen_random_uuid()) RETURNING id`)).rows[0].id;
  await rejects(`UPDATE audit_event SET action='tampered' WHERE id=$1`, [id], 'UPDATE on audit_event must be blocked');
  await rejects(`DELETE FROM audit_event WHERE id=$1`, [id], 'DELETE on audit_event must be blocked');
});
