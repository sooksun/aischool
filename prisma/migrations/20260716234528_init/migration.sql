-- CreateEnum
CREATE TYPE "SchoolStatus" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'disabled', 'invited');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('teacher', 'director', 'deputy', 'evaluator', 'school_admin', 'area_admin');

-- CreateEnum
CREATE TYPE "MembershipScope" AS ENUM ('school', 'area');

-- CreateEnum
CREATE TYPE "RoleFamily" AS ENUM ('teacher', 'administrator');

-- CreateEnum
CREATE TYPE "FrameworkStatus" AS ENUM ('draft', 'active', 'superseded');

-- CreateEnum
CREATE TYPE "DomainPart" AS ENUM ('standards', 'challenge');

-- CreateEnum
CREATE TYPE "IndicatorKind" AS ENUM ('standard', 'challenge', 'workload_gate');

-- CreateEnum
CREATE TYPE "EvaluationKind" AS ENUM ('pa', 'dpa');

-- CreateEnum
CREATE TYPE "CycleStatus" AS ENUM ('planned', 'open', 'closed');

-- CreateEnum
CREATE TYPE "RoundStatus" AS ENUM ('planned', 'open', 'scoring', 'closed');

-- CreateEnum
CREATE TYPE "AgreementStatus" AS ENUM ('draft', 'submitted', 'acknowledged');

-- CreateEnum
CREATE TYPE "EvidenceStatus" AS ENUM ('draft', 'active', 'archived', 'rejected');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('pending', 'clean', 'blocked');

-- CreateEnum
CREATE TYPE "StorageProvider" AS ENUM ('s3_compatible');

-- CreateEnum
CREATE TYPE "MappingSource" AS ENUM ('human', 'ai_suggested');

-- CreateEnum
CREATE TYPE "MappingStatus" AS ENUM ('suggested', 'confirmed', 'rejected', 'revoked');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('pending', 'in_progress', 'completed', 'void');

-- CreateEnum
CREATE TYPE "CommitteeRole" AS ENUM ('chair', 'member');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('draft', 'pending_approval', 'approved', 'issued', 'superseded');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('pending', 'approved', 'rejected', 'returned');

