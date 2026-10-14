-- FR-028 / CCR-027: the "may contain hidden instructions" flag on evidence.
-- AlterTable
ALTER TABLE "evidence" ADD COLUMN     "injection_cleared_at" TIMESTAMP(3),
ADD COLUMN     "injection_cleared_by_user_id" UUID,
ADD COLUMN     "injection_cleared_sha256" TEXT,
ADD COLUMN     "injection_input_sha256" TEXT,
ADD COLUMN     "injection_reasons" TEXT[] DEFAULT ARRAY[]::TEXT[];


