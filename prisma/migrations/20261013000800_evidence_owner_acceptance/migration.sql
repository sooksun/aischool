-- FR-019 / CCR-024: evidence a school admin uploads for someone else waits for
-- the owner's acceptance. Every existing item counts as accepted.
ALTER TABLE "evidence" ADD COLUMN "owner_accepted_at" TIMESTAMP(3);
UPDATE "evidence" SET "owner_accepted_at" = "created_at";
