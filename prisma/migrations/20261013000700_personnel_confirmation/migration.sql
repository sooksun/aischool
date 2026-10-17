-- FR-099a / CCR-023: the person confirms their profile or asks for a correction.
ALTER TABLE "personnel_profile"
  ADD COLUMN "rank_since" DATE,
  ADD COLUMN "confirmed_at" TIMESTAMP(3),
  ADD COLUMN "correction_note" TEXT,
  ADD CONSTRAINT "personnel_profile_correction_note_check" CHECK (char_length("correction_note") <= 1000);
