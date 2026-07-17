-- SEIP-WORKER-001: transactional outbox + worker job queue
CREATE TABLE IF NOT EXISTS "outbox_event" (
    "id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "school_id" UUID,
    "actor_user_id" UUID,
    "request_id" UUID,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    CONSTRAINT "outbox_event_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "outbox_event_published_at_occurred_at_idx" ON "outbox_event"("published_at", "occurred_at");
CREATE INDEX IF NOT EXISTS "outbox_event_event_type_published_at_idx" ON "outbox_event"("event_type", "published_at");

CREATE TABLE IF NOT EXISTS "worker_job" (
    "id" UUID NOT NULL,
    "job_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "worker_job_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "worker_job_status_available_at_idx" ON "worker_job"("status", "available_at");
CREATE INDEX IF NOT EXISTS "worker_job_job_type_status_idx" ON "worker_job"("job_type", "status");