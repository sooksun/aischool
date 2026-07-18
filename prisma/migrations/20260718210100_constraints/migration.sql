-- SEIP constraint layer — MySQL 8 edition (ADR-0008; rebaseline of the Postgres
-- 20260716234600_constraints migration, same rules from evaluation-framework.md
-- / entity-dictionary.md §10). These live in the DATABASE on purpose: a rule
-- enforced only in application code is a rule that a future bug, a script, or a
-- mysql session can quietly violate.
--
-- Dialect notes vs the Postgres original:
--   * No DELIMITER blocks — Prisma splits this file on semicolons, so every
--     trigger is a single-statement trigger.
--   * MySQL has no partial unique indexes and unique indexes treat NULLs as
--     distinct — the two partial uniques ride STORED GENERATED key columns
--     (created as plain columns by the init migration, converted here).
--   * The default collation (utf8mb4_unicode_ci) is case-insensitive, which
--     would make CHECK (email = LOWER(email)) a no-op — compare as BINARY.

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

-- ── emails are stored lowercase so `unique` actually means unique.
-- BINARY compare: under utf8mb4_unicode_ci, 'A' = 'a' — the naive CHECK would
-- always pass and enforce nothing. ──
ALTER TABLE user_account
  ADD CONSTRAINT user_email_lowercase CHECK (
    CAST(email AS BINARY) = CAST(LOWER(email) AS BINARY)
  );

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
-- active_uk_key stays the PLAIN column the init migration created (with its
-- unique index) and is kept correct by triggers instead of GENERATED ALWAYS:
-- InnoDB refuses ANY cascading FK action — even evidence's ON DELETE CASCADE —
-- on a stored generated column's base (errno 1215, verified on 8.0.30).
-- The triggers overwrite whatever the client supplied on every INSERT/UPDATE,
-- and no cascaded action can change the base columns behind their back (every
-- UPDATE rule on this table is RESTRICT), so the key cannot drift from the row.
-- NULL for revoked/rejected rows (NULLs never collide → the slot frees), and a
-- NULL cycle_id folds to the '~' sentinel so NULL DOES collide with NULL (the
-- Postgres original used a partial unique index + NULLS NOT DISTINCT). ──
CREATE TRIGGER eim_active_uk_key_ins
  BEFORE INSERT ON evidence_indicator_mapping
  FOR EACH ROW SET NEW.active_uk_key =
    CASE WHEN NEW.status IN ('suggested', 'confirmed')
         THEN CONCAT(NEW.evidence_id, ':', NEW.indicator_id, ':', COALESCE(NEW.cycle_id, '~'))
         ELSE NULL END;

CREATE TRIGGER eim_active_uk_key_upd
  BEFORE UPDATE ON evidence_indicator_mapping
  FOR EACH ROW SET NEW.active_uk_key =
    CASE WHEN NEW.status IN ('suggested', 'confirmed')
         THEN CONCAT(NEW.evidence_id, ':', NEW.indicator_id, ':', COALESCE(NEW.cycle_id, '~'))
         ELSE NULL END;

-- ── one PA cycle per (school, fiscal year, framework). DPA is on-demand and may repeat. ──
ALTER TABLE evaluation_cycle DROP INDEX evaluation_cycle_pa_uk;
ALTER TABLE evaluation_cycle DROP COLUMN pa_uk_key;
ALTER TABLE evaluation_cycle
  ADD COLUMN pa_uk_key VARCHAR(120)
  GENERATED ALWAYS AS (
    CASE WHEN evaluation_kind = 'pa'
         THEN CONCAT(school_id, ':', fiscal_year, ':', framework_version_id)
         ELSE NULL END
  ) STORED;
CREATE UNIQUE INDEX evaluation_cycle_pa_uk ON evaluation_cycle (pa_uk_key);

-- ── pass threshold is DERIVED, never written by the app.
-- Framework rule (ว9 p.74): each evaluator individually must reach 70%. ──
ALTER TABLE round_result DROP COLUMN passed_individual_threshold;
ALTER TABLE round_result
  ADD COLUMN passed_individual_threshold TINYINT(1)
  GENERATED ALWAYS AS (total_percent >= 70) STORED;

ALTER TABLE round_result
  ADD CONSTRAINT round_result_percent_range CHECK (
    part1_percent BETWEEN 0 AND 100 AND
    part2_percent BETWEEN 0 AND 100 AND
    total_percent BETWEEN 0 AND 100
  );

-- ── audit_event is append-only.
-- Triggers, not GRANTs: the migration/app share one MySQL user in small on-prem
-- deployments (ADR-0005) — this holds regardless of who connects. Single-statement
-- triggers so no DELIMITER is needed. SIGNAL 45000 → client errno 1644. ──
CREATE TRIGGER audit_event_no_update
  BEFORE UPDATE ON audit_event
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_event is append-only: UPDATE is not permitted';

CREATE TRIGGER audit_event_no_delete
  BEFORE DELETE ON audit_event
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_event is append-only: DELETE is not permitted';
