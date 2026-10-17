// RLS backstop by สพท. (ADR-0019, migration 20261013000200_rls_backstop).
//
// P1 exit criterion: "RLS denies a cross-area read in raw SQL". Raw SQL as
// seip_app, inside the same switch packages/database withAreaScope makes:
// `SET LOCAL ROLE seip_scoped` plus the three transaction-local settings.
//
// Every test runs in one transaction that is rolled back. Each scoped block runs
// inside a SAVEPOINT, and rolling back to it also undoes SET LOCAL ROLE, so the
// fixture inserts around it run as seip_app again.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const url = process.env.DATABASE_URL
  ?? 'postgresql://seip_app:seip_app_dev@localhost:5432/seip';
const client = new pg.Client({ connectionString: url });
const uid = () => randomUUID();
const q = async (sql, params = []) => (await client.query(sql, params)).rows;

const TABLES = ['evidence', 'evidence_file', 'evidence_indicator_mapping', 'upload_session', 'personnel_profile'];

before(async () => { await client.connect(); });
after(async () => { await client.end(); });

const arr = (ids) => `{${ids.join(',')}}`;

/** Run `fn` as seip_scoped with the given scope; `null` leaves the settings unset. */
async function scoped(scope, fn) {
  await client.query('SAVEPOINT scoped');
  try {
    await client.query('SET LOCAL ROLE seip_scoped');
    if (scope) {
      await client.query(
        `SELECT set_config('seip.area_ids', $1, true), set_config('seip.school_ids', $2, true),
                set_config('seip.person_ids', $3, true)`,
        [arr(scope.areas ?? []), arr(scope.schools ?? []), arr(scope.persons ?? [])],
      );
    }
    return await fn();
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT scoped');
  }
}

/**
 * Two areas, a school in each and one with no area yet, a teacher at each, and
 * an evidence item per teacher. pA also owns `moved`: an item from their earlier
 * posting in area B, which follows them (ADR-0015).
 */
async function world() {
  const p = uid().slice(0, 8);
  const areaA = uid(); const areaB = uid();
  await q(`INSERT INTO area (id, code, name) VALUES ($1, $2, 'A'), ($3, $4, 'B')`, [areaA, `A-${p}`, areaB, `B-${p}`]);
  const sA = uid(); const sB = uid(); const sN = uid();
  await q(
    `INSERT INTO school (id, code, name, area_id) VALUES ($1, $2, 'sA', $3), ($4, $5, 'sB', $6), ($7, $8, 'sN', NULL)`,
    [sA, `sA-${p}`, areaA, sB, `sB-${p}`, areaB, sN, `sN-${p}`],
  );
  await q(`INSERT INTO rank_level (code, role_family, label_th, sort_order) VALUES ('rls_kru', 'teacher', 'ครู', 2) ON CONFLICT (code) DO NOTHING`);
  const cat = uid();
  await q(`INSERT INTO evidence_category (id, code, label_th, allowed_mime_types) VALUES ($1, $2, 'x', ARRAY['application/pdf'])`, [cat, `rls-${p}`]);

  const teacher = async (schoolId, tag) => {
    const userId = uid(); const personId = uid(); const profileId = uid();
    await q(`INSERT INTO person (id, display_name) VALUES ($1, $2)`, [personId, tag]);
    await q(`INSERT INTO user_account (id, email, display_name, status, person_id) VALUES ($1, $2, $3, 'active', $4)`,
      [userId, `${tag}-${p}@x.io`, tag, personId]);
    await q(`INSERT INTO personnel_profile (id, school_id, user_id, person_id, full_name, position_role, rank_level_code)
             VALUES ($1, $2, $3, $4, $5, 'teacher', 'rls_kru')`, [profileId, schoolId, userId, personId, tag]);
    return { userId, personId, profileId };
  };
  const tA = await teacher(sA, 'ta'); const tB = await teacher(sB, 'tb'); const tN = await teacher(sN, 'tn');

  const evidence = async (owner, areaId, schoolId) => {
    const id = uid();
    await q(`INSERT INTO evidence (id, owner_person_id, controller_area_id, origin_school_id, uploaded_by_user_id, category_id, title, status)
             VALUES ($1, $2, $3, $4, $5, $6, 't', 'active')`, [id, owner.personId, areaId, schoolId, owner.userId, cat]);
    const fileId = uid();
    await q(`INSERT INTO evidence_file (id, evidence_id, storage_uri, content_type, byte_size, checksum_sha256, original_filename)
             VALUES ($1, $2, 's3://x', 'application/pdf', 1, $3, 'f.pdf')`, [fileId, id, 'a'.repeat(64)]);
    return { id, fileId };
  };
  const eA = await evidence(tA, areaA, sA);
  const eB = await evidence(tB, areaB, sB);
  const eN = await evidence(tN, null, sN);
  const moved = await evidence(tA, areaB, sB);

  const fw = uid(); const dom = uid(); const ind = uid();
  await q(`INSERT INTO framework_version (id, code, role_family, legal_ref, revision_year, status, effective_from)
           VALUES ($1, $2, 'teacher', 'x', 2569, 'draft', NOW())`, [fw, `rls-fw-${p}`]);
  await q(`INSERT INTO evaluation_domain (id, framework_version_id, code, name_th, sort_order, part) VALUES ($1, $2, 'D1', 'd', 1, 'standards')`, [dom, fw]);
  await q(`INSERT INTO indicator (id, domain_id, framework_version_id, code, name_th, sort_order, is_scored, indicator_kind)
           VALUES ($1, $2, $3, 'I-1', 'i', 1, true, 'standard')`, [ind, dom, fw]);
  const mapB = uid();
  await q(`INSERT INTO evidence_indicator_mapping (id, school_id, evidence_id, indicator_id, framework_version_id, mapping_source, status, owner_confirmed_by_user_id)
           VALUES ($1, $2, $3, $4, $5, 'manual', 'owner_confirmed', $6)`, [mapB, sB, eB.id, ind, fw, tB.userId]);

  return { areaA, areaB, sA, sB, sN, tA, tB, tN, eA, eB, eN, moved, mapB };
}

