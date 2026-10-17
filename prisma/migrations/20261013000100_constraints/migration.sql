-- SEIP constraint layer — SEIP-DB-001, rebaselined on PostgreSQL 18 (ADR-0012)
-- Rules from docs/architecture/evaluation-framework.md (ADR-0003) and
-- entity-dictionary.md §10 that Prisma's schema language cannot express.
-- These live in the DATABASE on purpose: a rule enforced only in application code
-- is a rule that a future bug, a script, or a psql session can quietly violate.

-- ── rubric levels are 1..4 (framework §Scoring model) ──
ALTER TABLE indicator_level_description
  ADD CONSTRAINT ild_rubric_level_range CHECK (rubric_level BETWEEN 1 AND 4);
ALTER TABLE indicator_score
  ADD CONSTRAINT score_rubric_level_range CHECK (rubric_level BETWEEN 1 AND 4);

-- ── committee seats are 1..3 (ว9 p.74: 3 members per evaluatee) ──
ALTER TABLE committee_member
  ADD CONSTRAINT committee_seat_range CHECK (seat_number BETWEEN 1 AND 3);

-- ── rounds are 1..n, never 0 or negative; count is NOT capped (rounds are data) ──
ALTER TABLE evaluation_round
  ADD CONSTRAINT round_number_positive CHECK (round_number >= 1);

-- ── date sanity ──
ALTER TABLE evaluation_cycle
  ADD CONSTRAINT cycle_dates_ordered CHECK (starts_on <= ends_on);
ALTER TABLE evaluation_round
  ADD CONSTRAINT round_dates_ordered CHECK (period_start <= period_end);

-- ── membership scope must agree with which id is set (permissions.yaml tenancy) ──
ALTER TABLE school_membership
  ADD CONSTRAINT membership_scope_ids CHECK (
    (membership_scope = 'school' AND school_id IS NOT NULL) OR
    (membership_scope = 'area'   AND area_id   IS NOT NULL)
  );

-- ── emails are stored lowercase so `unique` actually means unique ──
ALTER TABLE user_account
  ADD CONSTRAINT user_email_lowercase CHECK (email = lower(email));

-- ── the ภาระงาน gate row is never itself scored ──
ALTER TABLE indicator
  ADD CONSTRAINT workload_gate_not_scored CHECK (
    indicator_kind <> 'workload_gate' OR is_scored = false
  );

-- ── two-tier confirmation carries its actors (ADR-0015, CCR-017) ──
ALTER TABLE evidence_indicator_mapping
  ADD CONSTRAINT mapping_validated_has_actor CHECK (
    status <> 'validated'
    OR (validated_by_user_id IS NOT NULL AND validated_at IS NOT NULL AND validator_role IS NOT NULL)
  );
ALTER TABLE evidence_indicator_mapping
  ADD CONSTRAINT mapping_returned_has_note CHECK (
    status <> 'returned' OR (return_note IS NOT NULL AND length(btrim(return_note)) > 0)
  );

-- ── one LIVE mapping per (evidence, indicator, framework version). A revoked row
-- never blocks a re-map. Keyed on the framework version, not a cycle: a portfolio
-- item outlives any one evaluation cycle (CCR-017). ──
CREATE UNIQUE INDEX evidence_indicator_mapping_active_uk
  ON evidence_indicator_mapping (evidence_id, indicator_id, framework_version_id)
  WHERE status <> 'revoked';

-- ── evidence kind carries its payload; dates and periods are sane ──
ALTER TABLE evidence
  ADD CONSTRAINT evidence_kind_payload CHECK (
    (kind <> 'link' OR link_url IS NOT NULL) AND (kind <> 'note' OR note_text IS NOT NULL)
  );
ALTER TABLE evidence
  ADD CONSTRAINT evidence_performed_ordered CHECK (
    performed_from IS NULL OR performed_to IS NULL OR performed_from <= performed_to
  );
ALTER TABLE evidence
  ADD CONSTRAINT evidence_semester_range CHECK (semester IS NULL OR semester IN (1, 2));

-- ── upload sessions ──
ALTER TABLE upload_session
  ADD CONSTRAINT upload_session_sizes CHECK (part_size > 0 AND part_count >= 1 AND byte_size > 0);

-- ── one PA cycle per (school, fiscal year, framework). DPA is on-demand and may repeat. ──
CREATE UNIQUE INDEX evaluation_cycle_pa_uk
  ON evaluation_cycle (school_id, fiscal_year, framework_version_id)
  WHERE evaluation_kind = 'pa';

-- ── pass threshold is DERIVED, never written by the app.
-- Framework rule (ว9 p.74): each evaluator individually must reach 70%. Storing this
-- as a plain column invites drift between total_percent and the verdict. ──
ALTER TABLE round_result DROP COLUMN passed_individual_threshold;
ALTER TABLE round_result
  ADD COLUMN passed_individual_threshold BOOLEAN
  GENERATED ALWAYS AS (total_percent >= 70) STORED;

ALTER TABLE round_result
  ADD CONSTRAINT round_result_percent_range CHECK (
    part1_percent BETWEEN 0 AND 100 AND
    part2_percent BETWEEN 0 AND 100 AND
    total_percent BETWEEN 0 AND 100
  );

-- ── audit_event is append-only.
-- Two layers (ADR-0012 §4): the app role (seip_app) loses UPDATE/DELETE/TRUNCATE
-- outright, and a trigger owned by the migrator refuses UPDATE/DELETE from anyone
-- else who connects — including the table owner, whom a REVOKE does not stop. ──
CREATE OR REPLACE FUNCTION audit_event_is_append_only() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_event is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_event_no_update
  BEFORE UPDATE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION audit_event_is_append_only();

CREATE TRIGGER audit_event_no_delete
  BEFORE DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION audit_event_is_append_only();

-- TRUNCATE skips row triggers, so it is revoked too. Guarded: a dev database
-- created without scripts/db/bootstrap-roles.sql has no seip_app role, and the
-- trigger above still holds there.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'seip_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON audit_event FROM seip_app;
  END IF;
END
$$;
