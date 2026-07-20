-- [2 of 4] See 20260720060000 for why each CREATE TRIGGER needs its own file.
CREATE TRIGGER eim_active_uk_key_upd
  BEFORE UPDATE ON evidence_indicator_mapping
  FOR EACH ROW SET NEW.active_uk_key =
    CASE WHEN NEW.status IN ('suggested', 'confirmed')
         THEN CONCAT(NEW.evidence_id, ':', NEW.indicator_id, ':', COALESCE(NEW.cycle_id, '~'))
         ELSE NULL END
