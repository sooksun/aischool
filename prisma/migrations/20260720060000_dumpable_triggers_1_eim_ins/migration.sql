-- Make the triggers survive a mysqldump/restore round-trip.  [1 of 4]
--
-- ## The bug
--
-- Three of the four triggers created by 20260718210100_constraints stored a
-- TRAILING SEMICOLON inside their body:
--
--   ACTION_STATEMENT = "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '...';"
--                                                                      ^
--
-- mysqldump wraps a trigger body in a version-conditional comment:
--
--   /*!50003 CREATE*/ /*!50017 DEFINER=...*/ /*!50003 TRIGGER x ... <body> */;;
--
-- A `;` at the end of <body> terminates the statement BEFORE the closing `*/`,
-- and the restore dies with "syntax error near '*/'" — losing that trigger and
-- everything after it in the dump.
--
-- So **every backup this project had ever taken silently could not restore its
-- audit-immutability triggers.** A restored database would accept UPDATE and
-- DELETE on `audit_event` — the append-only guarantee ADR-0008 depends on, gone,
-- with nothing to show it had happened.
--
-- ## Why it happened, and why this is FOUR migrations
--
-- Prisma's migration runner splits a .sql file on `;` and sends each statement to
-- the server WITH its terminator — except the file's last, which it strips. That
-- is exactly why `audit_event_no_delete`, the final statement of the constraints
-- migration, is the one trigger with a clean body while the other three are not.
-- (The `mysql` CLI strips terminators, which is why running the same SQL by hand
-- looks correct and hides the problem.)
--
-- The consequence is unavoidable and worth stating plainly: **a CREATE TRIGGER
-- has to be the last statement in its migration file** to get a clean body. One
-- file per trigger is not tidiness, it is the only arrangement that works. A
-- rewrite that merges these back into one file will silently reintroduce the bug
-- in every trigger but the last.
--
-- ## How it was found
--
-- Not by inspection. `scripts/ops/backup.mjs` restores every dump it takes into a
-- scratch database and compares table counts, and the first real run failed on it.
-- A backup that has never been restored is a hypothesis.
--
-- Verify after applying all four:
--   SELECT TRIGGER_NAME, RIGHT(ACTION_STATEMENT, 1) FROM information_schema.TRIGGERS
--   WHERE TRIGGER_SCHEMA = DATABASE();   -- no row may end in ';'

DROP TRIGGER IF EXISTS eim_active_uk_key_ins;
DROP TRIGGER IF EXISTS eim_active_uk_key_upd;
DROP TRIGGER IF EXISTS audit_event_no_update;
DROP TRIGGER IF EXISTS audit_event_no_delete;

CREATE TRIGGER eim_active_uk_key_ins
  BEFORE INSERT ON evidence_indicator_mapping
  FOR EACH ROW SET NEW.active_uk_key =
    CASE WHEN NEW.status IN ('suggested', 'confirmed')
         THEN CONCAT(NEW.evidence_id, ':', NEW.indicator_id, ':', COALESCE(NEW.cycle_id, '~'))
         ELSE NULL END
