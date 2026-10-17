-- P3 in-country AI v0 (ADR-0010, contract 4.0.0 "analysis"): analyses, content
-- segments (locator targets), suggestions and the owner's rejection feedback.
-- AI only suggests; a mapping exists only once the owner accepts.
-- CreateEnum
CREATE TYPE "AnalysisStatus" AS ENUM ('queued', 'extracting', 'perceiving', 'mapping', 'validating', 'succeeded', 'degraded', 'failed');

-- CreateEnum
CREATE TYPE "SegmentKind" AS ENUM ('page_block', 'transcript', 'keyframe', 'image_caption', 'sheet_range', 'note', 'link_text');

-- CreateEnum
CREATE TYPE "SuggestionStatus" AS ENUM ('open', 'accepted', 'rejected', 'superseded', 'needs_review');

-- CreateEnum
CREATE TYPE "SuggestionBand" AS ENUM ('clear', 'likely', 'possible');

-- CreateEnum
CREATE TYPE "SuggestionSupport" AS ENUM ('supports', 'partially_supports');

-- CreateEnum
CREATE TYPE "SuggestionRejectReason" AS ENUM ('not_relevant', 'wrong_indicator', 'weak_evidence', 'wrong_period', 'duplicate', 'other');

-- CreateTable
CREATE TABLE "evidence_analysis" (
    "id" UUID NOT NULL,
    "evidence_id" UUID NOT NULL,
    "status" "AnalysisStatus" NOT NULL DEFAULT 'queued',
    "stage" TEXT,
    "provisional" BOOLEAN NOT NULL DEFAULT true,
    "error_code" TEXT,
    "requested_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "evidence_analysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_segment" (
    "id" UUID NOT NULL,
    "evidence_id" UUID NOT NULL,
    "evidence_file_id" UUID NOT NULL,
    "analysis_id" UUID NOT NULL,
    "kind" "SegmentKind" NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "page" INTEGER,
    "t_start_ms" INTEGER,
    "t_end_ms" INTEGER,
    "frame_ms" INTEGER,
    "bbox" JSONB,
    "text" TEXT,
    "confidence" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_segment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_suggestion" (
    "id" UUID NOT NULL,
    "evidence_id" UUID NOT NULL,
    "analysis_id" UUID NOT NULL,
    "indicator_id" UUID NOT NULL,
    "framework_version_id" UUID NOT NULL,
    "band" "SuggestionBand" NOT NULL,
    "support" "SuggestionSupport" NOT NULL DEFAULT 'supports',
    "calibrated_p" DOUBLE PRECISION,
    "rationale_th" TEXT,
    "locators" JSONB NOT NULL DEFAULT '[]',
    "provisional" BOOLEAN NOT NULL DEFAULT true,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'open',
    "model_label" TEXT,
    "prompt_version" TEXT,
    "input_sha256" TEXT,
    "superseded_by_id" UUID,
    "decided_by_user_id" UUID,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_suggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suggestion_feedback" (
    "id" UUID NOT NULL,
    "suggestion_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "reason_code" "SuggestionRejectReason" NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suggestion_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "evidence_analysis_evidence_id_created_at_idx" ON "evidence_analysis"("evidence_id", "created_at");

-- CreateIndex
CREATE INDEX "content_segment_evidence_id_analysis_id_ordinal_idx" ON "content_segment"("evidence_id", "analysis_id", "ordinal");

-- CreateIndex
CREATE INDEX "ai_suggestion_evidence_id_status_idx" ON "ai_suggestion"("evidence_id", "status");

-- CreateIndex
CREATE INDEX "suggestion_feedback_suggestion_id_idx" ON "suggestion_feedback"("suggestion_id");

-- AddForeignKey
ALTER TABLE "evidence_analysis" ADD CONSTRAINT "evidence_analysis_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_segment" ADD CONSTRAINT "content_segment_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_segment" ADD CONSTRAINT "content_segment_evidence_file_id_fkey" FOREIGN KEY ("evidence_file_id") REFERENCES "evidence_file"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_segment" ADD CONSTRAINT "content_segment_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "evidence_analysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_suggestion" ADD CONSTRAINT "ai_suggestion_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_suggestion" ADD CONSTRAINT "ai_suggestion_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "evidence_analysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_suggestion" ADD CONSTRAINT "ai_suggestion_indicator_id_fkey" FOREIGN KEY ("indicator_id") REFERENCES "indicator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_suggestion" ADD CONSTRAINT "ai_suggestion_framework_version_id_fkey" FOREIGN KEY ("framework_version_id") REFERENCES "framework_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suggestion_feedback" ADD CONSTRAINT "suggestion_feedback_suggestion_id_fkey" FOREIGN KEY ("suggestion_id") REFERENCES "ai_suggestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- RLS backstop (ADR-0019): every new tenant table follows its evidence row, like
-- evidence_file. Feedback follows its suggestion.
ALTER TABLE evidence_analysis ENABLE ROW LEVEL SECURITY;
CREATE POLICY evidence_analysis_area_backstop ON evidence_analysis
  USING (current_user <> 'seip_scoped' OR EXISTS (SELECT 1 FROM evidence e WHERE e.id = evidence_analysis.evidence_id));

ALTER TABLE content_segment ENABLE ROW LEVEL SECURITY;
CREATE POLICY content_segment_area_backstop ON content_segment
  USING (current_user <> 'seip_scoped' OR EXISTS (SELECT 1 FROM evidence e WHERE e.id = content_segment.evidence_id));

ALTER TABLE ai_suggestion ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_suggestion_area_backstop ON ai_suggestion
  USING (current_user <> 'seip_scoped' OR EXISTS (SELECT 1 FROM evidence e WHERE e.id = ai_suggestion.evidence_id));

ALTER TABLE suggestion_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY suggestion_feedback_area_backstop ON suggestion_feedback
  USING (current_user <> 'seip_scoped' OR EXISTS (SELECT 1 FROM ai_suggestion s WHERE s.id = suggestion_feedback.suggestion_id));

-- One open suggestion per (evidence, indicator, framework version): a re-run
-- supersedes the earlier one before inserting.
CREATE UNIQUE INDEX ai_suggestion_open_uk ON ai_suggestion (evidence_id, indicator_id, framework_version_id) WHERE status = 'open';
