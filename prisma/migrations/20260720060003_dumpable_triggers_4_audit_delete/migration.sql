-- [4 of 4] See 20260720060000 for why each CREATE TRIGGER needs its own file.
CREATE TRIGGER audit_event_no_delete
  BEFORE DELETE ON audit_event
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_event is append-only: DELETE is not permitted'
