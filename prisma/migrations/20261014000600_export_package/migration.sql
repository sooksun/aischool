-- P5 exports (ADR-0017): packages built by the worker, held briefly in object storage.
-- CreateEnum
CREATE TYPE "ExportKind" AS ENUM ('dpa_pack', 'pa2_workbook', 'portfolio_portable');

-- CreateEnum
CREATE TYPE "ExportStatus" AS ENUM ('queued', 'preflight_failed', 'building', 'ready', 'failed', 'expired');

-- CreateTable
CREATE TABLE "export_package" (
    "id" UUID NOT NULL,
    "kind" "ExportKind" NOT NULL,
    "person_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "requested_by_user_id" UUID NOT NULL,
    "status" "ExportStatus" NOT NULL DEFAULT 'queued',
    "preflight" JSONB NOT NULL DEFAULT '[]',
    "storage_uri" TEXT,
    "byte_size" BIGINT,
    "sha256" TEXT,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "export_package_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "export_package_person_id_created_at_idx" ON "export_package"("person_id", "created_at");

-- CreateIndex
CREATE INDEX "export_package_school_id_created_at_idx" ON "export_package"("school_id", "created_at");


-- RLS backstop (ADR-0019): the person in scope, or the school it was requested at.
ALTER TABLE export_package ENABLE ROW LEVEL SECURITY;
CREATE POLICY export_package_area_backstop ON export_package
  USING (current_user <> 'seip_scoped' OR person_id = ANY (seip_scope_person_ids()) OR school_id = ANY (seip_scope_school_ids()));

