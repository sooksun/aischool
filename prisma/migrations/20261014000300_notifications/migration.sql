-- P4 notifications (FR-100/102): the in-app inbox and channel preferences.
-- Personal to one account (user_id); never read through the area-scoped role.
-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('suggestions_ready', 'processing_failed', 'mapping_returned', 'mapping_validated', 'deadline', 'export_ready', 'transfer_approved');

-- CreateTable
CREATE TABLE "notification" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "title_th" TEXT NOT NULL,
    "body_th" TEXT,
    "entity_type" TEXT,
    "entity_id" UUID,
    "route" TEXT,
    "source_event_id" UUID,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preference" (
    "user_id" UUID NOT NULL,
    "push" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT false,
    "quiet_start" TEXT,
    "quiet_end" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_preference_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE INDEX "notification_user_id_created_at_idx" ON "notification"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_source_event_id_user_id_key" ON "notification"("source_event_id", "user_id");