const ids = (rows) => new Set(rows.map((r) => r.id));

test('scoped to area A: raw SQL sees area A and the caller\'s own portfolio, never area B', async (t) => {
  await client.query('BEGIN');
  t.after(() => client.query('ROLLBACK'));
  const w = await world();
  const allEvidence = [w.eA.id, w.eB.id, w.eN.id, w.moved.id];

  await scoped({ areas: [w.areaA], schools: [w.sA], persons: [w.tA.personId] }, async () => {
    // A deliberately unfiltered-by-tenant query: the WHERE only names the fixture rows.
    const seen = ids(await q(`SELECT id FROM evidence WHERE id = ANY($1::uuid[])`, [allEvidence]));
    assert.deepEqual(seen, new Set([w.eA.id, w.moved.id]), 'area A plus own item from area B; not B\'s or the no-area school\'s');

    const files = ids(await q(`SELECT id FROM evidence_file WHERE evidence_id = ANY($1::uuid[])`, [allEvidence]));
    assert.deepEqual(files, new Set([w.eA.fileId, w.moved.fileId]), 'files follow their evidence');

    const mappings = await q(`SELECT id FROM evidence_indicator_mapping WHERE id = $1`, [w.mapB]);
    assert.equal(mappings.length, 0, 'a mapping on area B evidence is hidden');

    const profiles = ids(await q(`SELECT id FROM personnel_profile WHERE id = ANY($1::uuid[])`,
      [[w.tA.profileId, w.tB.profileId, w.tN.profileId]]));
    assert.deepEqual(profiles, new Set([w.tA.profileId]));

    // A join does not route around it: the hidden side simply has no rows.
    const joined = await q(
      `SELECT e.id FROM evidence e JOIN evidence_file f ON f.evidence_id = e.id WHERE e.origin_school_id = $1`, [w.sB]);
    assert.deepEqual(ids(joined), new Set([w.moved.id]), 'only the caller\'s own item at school B');
  });
});

