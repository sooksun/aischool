-- FR-117 data-subject requests and the area-scoped dpo role (CCR-029, owner decision 2026-10-15).
-- CreateEnum
CREATE TYPE "SubjectRequestType" AS ENUM ('access', 'portability', 'correction', 'erasure', 'restriction', 'objection');

-- CreateEnum
CREATE TYPE "SubjectRequestStatus" AS ENUM ('received', 'fulfilling', 'approved', 'completed', 'rejected');

-- AlterEnum


ALTER TYPE "NotificationKind" ADD VALUE 'subject_request_received';
ALTER TYPE "NotificationKind" ADD VALUE 'subject_request_updated';

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'dpo';


-- CreateTable
CREATE TABLE "subject_request" (
    "id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "requested_by_user_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "area_id" UUID NOT NULL,
    "request_type" "SubjectRequestType" NOT NULL,
    "status" "SubjectRequestStatus" NOT NULL DEFAULT 'received',
    "details" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_at" TIMESTAMP(3) NOT NULL,
    "decision_note" TEXT,
    "decided_at" TIMESTAMP(3),
    "decided_by_user_id" UUID,
    "completed_at" TIMESTAMP(3),
    "export_id" UUID,

    CONSTRAINT "subject_request_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subject_request_export_id_key" ON "subject_request"("export_id");

-- CreateIndex
CREATE INDEX "subject_request_person_id_received_at_idx" ON "subject_request"("person_id", "received_at");

-- CreateIndex
CREATE INDEX "subject_request_area_id_status_due_at_idx" ON "subject_request"("area_id", "status", "due_at");


-- A decision is a decision: who and when travel together; a rejection carries its reason.
ALTER TABLE subject_request
  ADD CONSTRAINT subject_request_decided_has_actor CHECK (
    status = 'received' OR (decided_at IS NOT NULL AND decided_by_user_id IS NOT NULL)
  );
ALTER TABLE subject_request
  ADD CONSTRAINT subject_request_rejected_has_note CHECK (
    status <> 'rejected' OR (decision_note IS NOT NULL AND length(btrim(decision_note)) > 0)
  );
ALTER TABLE subject_request
  ADD CONSTRAINT subject_request_due_after_receipt CHECK (due_at >= received_at);

-- RLS backstop (ADR-0019): the person in scope, or the area whose DPO decides.
ALTER TABLE subject_request ENABLE ROW LEVEL SECURITY;
CREATE POLICY subject_request_area_backstop ON subject_request
  USING (current_user <> 'seip_scoped' OR person_id = ANY (seip_scope_person_ids()) OR area_id = ANY (seip_scope_area_ids()));
