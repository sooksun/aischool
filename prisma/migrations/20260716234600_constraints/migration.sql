-- SEIP constraint layer — SEIP-DB-001
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

-- ── a confirmed mapping requires WHO confirmed it and WHEN (governance, not vibes) ──
ALTER TABLE evidence_indicator_mapping
  ADD CONSTRAINT mapping_confirmed_has_actor CHECK (
    status <> 'confirmed' OR (confirmed_by_user_id IS NOT NULL AND confirmed_at IS NOT NULL)
  );

-- ── one ACTIVE mapping per (evidence, indicator, cycle).
-- Partial + NULLS NOT DISTINCT: rejected/revoked rows must NOT block a re-map, and a
-- NULL cycle_id must still collide with another NULL cycle_id (default SQL treats
-- NULLs as distinct, which would silently allow duplicates). ──
CREATE UNIQUE INDEX evidence_indicator_mapping_active_uk
  ON evidence_indicator_mapping (evidence_id, indicator_id, cycle_id) NULLS NOT DISTINCT
  WHERE status IN ('suggested', 'confirmed');

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
-- A trigger, not a GRANT: revoking privileges does not stop a table owner, and the
-- migration/app often share a role in small on-prem deployments (ADR-0005). This
-- holds regardless of who connects. ──
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