test('scoped to area B as a different teacher: area A is invisible', async (t) => {
  await client.query('BEGIN');
  t.after(() => client.query('ROLLBACK'));
  const w = await world();
  await scoped({ areas: [w.areaB], schools: [w.sB], persons: [w.tB.personId] }, async () => {
    const seen = ids(await q(`SELECT id FROM evidence WHERE id = ANY($1::uuid[])`, [[w.eA.id, w.eB.id, w.eN.id, w.moved.id]]));
    // `moved` is controlled by area B, so B's staff see it too — the controller is the area.
    assert.deepEqual(seen, new Set([w.eB.id, w.moved.id]));
    assert.equal((await q(`SELECT 1 FROM evidence_file WHERE id = $1`, [w.eA.fileId])).length, 0);
  });
});

test('a school with no area falls back to the school list', async (t) => {
  await client.query('BEGIN');
  t.after(() => client.query('ROLLBACK'));
  const w = await world();
  await scoped({ schools: [w.sN] }, async () => {
    const seen = ids(await q(`SELECT id FROM evidence WHERE id = ANY($1::uuid[])`, [[w.eA.id, w.eB.id, w.eN.id, w.moved.id]]));
    assert.deepEqual(seen, new Set([w.eN.id]));
  });
});

test('fails closed: empty or unset scope sees nothing', async (t) => {
  await client.query('BEGIN');
  t.after(() => client.query('ROLLBACK'));
  const w = await world();
  for (const scope of [{}, null]) {
    await scoped(scope, async () => {
      for (const table of TABLES) {
        const rows = await q(`SELECT count(*)::int AS n FROM ${table}`);
        assert.equal(rows[0].n, 0, `${table} with scope ${JSON.stringify(scope)}`);
      }
    });
  }
  // Outside the scoped role nothing changed: seip_app still sees the rows.
  const all = await q(`SELECT id FROM evidence WHERE id = ANY($1::uuid[])`, [[w.eA.id, w.eB.id, w.eN.id, w.moved.id]]);
  assert.equal(all.length, 4);
});

test('a malformed scope is an error, not a wider read', async (t) => {
  await client.query('BEGIN');
  t.after(() => client.query('ROLLBACK'));
  await client.query('SAVEPOINT bad');
  await client.query('SET LOCAL ROLE seip_scoped');
  await client.query(`SELECT set_config('seip.area_ids', 'not-a-uuid-list', true)`);
  await assert.rejects(client.query('SELECT id FROM evidence LIMIT 1'), (e) => e.code === '22P02');
  await client.query('ROLLBACK TO SAVEPOINT bad');
});

test('seip_scoped is read-only: writes are refused, in scope or not', async (t) => {
  await client.query('BEGIN');
  t.after(() => client.query('ROLLBACK'));
  const w = await world();
  await scoped({ areas: [w.areaA], schools: [w.sA], persons: [w.tA.personId] }, async () => {
    await client.query('SAVEPOINT w');
    await assert.rejects(client.query(`UPDATE evidence SET title = 'x' WHERE id = $1`, [w.eA.id]), (e) => e.code === '42501');
    await client.query('ROLLBACK TO SAVEPOINT w');
    await assert.rejects(client.query(`DELETE FROM evidence_file WHERE id = $1`, [w.eA.fileId]), (e) => e.code === '42501');
    await client.query('ROLLBACK TO SAVEPOINT w');
  });
});

test('catalog: RLS on the five tables, and the role cannot bypass it', async () => {
  const rls = await q(`SELECT relname, relrowsecurity FROM pg_class WHERE relname = ANY($1) AND relkind = 'r'`, [TABLES]);
  assert.equal(rls.length, TABLES.length);
  for (const r of rls) assert.equal(r.relrowsecurity, true, `${r.relname} has RLS enabled`);
  const [role] = await q(`SELECT rolcanlogin, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'seip_scoped'`);
  assert.deepEqual(role, { rolcanlogin: false, rolbypassrls: false, rolsuper: false });
  const [app] = await q(`SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user`);
  assert.equal(app.rolbypassrls, false);
});
