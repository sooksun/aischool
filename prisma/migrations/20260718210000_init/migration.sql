-- CreateTable
CREATE TABLE `area` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `area_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `school` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `area_id` CHAR(36) NULL,
    `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',

    UNIQUE INDEX `school_code_key`(`code`),
    INDEX `school_area_id_idx`(`area_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_account` (
    `id` CHAR(36) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `display_name` VARCHAR(191) NOT NULL,
    `password_hash` VARCHAR(191) NULL,
    `status` ENUM('active', 'disabled', 'invited') NOT NULL DEFAULT 'invited',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `user_account_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refresh_token` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `token_hash` VARCHAR(191) NOT NULL,
    `issued_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `replaced_by_id` CHAR(36) NULL,

    UNIQUE INDEX `refresh_token_token_hash_key`(`token_hash`),
    INDEX `refresh_token_user_id_revoked_at_idx`(`user_id`, `revoked_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `school_membership` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `school_id` CHAR(36) NULL,
    `area_id` CHAR(36) NULL,
    `role` ENUM('teacher', 'director', 'deputy', 'evaluator', 'school_admin', 'area_admin') NOT NULL,
    `membership_scope` ENUM('school', 'area') NOT NULL,
    `effective_from` DATE NOT NULL,
    `effective_to` DATE NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',

    INDEX `school_membership_user_id_status_idx`(`user_id`, `status`),
    INDEX `school_membership_school_id_role_idx`(`school_id`, `role`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rank_level` (
    `code` VARCHAR(191) NOT NULL,
    `role_family` ENUM('teacher', 'administrator') NOT NULL,
    `label_th` VARCHAR(191) NOT NULL,
    `sort_order` INTEGER NOT NULL,

    PRIMARY KEY (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `personnel_profile` (
    `id` CHAR(36) NOT NULL,
    `school_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `employee_code` VARCHAR(191) NULL,
    `full_name` VARCHAR(191) NOT NULL,
    `position_role` ENUM('teacher', 'administrator') NOT NULL,
    `rank_level_code` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',

    INDEX `personnel_profile_school_id_status_idx`(`school_id`, `status`),
    UNIQUE INDEX `personnel_profile_school_id_employee_code_key`(`school_id`, `employee_code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `framework_version` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `role_family` ENUM('teacher', 'administrator') NOT NULL,
    `legal_ref` VARCHAR(191) NOT NULL,
    `revision_year` INTEGER NOT NULL,
    `status` ENUM('draft', 'active', 'superseded') NOT NULL DEFAULT 'draft',
    `effective_from` DATE NOT NULL,
    `effective_to` DATE NULL,

    UNIQUE INDEX `framework_version_code_key`(`code`),
    INDEX `framework_version_role_family_status_idx`(`role_family`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `evaluation_domain` (
    `id` CHAR(36) NOT NULL,
    `framework_version_id` CHAR(36) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name_th` VARCHAR(191) NOT NULL,
    `sort_order` INTEGER NOT NULL,
    `part` ENUM('standards', 'challenge') NOT NULL,

    UNIQUE INDEX `evaluation_domain_framework_version_id_code_key`(`framework_version_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `indicator` (
    `id` CHAR(36) NOT NULL,
    `domain_id` CHAR(36) NOT NULL,
    `framework_version_id` CHAR(36) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name_th` VARCHAR(191) NOT NULL,
    `sort_order` INTEGER NOT NULL,
    `is_scored` BOOLEAN NOT NULL DEFAULT true,
    `indicator_kind` ENUM('standard', 'challenge', 'workload_gate') NOT NULL,
    `max_points` DECIMAL(6, 2) NULL,

    INDEX `indicator_domain_id_sort_order_idx`(`domain_id`, `sort_order`),
    UNIQUE INDEX `indicator_framework_version_id_code_key`(`framework_version_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `indicator_level_description` (
    `id` CHAR(36) NOT NULL,
    `indicator_id` CHAR(36) NOT NULL,
    `rank_level_code` VARCHAR(191) NOT NULL,
    `rubric_level` INTEGER NOT NULL,
    `expected_practice_th` TEXT NOT NULL,

    UNIQUE INDEX `indicator_level_description_indicator_id_rank_level_code_rub_key`(`indicator_id`, `rank_level_code`, `rubric_level`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `score_weight` (
    `id` CHAR(36) NOT NULL,
    `framework_version_id` CHAR(36) NOT NULL,
    `weight_key` VARCHAR(191) NOT NULL,
    `weight_value` DECIMAL(6, 2) NOT NULL,
    `notes` TEXT NULL,

    UNIQUE INDEX `score_weight_framework_version_id_weight_key_key`(`framework_version_id`, `weight_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `evidence_category` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `label_th` VARCHAR(191) NOT NULL,
    `allowed_mime_types` JSON NOT NULL,
    `max_byte_size` BIGINT NULL,
    `max_duration_seconds` INTEGER NULL,
    `required_for_dpa` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `evidence_category_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `evaluation_cycle` (
    `id` CHAR(36) NOT NULL,
    `school_id` CHAR(36) NOT NULL,
    `framework_version_id` CHAR(36) NOT NULL,
    `fiscal_year` INTEGER NOT NULL,
    `evaluation_kind` ENUM('pa', 'dpa') NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `status` ENUM('planned', 'open', 'closed') NOT NULL DEFAULT 'planned',
    `starts_on` DATE NOT NULL,
    `ends_on` DATE NOT NULL,
    `pa_uk_key` VARCHAR(120) NULL,

    INDEX `evaluation_cycle_school_id_fiscal_year_idx`(`school_id`, `fiscal_year`),
    UNIQUE INDEX `evaluation_cycle_pa_uk`(`pa_uk_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `evaluation_round` (
    `id` CHAR(36) NOT NULL,
    `cycle_id` CHAR(36) NOT NULL,
    `round_number` INTEGER NOT NULL,
    `purpose` VARCHAR(191) NOT NULL,
    `period_start` DATE NOT NULL,
    `period_end` DATE NOT NULL,
    `status` ENUM('planned', 'open', 'scoring', 'closed') NOT NULL DEFAULT 'planned',

    UNIQUE INDEX `evaluation_round_cycle_id_round_number_key`(`cycle_id`, `round_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `performance_agreement` (
    `id` CHAR(36) NOT NULL,
    `school_id` CHAR(36) NOT NULL,
    `cycle_id` CHAR(36) NOT NULL,
    `personnel_id` CHAR(36) NOT NULL,
    `form_variant` VARCHAR(191) NOT NULL,
    `status` ENUM('draft', 'submitted', 'acknowledged') NOT NULL DEFAULT 'draft',
    `submitted_at` DATETIME(3) NULL,

    UNIQUE INDEX `performance_agreement_cycle_id_personnel_id_key`(`cycle_id`, `personnel_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workload_declaration` (
    `id` CHAR(36) NOT NULL,
    `agreement_id` CHAR(36) NOT NULL,
    `round_id` CHAR(36) NOT NULL,
    `workload_met` BOOLEAN NOT NULL,
    `notes` TEXT NULL,
    `declared_by_user_id` CHAR(36) NOT NULL,
    `declared_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `workload_declaration_agreement_id_round_id_key`(`agreement_id`, `round_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agreement_challenge` (
    `id` CHAR(36) NOT NULL,
    `agreement_id` CHAR(36) NOT NULL,
    `indicator_id` CHAR(36) NOT NULL,
    `method_plan` TEXT NOT NULL,
    `quantitative_target` TEXT NULL,
    `qualitative_target` TEXT NULL,

    UNIQUE INDEX `agreement_challenge_agreement_id_indicator_id_key`(`agreement_id`, `indicator_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `evidence` (
    `id` CHAR(36) NOT NULL,
    `school_id` CHAR(36) NOT NULL,
    `owner_personnel_id` CHAR(36) NOT NULL,
    `uploaded_by_user_id` CHAR(36) NOT NULL,
    `category_id` CHAR(36) NOT NULL,
    `title` VARCHAR(300) NOT NULL,
    `description` TEXT NULL,
    `status` ENUM('draft', 'active', 'archived', 'rejected') NOT NULL DEFAULT 'draft',
    `captured_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    INDEX `evidence_school_id_owner_personnel_id_deleted_at_idx`(`school_id`, `owner_personnel_id`, `deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `evidence_file` (
    `id` CHAR(36) NOT NULL,
    `evidence_id` CHAR(36) NOT NULL,
    `storage_provider` ENUM('s3_compatible') NOT NULL DEFAULT 's3_compatible',
    `storage_uri` TEXT NOT NULL,
    `content_type` VARCHAR(191) NOT NULL,
    `byte_size` BIGINT NOT NULL,
    `checksum_sha256` VARCHAR(191) NOT NULL,
    `duration_seconds` INTEGER NULL,
    `original_filename` VARCHAR(255) NOT NULL,
    `scan_status` ENUM('pending', 'clean', 'blocked') NOT NULL DEFAULT 'pending',
    `uploaded_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `evidence_file_evidence_id_idx`(`evidence_id`),
    INDEX `evidence_file_scan_status_idx`(`scan_status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `outbox_event` (
    `id` CHAR(36) NOT NULL,
    `event_type` VARCHAR(191) NOT NULL,
    `schema_version` INTEGER NOT NULL DEFAULT 1,
    `school_id` CHAR(36) NULL,
    `actor_user_id` CHAR(36) NULL,
    `request_id` CHAR(36) NULL,
    `payload` JSON NOT NULL,
    `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `published_at` DATETIME(3) NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `last_error` TEXT NULL,

    INDEX `outbox_event_published_at_occurred_at_idx`(`published_at`, `occurred_at`),
    INDEX `outbox_event_event_type_published_at_idx`(`event_type`, `published_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `worker_job` (
    `id` CHAR(36) NOT NULL,
    `job_type` VARCHAR(191) NOT NULL,
    `payload` JSON NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `available_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `locked_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `last_error` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `worker_job_status_available_at_idx`(`status`, `available_at`),
    INDEX `worker_job_job_type_status_idx`(`job_type`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `evidence_indicator_mapping` (
    `id` CHAR(36) NOT NULL,
    `school_id` CHAR(36) NOT NULL,
    `evidence_id` CHAR(36) NOT NULL,
    `indicator_id` CHAR(36) NOT NULL,
    `cycle_id` CHAR(36) NULL,
    `mapping_source` ENUM('human', 'ai_suggested') NOT NULL DEFAULT 'human',
    `status` ENUM('suggested', 'confirmed', 'rejected', 'revoked') NOT NULL DEFAULT 'suggested',
    `rationale` TEXT NULL,
    `mapped_by_user_id` CHAR(36) NOT NULL,
    `confirmed_by_user_id` CHAR(36) NULL,
    `mapped_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `confirmed_at` DATETIME(3) NULL,
    `active_uk_key` VARCHAR(120) NULL,

    INDEX `evidence_indicator_mapping_indicator_id_status_idx`(`indicator_id`, `status`),
    INDEX `evidence_indicator_mapping_school_id_status_idx`(`school_id`, `status`),
    UNIQUE INDEX `evidence_indicator_mapping_active_uk`(`active_uk_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `evaluation_assignment` (
    `id` CHAR(36) NOT NULL,
    `school_id` CHAR(36) NOT NULL,
    `round_id` CHAR(36) NOT NULL,
    `evaluatee_personnel_id` CHAR(36) NOT NULL,
    `agreement_id` CHAR(36) NULL,
    `status` ENUM('pending', 'in_progress', 'completed', 'void') NOT NULL DEFAULT 'pending',

    INDEX `evaluation_assignment_school_id_status_idx`(`school_id`, `status`),
    UNIQUE INDEX `evaluation_assignment_round_id_evaluatee_personnel_id_key`(`round_id`, `evaluatee_personnel_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `committee_member` (
    `id` CHAR(36) NOT NULL,
    `assignment_id` CHAR(36) NOT NULL,
    `evaluator_user_id` CHAR(36) NOT NULL,
    `committee_role` ENUM('chair', 'member') NOT NULL,
    `seat_number` INTEGER NOT NULL,

    UNIQUE INDEX `committee_member_assignment_id_evaluator_user_id_key`(`assignment_id`, `evaluator_user_id`),
    UNIQUE INDEX `committee_member_assignment_id_seat_number_key`(`assignment_id`, `seat_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `indicator_score` (
    `id` CHAR(36) NOT NULL,
    `assignment_id` CHAR(36) NOT NULL,
    `indicator_id` CHAR(36) NOT NULL,
    `evaluator_user_id` CHAR(36) NOT NULL,
    `rubric_level` INTEGER NOT NULL,
    `points_awarded` DECIMAL(6, 2) NULL,
    `comment` TEXT NULL,
    `scored_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `indicator_score_assignment_id_evaluator_user_id_idx`(`assignment_id`, `evaluator_user_id`),
    UNIQUE INDEX `indicator_score_assignment_id_indicator_id_evaluator_user_id_key`(`assignment_id`, `indicator_id`, `evaluator_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `round_result` (
    `id` CHAR(36) NOT NULL,
    `assignment_id` CHAR(36) NOT NULL,
    `evaluator_user_id` CHAR(36) NOT NULL,
    `part1_percent` DECIMAL(5, 2) NOT NULL,
    `part2_percent` DECIMAL(5, 2) NOT NULL,
    `total_percent` DECIMAL(5, 2) NOT NULL,
    `passed_workload_gate` BOOLEAN NOT NULL,
    `passed_individual_threshold` BOOLEAN NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'computed',
    `computed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `round_result_assignment_id_evaluator_user_id_key`(`assignment_id`, `evaluator_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `report` (
    `id` CHAR(36) NOT NULL,
    `school_id` CHAR(36) NOT NULL,
    `cycle_id` CHAR(36) NOT NULL,
    `round_id` CHAR(36) NULL,
    `subject_personnel_id` CHAR(36) NOT NULL,
    `template_code` VARCHAR(191) NOT NULL,
    `status` ENUM('draft', 'pending_approval', 'approved', 'issued', 'superseded') NOT NULL DEFAULT 'draft',
    `payload` JSON NOT NULL,
    `generated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `report_school_id_cycle_id_idx`(`school_id`, `cycle_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `report_section_ref` (
    `id` CHAR(36) NOT NULL,
    `report_id` CHAR(36) NOT NULL,
    `evidence_id` CHAR(36) NULL,
    `mapping_id` CHAR(36) NULL,
    `section_key` VARCHAR(191) NOT NULL,
    `sort_order` INTEGER NOT NULL,

    INDEX `report_section_ref_report_id_section_key_idx`(`report_id`, `section_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `approval` (
    `id` CHAR(36) NOT NULL,
    `school_id` CHAR(36) NOT NULL,
    `report_id` CHAR(36) NOT NULL,
    `approver_user_id` CHAR(36) NOT NULL,
    `step_code` VARCHAR(191) NOT NULL,
    `decision` ENUM('pending', 'approved', 'rejected', 'returned') NOT NULL DEFAULT 'pending',
    `comment` TEXT NULL,
    `decided_at` DATETIME(3) NULL,

    INDEX `approval_report_id_decision_idx`(`report_id`, `decision`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_event` (
    `id` CHAR(36) NOT NULL,
    `school_id` CHAR(36) NULL,
    `actor_user_id` CHAR(36) NULL,
    `action` VARCHAR(191) NOT NULL,
    `entity_type` VARCHAR(191) NOT NULL,
    `entity_id` VARCHAR(191) NOT NULL,
    `before_state` JSON NULL,
    `after_state` JSON NULL,
    `request_id` CHAR(36) NULL,
    `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_event_school_id_occurred_at_idx`(`school_id`, `occurred_at`),
    INDEX `audit_event_entity_type_entity_id_idx`(`entity_type`, `entity_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `school` ADD CONSTRAINT `school_area_id_fkey` FOREIGN KEY (`area_id`) REFERENCES `area`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refresh_token` ADD CONSTRAINT `refresh_token_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user_account`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `school_membership` ADD CONSTRAINT `school_membership_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user_account`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `school_membership` ADD CONSTRAINT `school_membership_school_id_fkey` FOREIGN KEY (`school_id`) REFERENCES `school`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `school_membership` ADD CONSTRAINT `school_membership_area_id_fkey` FOREIGN KEY (`area_id`) REFERENCES `area`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `personnel_profile` ADD CONSTRAINT `personnel_profile_school_id_fkey` FOREIGN KEY (`school_id`) REFERENCES `school`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `personnel_profile` ADD CONSTRAINT `personnel_profile_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user_account`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `personnel_profile` ADD CONSTRAINT `personnel_profile_rank_level_code_fkey` FOREIGN KEY (`rank_level_code`) REFERENCES `rank_level`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `evaluation_domain` ADD CONSTRAINT `evaluation_domain_framework_version_id_fkey` FOREIGN KEY (`framework_version_id`) REFERENCES `framework_version`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `indicator` ADD CONSTRAINT `indicator_domain_id_fkey` FOREIGN KEY (`domain_id`) REFERENCES `evaluation_domain`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `indicator` ADD CONSTRAINT `indicator_framework_version_id_fkey` FOREIGN KEY (`framework_version_id`) REFERENCES `framework_version`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `indicator_level_description` ADD CONSTRAINT `indicator_level_description_indicator_id_fkey` FOREIGN KEY (`indicator_id`) REFERENCES `indicator`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `indicator_level_description` ADD CONSTRAINT `indicator_level_description_rank_level_code_fkey` FOREIGN KEY (`rank_level_code`) REFERENCES `rank_level`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `score_weight` ADD CONSTRAINT `score_weight_framework_version_id_fkey` FOREIGN KEY (`framework_version_id`) REFERENCES `framework_version`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `evaluation_cycle` ADD CONSTRAINT `evaluation_cycle_school_id_fkey` FOREIGN KEY (`school_id`) REFERENCES `school`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `evaluation_cycle` ADD CONSTRAINT `evaluation_cycle_framework_version_id_fkey` FOREIGN KEY (`framework_version_id`) REFERENCES `framework_version`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `evaluation_round` ADD CONSTRAINT `evaluation_round_cycle_id_fkey` FOREIGN KEY (`cycle_id`) REFERENCES `evaluation_cycle`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `performance_agreement` ADD CONSTRAINT `performance_agreement_school_id_fkey` FOREIGN KEY (`school_id`) REFERENCES `school`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `performance_agreement` ADD CONSTRAINT `performance_agreement_cycle_id_fkey` FOREIGN KEY (`cycle_id`) REFERENCES `evaluation_cycle`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `performance_agreement` ADD CONSTRAINT `performance_agreement_personnel_id_fkey` FOREIGN KEY (`personnel_id`) REFERENCES `personnel_profile`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workload_declaration` ADD CONSTRAINT `workload_declaration_agreement_id_fkey` FOREIGN KEY (`agreement_id`) REFERENCES `performance_agreement`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workload_declaration` ADD CONSTRAINT `workload_declaration_round_id_fkey` FOREIGN KEY (`round_id`) REFERENCES `evaluation_round`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workload_declaration` ADD CONSTRAINT `workload_declaration_declared_by_user_id_fkey` FOREIGN KEY (`declared_by_user_id`) REFERENCES `user_account`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agreement_challenge` ADD CONSTRAINT `agreement_challenge_agreement_id_fkey` FOREIGN KEY (`agreement_id`) REFERENCES `performance_agreement`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agreement_challenge` ADD CONSTRAINT `agreement_challenge_indicator_id_fkey` FOREIGN KEY (`indicator_id`) REFERENCES `indicator`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `evidence` ADD CONSTRAINT `evidence_school_id_fkey` FOREIGN KEY (`school_id`) REFERENCES `school`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `evidence` ADD CONSTRAINT `evidence_owner_personnel_id_fkey` FOREIGN KEY (`owner_personnel_id`) REFERENCES `personnel_profile`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `evidence` ADD CONSTRAINT `evidence_uploaded_by_user_id_fkey` FOREIGN KEY (`uploaded_by_user_id`) REFERENCES `user_account`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `evidence` ADD CONSTRAINT `evidence_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `evidence_category`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `evidence_file` ADD CONSTRAINT `evidence_file_evidence_id_fkey` FOREIGN KEY (`evidence_id`) REFERENCES `evidence`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `evidence_indicator_mapping` ADD CONSTRAINT `evidence_indicator_mapping_school_id_fkey` FOREIGN KEY (`school_id`) REFERENCES `school`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `evidence_indicator_mapping` ADD CONSTRAINT `evidence_indicator_mapping_evidence_id_fkey` FOREIGN KEY (`evidence_id`) REFERENCES `evidence`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `evidence_indicator_mapping` ADD CONSTRAINT `evidence_indicator_mapping_indicator_id_fkey` FOREIGN KEY (`indicator_id`) REFERENCES `indicator`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `evidence_indicator_mapping` ADD CONSTRAINT `evidence_indicator_mapping_cycle_id_fkey` FOREIGN KEY (`cycle_id`) REFERENCES `evaluation_cycle`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `evidence_indicator_mapping` ADD CONSTRAINT `evidence_indicator_mapping_mapped_by_user_id_fkey` FOREIGN KEY (`mapped_by_user_id`) REFERENCES `user_account`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `evidence_indicator_mapping` ADD CONSTRAINT `evidence_indicator_mapping_confirmed_by_user_id_fkey` FOREIGN KEY (`confirmed_by_user_id`) REFERENCES `user_account`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `evaluation_assignment` ADD CONSTRAINT `evaluation_assignment_school_id_fkey` FOREIGN KEY (`school_id`) REFERENCES `school`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `evaluation_assignment` ADD CONSTRAINT `evaluation_assignment_round_id_fkey` FOREIGN KEY (`round_id`) REFERENCES `evaluation_round`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `evaluation_assignment` ADD CONSTRAINT `evaluation_assignment_evaluatee_personnel_id_fkey` FOREIGN KEY (`evaluatee_personnel_id`) REFERENCES `personnel_profile`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `evaluation_assignment` ADD CONSTRAINT `evaluation_assignment_agreement_id_fkey` FOREIGN KEY (`agreement_id`) REFERENCES `performance_agreement`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `committee_member` ADD CONSTRAINT `committee_member_assignment_id_fkey` FOREIGN KEY (`assignment_id`) REFERENCES `evaluation_assignment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `committee_member` ADD CONSTRAINT `committee_member_evaluator_user_id_fkey` FOREIGN KEY (`evaluator_user_id`) REFERENCES `user_account`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `indicator_score` ADD CONSTRAINT `indicator_score_assignment_id_fkey` FOREIGN KEY (`assignment_id`) REFERENCES `evaluation_assignment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `indicator_score` ADD CONSTRAINT `indicator_score_indicator_id_fkey` FOREIGN KEY (`indicator_id`) REFERENCES `indicator`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `indicator_score` ADD CONSTRAINT `indicator_score_evaluator_user_id_fkey` FOREIGN KEY (`evaluator_user_id`) REFERENCES `user_account`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `round_result` ADD CONSTRAINT `round_result_assignment_id_fkey` FOREIGN KEY (`assignment_id`) REFERENCES `evaluation_assignment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `round_result` ADD CONSTRAINT `round_result_evaluator_user_id_fkey` FOREIGN KEY (`evaluator_user_id`) REFERENCES `user_account`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `report` ADD CONSTRAINT `report_school_id_fkey` FOREIGN KEY (`school_id`) REFERENCES `school`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `report` ADD CONSTRAINT `report_cycle_id_fkey` FOREIGN KEY (`cycle_id`) REFERENCES `evaluation_cycle`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `report` ADD CONSTRAINT `report_round_id_fkey` FOREIGN KEY (`round_id`) REFERENCES `evaluation_round`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `report` ADD CONSTRAINT `report_subject_personnel_id_fkey` FOREIGN KEY (`subject_personnel_id`) REFERENCES `personnel_profile`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `report_section_ref` ADD CONSTRAINT `report_section_ref_report_id_fkey` FOREIGN KEY (`report_id`) REFERENCES `report`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `report_section_ref` ADD CONSTRAINT `report_section_ref_evidence_id_fkey` FOREIGN KEY (`evidence_id`) REFERENCES `evidence`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `report_section_ref` ADD CONSTRAINT `report_section_ref_mapping_id_fkey` FOREIGN KEY (`mapping_id`) REFERENCES `evidence_indicator_mapping`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `approval` ADD CONSTRAINT `approval_school_id_fkey` FOREIGN KEY (`school_id`) REFERENCES `school`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `approval` ADD CONSTRAINT `approval_report_id_fkey` FOREIGN KEY (`report_id`) REFERENCES `report`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `approval` ADD CONSTRAINT `approval_approver_user_id_fkey` FOREIGN KEY (`approver_user_id`) REFERENCES `user_account`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