-- CreateTable
CREATE TABLE "area" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "area_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "area_id" UUID,
    "status" "SchoolStatus" NOT NULL DEFAULT 'active',

    CONSTRAINT "school_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_account" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'invited',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_membership" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "school_id" UUID,
    "area_id" UUID,
    "role" "Role" NOT NULL,
    "membership_scope" "MembershipScope" NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "status" TEXT NOT NULL DEFAULT 'active',

    CONSTRAINT "school_membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rank_level" (
    "code" TEXT NOT NULL,
    "role_family" "RoleFamily" NOT NULL,
    "label_th" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "rank_level_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "personnel_profile" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "employee_code" TEXT,
    "full_name" TEXT NOT NULL,
    "position_role" "RoleFamily" NOT NULL,
    "rank_level_code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',

    CONSTRAINT "personnel_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "framework_version" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "role_family" "RoleFamily" NOT NULL,
    "legal_ref" TEXT NOT NULL,
    "revision_year" INTEGER NOT NULL,
    "status" "FrameworkStatus" NOT NULL DEFAULT 'draft',
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,

    CONSTRAINT "framework_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluation_domain" (
    "id" UUID NOT NULL,
    "framework_version_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name_th" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "part" "DomainPart" NOT NULL,

    CONSTRAINT "evaluation_domain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "indicator" (
    "id" UUID NOT NULL,
    "domain_id" UUID NOT NULL,
    "framework_version_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name_th" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "is_scored" BOOLEAN NOT NULL DEFAULT true,
    "indicator_kind" "IndicatorKind" NOT NULL,
    "max_points" DECIMAL(6,2),

    CONSTRAINT "indicator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "indicator_level_description" (
    "id" UUID NOT NULL,
    "indicator_id" UUID NOT NULL,
    "rank_level_code" TEXT NOT NULL,
    "rubric_level" INTEGER NOT NULL,
    "expected_practice_th" TEXT NOT NULL,

    CONSTRAINT "indicator_level_description_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "score_weight" (
    "id" UUID NOT NULL,
    "framework_version_id" UUID NOT NULL,
    "weight_key" TEXT NOT NULL,
    "weight_value" DECIMAL(6,2) NOT NULL,
    "notes" TEXT,

    CONSTRAINT "score_weight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_category" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label_th" TEXT NOT NULL,
    "allowed_mime_types" TEXT[],
    "max_byte_size" BIGINT,
    "max_duration_seconds" INTEGER,
    "required_for_dpa" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "evidence_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluation_cycle" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "framework_version_id" UUID NOT NULL,
    "fiscal_year" INTEGER NOT NULL,
    "evaluation_kind" "EvaluationKind" NOT NULL,
    "title" TEXT NOT NULL,
    "status" "CycleStatus" NOT NULL DEFAULT 'planned',
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,

    CONSTRAINT "evaluation_cycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluation_round" (
    "id" UUID NOT NULL,
    "cycle_id" UUID NOT NULL,
    "round_number" INTEGER NOT NULL,
    "purpose" TEXT NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "status" "RoundStatus" NOT NULL DEFAULT 'planned',

    CONSTRAINT "evaluation_round_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance_agreement" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "cycle_id" UUID NOT NULL,
    "personnel_id" UUID NOT NULL,
    "form_variant" TEXT NOT NULL,
    "status" "AgreementStatus" NOT NULL DEFAULT 'draft',
    "submitted_at" TIMESTAMP(3),

    CONSTRAINT "performance_agreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workload_declaration" (
    "id" UUID NOT NULL,
    "agreement_id" UUID NOT NULL,
    "round_id" UUID NOT NULL,
    "workload_met" BOOLEAN NOT NULL,
    "notes" TEXT,
    "declared_by_user_id" UUID NOT NULL,
    "declared_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workload_declaration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agreement_challenge" (
    "id" UUID NOT NULL,
    "agreement_id" UUID NOT NULL,
    "indicator_id" UUID NOT NULL,
    "method_plan" TEXT NOT NULL,
    "quantitative_target" TEXT,
    "qualitative_target" TEXT,

    CONSTRAINT "agreement_challenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "owner_personnel_id" UUID NOT NULL,
    "uploaded_by_user_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "EvidenceStatus" NOT NULL DEFAULT 'draft',
    "captured_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_file" (
    "id" UUID NOT NULL,
    "evidence_id" UUID NOT NULL,
    "storage_provider" "StorageProvider" NOT NULL DEFAULT 's3_compatible',
    "storage_uri" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "byte_size" BIGINT NOT NULL,
    "checksum_sha256" TEXT NOT NULL,
    "duration_seconds" INTEGER,
    "original_filename" TEXT NOT NULL,
    "scan_status" "ScanStatus" NOT NULL DEFAULT 'pending',
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_file_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_indicator_mapping" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "evidence_id" UUID NOT NULL,
    "indicator_id" UUID NOT NULL,
    "cycle_id" UUID,
    "mapping_source" "MappingSource" NOT NULL DEFAULT 'human',
    "status" "MappingStatus" NOT NULL DEFAULT 'suggested',
    "rationale" TEXT,
    "mapped_by_user_id" UUID NOT NULL,
    "confirmed_by_user_id" UUID,
    "mapped_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMP(3),

    CONSTRAINT "evidence_indicator_mapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluation_assignment" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "round_id" UUID NOT NULL,
    "evaluatee_personnel_id" UUID NOT NULL,
    "agreement_id" UUID,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'pending',

    CONSTRAINT "evaluation_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "committee_member" (
    "id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "evaluator_user_id" UUID NOT NULL,
    "committee_role" "CommitteeRole" NOT NULL,
    "seat_number" INTEGER NOT NULL,

    CONSTRAINT "committee_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "indicator_score" (
    "id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "indicator_id" UUID NOT NULL,
    "evaluator_user_id" UUID NOT NULL,
    "rubric_level" INTEGER NOT NULL,
    "points_awarded" DECIMAL(6,2),
    "comment" TEXT,
    "scored_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "indicator_score_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "round_result" (
    "id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "evaluator_user_id" UUID NOT NULL,
    "part1_percent" DECIMAL(5,2) NOT NULL,
    "part2_percent" DECIMAL(5,2) NOT NULL,
    "total_percent" DECIMAL(5,2) NOT NULL,
    "passed_workload_gate" BOOLEAN NOT NULL,
    "passed_individual_threshold" BOOLEAN,
    "status" TEXT NOT NULL DEFAULT 'computed',
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "round_result_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "cycle_id" UUID NOT NULL,
    "round_id" UUID,
    "subject_personnel_id" UUID NOT NULL,
    "template_code" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'draft',
    "payload" JSONB NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_section_ref" (
    "id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "evidence_id" UUID,
    "mapping_id" UUID,
    "section_key" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "report_section_ref_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "approver_user_id" UUID NOT NULL,
    "step_code" TEXT NOT NULL,
    "decision" "ApprovalDecision" NOT NULL DEFAULT 'pending',
    "comment" TEXT,
    "decided_at" TIMESTAMP(3),

    CONSTRAINT "approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_event" (
    "id" UUID NOT NULL,
    "school_id" UUID,
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "before_state" JSONB,
    "after_state" JSONB,
    "request_id" UUID,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "area_code_key" ON "area"("code");

-- CreateIndex
CREATE UNIQUE INDEX "school_code_key" ON "school"("code");

-- CreateIndex
CREATE INDEX "school_area_id_idx" ON "school"("area_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_account_email_key" ON "user_account"("email");

-- CreateIndex
CREATE INDEX "school_membership_user_id_status_idx" ON "school_membership"("user_id", "status");

-- CreateIndex
CREATE INDEX "school_membership_school_id_role_idx" ON "school_membership"("school_id", "role");

-- CreateIndex
CREATE INDEX "personnel_profile_school_id_status_idx" ON "personnel_profile"("school_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "personnel_profile_school_id_employee_code_key" ON "personnel_profile"("school_id", "employee_code");

-- CreateIndex
CREATE UNIQUE INDEX "framework_version_code_key" ON "framework_version"("code");

-- CreateIndex
CREATE INDEX "framework_version_role_family_status_idx" ON "framework_version"("role_family", "status");

-- CreateIndex
CREATE UNIQUE INDEX "evaluation_domain_framework_version_id_code_key" ON "evaluation_domain"("framework_version_id", "code");

-- CreateIndex
CREATE INDEX "indicator_domain_id_sort_order_idx" ON "indicator"("domain_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "indicator_framework_version_id_code_key" ON "indicator"("framework_version_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "indicator_level_description_indicator_id_rank_level_code_ru_key" ON "indicator_level_description"("indicator_id", "rank_level_code", "rubric_level");

-- CreateIndex
CREATE UNIQUE INDEX "score_weight_framework_version_id_weight_key_key" ON "score_weight"("framework_version_id", "weight_key");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_category_code_key" ON "evidence_category"("code");

-- CreateIndex
CREATE INDEX "evaluation_cycle_school_id_fiscal_year_idx" ON "evaluation_cycle"("school_id", "fiscal_year");

-- CreateIndex
CREATE UNIQUE INDEX "evaluation_round_cycle_id_round_number_key" ON "evaluation_round"("cycle_id", "round_number");

-- CreateIndex
CREATE UNIQUE INDEX "performance_agreement_cycle_id_personnel_id_key" ON "performance_agreement"("cycle_id", "personnel_id");

-- CreateIndex
CREATE UNIQUE INDEX "workload_declaration_agreement_id_round_id_key" ON "workload_declaration"("agreement_id", "round_id");

-- CreateIndex
CREATE UNIQUE INDEX "agreement_challenge_agreement_id_indicator_id_key" ON "agreement_challenge"("agreement_id", "indicator_id");

-- CreateIndex
CREATE INDEX "evidence_school_id_owner_personnel_id_deleted_at_idx" ON "evidence"("school_id", "owner_personnel_id", "deleted_at");

-- CreateIndex
CREATE INDEX "evidence_file_evidence_id_idx" ON "evidence_file"("evidence_id");

-- CreateIndex
CREATE INDEX "evidence_file_scan_status_idx" ON "evidence_file"("scan_status");

-- CreateIndex
CREATE INDEX "evidence_indicator_mapping_indicator_id_status_idx" ON "evidence_indicator_mapping"("indicator_id", "status");

-- CreateIndex
CREATE INDEX "evidence_indicator_mapping_school_id_status_idx" ON "evidence_indicator_mapping"("school_id", "status");

-- CreateIndex
CREATE INDEX "evaluation_assignment_school_id_status_idx" ON "evaluation_assignment"("school_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "evaluation_assignment_round_id_evaluatee_personnel_id_key" ON "evaluation_assignment"("round_id", "evaluatee_personnel_id");

-- CreateIndex
CREATE UNIQUE INDEX "committee_member_assignment_id_evaluator_user_id_key" ON "committee_member"("assignment_id", "evaluator_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "committee_member_assignment_id_seat_number_key" ON "committee_member"("assignment_id", "seat_number");

-- CreateIndex
CREATE INDEX "indicator_score_assignment_id_evaluator_user_id_idx" ON "indicator_score"("assignment_id", "evaluator_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "indicator_score_assignment_id_indicator_id_evaluator_user_i_key" ON "indicator_score"("assignment_id", "indicator_id", "evaluator_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "round_result_assignment_id_evaluator_user_id_key" ON "round_result"("assignment_id", "evaluator_user_id");

-- CreateIndex
CREATE INDEX "report_school_id_cycle_id_idx" ON "report"("school_id", "cycle_id");

-- CreateIndex
CREATE INDEX "report_section_ref_report_id_section_key_idx" ON "report_section_ref"("report_id", "section_key");

-- CreateIndex
CREATE INDEX "approval_report_id_decision_idx" ON "approval"("report_id", "decision");

-- CreateIndex
CREATE INDEX "audit_event_school_id_occurred_at_idx" ON "audit_event"("school_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_event_entity_type_entity_id_idx" ON "audit_event"("entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "school" ADD CONSTRAINT "school_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "area"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_membership" ADD CONSTRAINT "school_membership_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_membership" ADD CONSTRAINT "school_membership_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "school"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_membership" ADD CONSTRAINT "school_membership_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "area"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personnel_profile" ADD CONSTRAINT "personnel_profile_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "school"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personnel_profile" ADD CONSTRAINT "personnel_profile_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personnel_profile" ADD CONSTRAINT "personnel_profile_rank_level_code_fkey" FOREIGN KEY ("rank_level_code") REFERENCES "rank_level"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_domain" ADD CONSTRAINT "evaluation_domain_framework_version_id_fkey" FOREIGN KEY ("framework_version_id") REFERENCES "framework_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "indicator" ADD CONSTRAINT "indicator_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "evaluation_domain"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "indicator" ADD CONSTRAINT "indicator_framework_version_id_fkey" FOREIGN KEY ("framework_version_id") REFERENCES "framework_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "indicator_level_description" ADD CONSTRAINT "indicator_level_description_indicator_id_fkey" FOREIGN KEY ("indicator_id") REFERENCES "indicator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "indicator_level_description" ADD CONSTRAINT "indicator_level_description_rank_level_code_fkey" FOREIGN KEY ("rank_level_code") REFERENCES "rank_level"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_weight" ADD CONSTRAINT "score_weight_framework_version_id_fkey" FOREIGN KEY ("framework_version_id") REFERENCES "framework_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_cycle" ADD CONSTRAINT "evaluation_cycle_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "school"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_cycle" ADD CONSTRAINT "evaluation_cycle_framework_version_id_fkey" FOREIGN KEY ("framework_version_id") REFERENCES "framework_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_round" ADD CONSTRAINT "evaluation_round_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "evaluation_cycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_agreement" ADD CONSTRAINT "performance_agreement_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "school"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_agreement" ADD CONSTRAINT "performance_agreement_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "evaluation_cycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_agreement" ADD CONSTRAINT "performance_agreement_personnel_id_fkey" FOREIGN KEY ("personnel_id") REFERENCES "personnel_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workload_declaration" ADD CONSTRAINT "workload_declaration_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "performance_agreement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workload_declaration" ADD CONSTRAINT "workload_declaration_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "evaluation_round"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workload_declaration" ADD CONSTRAINT "workload_declaration_declared_by_user_id_fkey" FOREIGN KEY ("declared_by_user_id") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreement_challenge" ADD CONSTRAINT "agreement_challenge_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "performance_agreement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreement_challenge" ADD CONSTRAINT "agreement_challenge_indicator_id_fkey" FOREIGN KEY ("indicator_id") REFERENCES "indicator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "school"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_owner_personnel_id_fkey" FOREIGN KEY ("owner_personnel_id") REFERENCES "personnel_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "evidence_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_file" ADD CONSTRAINT "evidence_file_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_indicator_mapping" ADD CONSTRAINT "evidence_indicator_mapping_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "school"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_indicator_mapping" ADD CONSTRAINT "evidence_indicator_mapping_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_indicator_mapping" ADD CONSTRAINT "evidence_indicator_mapping_indicator_id_fkey" FOREIGN KEY ("indicator_id") REFERENCES "indicator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_indicator_mapping" ADD CONSTRAINT "evidence_indicator_mapping_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "evaluation_cycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_indicator_mapping" ADD CONSTRAINT "evidence_indicator_mapping_mapped_by_user_id_fkey" FOREIGN KEY ("mapped_by_user_id") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_indicator_mapping" ADD CONSTRAINT "evidence_indicator_mapping_confirmed_by_user_id_fkey" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_assignment" ADD CONSTRAINT "evaluation_assignment_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "school"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_assignment" ADD CONSTRAINT "evaluation_assignment_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "evaluation_round"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_assignment" ADD CONSTRAINT "evaluation_assignment_evaluatee_personnel_id_fkey" FOREIGN KEY ("evaluatee_personnel_id") REFERENCES "personnel_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_assignment" ADD CONSTRAINT "evaluation_assignment_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "performance_agreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "committee_member" ADD CONSTRAINT "committee_member_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "evaluation_assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "committee_member" ADD CONSTRAINT "committee_member_evaluator_user_id_fkey" FOREIGN KEY ("evaluator_user_id") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "indicator_score" ADD CONSTRAINT "indicator_score_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "evaluation_assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "indicator_score" ADD CONSTRAINT "indicator_score_indicator_id_fkey" FOREIGN KEY ("indicator_id") REFERENCES "indicator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "indicator_score" ADD CONSTRAINT "indicator_score_evaluator_user_id_fkey" FOREIGN KEY ("evaluator_user_id") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "round_result" ADD CONSTRAINT "round_result_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "evaluation_assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "round_result" ADD CONSTRAINT "round_result_evaluator_user_id_fkey" FOREIGN KEY ("evaluator_user_id") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report" ADD CONSTRAINT "report_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "school"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report" ADD CONSTRAINT "report_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "evaluation_cycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report" ADD CONSTRAINT "report_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "evaluation_round"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report" ADD CONSTRAINT "report_subject_personnel_id_fkey" FOREIGN KEY ("subject_personnel_id") REFERENCES "personnel_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_section_ref" ADD CONSTRAINT "report_section_ref_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_section_ref" ADD CONSTRAINT "report_section_ref_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "evidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_section_ref" ADD CONSTRAINT "report_section_ref_mapping_id_fkey" FOREIGN KEY ("mapping_id") REFERENCES "evidence_indicator_mapping"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval" ADD CONSTRAINT "approval_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "school"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval" ADD CONSTRAINT "approval_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval" ADD CONSTRAINT "approval_approver_user_id_fkey" FOREIGN KEY ("approver_user_id") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
