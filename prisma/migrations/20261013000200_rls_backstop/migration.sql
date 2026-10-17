-- RLS backstop by สพท. (ADR-0012 §3, ADR-0019).
--
-- What this protects against: a query that forgets its tenant filter. It does
-- NOT replace the authorization in apps/api (permissions.yaml + evidence-access);
-- it is the second wall behind it.
--
-- Where it applies: only to the NOLOGIN role seip_scoped, which seip_app enters
-- with `SET LOCAL ROLE seip_scoped` inside an area-scoped transaction
-- (packages/database withAreaScope). Every other role sees what it saw before:
--   seip_migrator  owns the tables, so RLS does not apply to it (no FORCE)
--   seip_app       the permissive branch below (`current_user <> 'seip_scoped'`)
-- Raw SQL that reads tenant data (the P3 vector search, ad-hoc reports) must run
-- inside withAreaScope.
--
-- The scope is three transaction-local settings, set by withAreaScope:
--   seip.area_ids    uuid[] — the caller's areas (สพท.)
--   seip.school_ids  uuid[] — the caller's schools; used for rows whose school
--                             has no area yet
--   seip.person_ids  uuid[] — the caller's person and the evaluatees of their
--                             committee seats; a portfolio follows its owner
--                             across areas (ADR-0015)
-- Unset or empty means no rows: the scope fails closed. A malformed value raises
-- an error instead of widening.
--
-- The policies name the role as a string rather than `TO seip_scoped`, so this
-- migration also runs on a database created without bootstrap-roles.sql.

CREATE FUNCTION seip_scope_area_ids() RETURNS uuid[]
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT coalesce(nullif(current_setting('seip.area_ids', true), '')::uuid[], '{}'::uuid[]) $$;

CREATE FUNCTION seip_scope_school_ids() RETURNS uuid[]
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT coalesce(nullif(current_setting('seip.school_ids', true), '')::uuid[], '{}'::uuid[]) $$;

CREATE FUNCTION seip_scope_person_ids() RETURNS uuid[]
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT coalesce(nullif(current_setting('seip.person_ids', true), '')::uuid[], '{}'::uuid[]) $$;

-- ── evidence: an owner in scope, or the controller area; the origin school when the
-- school has no area. ──
ALTER TABLE evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY evidence_area_backstop ON evidence
  USING (
    current_user <> 'seip_scoped'
    OR owner_person_id = ANY (seip_scope_person_ids())
    OR controller_area_id = ANY (seip_scope_area_ids())
    OR (controller_area_id IS NULL AND origin_school_id = ANY (seip_scope_school_ids()))
  );

-- ── Children of evidence follow their parent. The subquery is itself filtered
-- by evidence_area_backstop, so a hidden parent hides its children. ──
ALTER TABLE evidence_file ENABLE ROW LEVEL SECURITY;
CREATE POLICY evidence_file_area_backstop ON evidence_file
  USING (
    current_user <> 'seip_scoped'
    OR EXISTS (SELECT 1 FROM evidence e WHERE e.id = evidence_file.evidence_id)
  );

ALTER TABLE evidence_indicator_mapping ENABLE ROW LEVEL SECURITY;
CREATE POLICY evidence_indicator_mapping_area_backstop ON evidence_indicator_mapping
  USING (
    current_user <> 'seip_scoped'
    OR EXISTS (SELECT 1 FROM evidence e WHERE e.id = evidence_indicator_mapping.evidence_id)
  );

ALTER TABLE upload_session ENABLE ROW LEVEL SECURITY;
CREATE POLICY upload_session_area_backstop ON upload_session
  USING (
    current_user <> 'seip_scoped'
    OR EXISTS (SELECT 1 FROM evidence e WHERE e.id = upload_session.evidence_id)
  );

-- ── personnel_profile: a person in scope, or a profile at a school or area in scope. ──
ALTER TABLE personnel_profile ENABLE ROW LEVEL SECURITY;
CREATE POLICY personnel_profile_area_backstop ON personnel_profile
  USING (
    current_user <> 'seip_scoped'
    OR person_id = ANY (seip_scope_person_ids())
    OR school_id = ANY (seip_scope_school_ids())
    OR EXISTS (
      SELECT 1 FROM school s
      WHERE s.id = personnel_profile.school_id AND s.area_id = ANY (seip_scope_area_ids())
    )
  );

-- seip_scoped reads every table (joins to school, indicator and the like), and
-- writes none. bootstrap-roles.sql grants this by default privilege for tables
-- created later; this catches a database bootstrapped before ADR-0019.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'seip_scoped') THEN
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO seip_scoped;
  END IF;
END
$$;
