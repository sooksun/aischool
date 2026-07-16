# Entity Dictionary — SEIP-DB-000

Status: Design proposal  
Companion: [`erd.mmd`](./erd.mmd), [`README.md`](./README.md)  
Constraint intentions below are **specifications for SEIP-DB-001 tests**, not implemented SQL.

**Legend — PII class**

| Class | Meaning |
|---|---|
| `none` | No personal data |
| `indirect` | May identify via join (IDs, roles) |
| `direct` | Names, emails, employee codes |
| `sensitive` | Evaluation scores, comments, evidence content about persons/learners |

**Legend — retention (intent)**

| Code | Intent |
|---|---|
| `account-life` | While account/school membership active + legal hold |
| `cycle+N` | Evaluation cycle end + N years (N TBD with school policy; default proposal N=5) |
| `evidence+N` | Same as cycle unless linked to open DPA; then max(cycle+N, dpa_hold) |
| `audit-long` | Longer than operational data (proposal: 7 years or legal minimum) |
| `ref-data` | While framework version referenced |

---

## 1. Tenancy & identity

### 1.1 `Area`

| | |
|---|---|
| **Purpose** | Education service area (or equivalent) for multi-school / area-admin scope. |
| **Key fields** | `id`, `code` UK, `name` |
| **Relationships** | 1→N `School` |
| **Constraints** | `code` unique; non-empty name |
| **PII / retention** | none / ref-data |

### 1.2 `School`

| | |
|---|---|
| **Purpose** | Tenant boundary for nearly all operational data. |
| **Key fields** | `id`, `code` UK, `name`, `area_id?`, `status` |
| **Relationships** | N←1 `Area`; 1→N memberships, personnel, cycles, evidence, reports |
| **Constraints** | `code` unique globally; `status ∈ {active, inactive}` |
| **PII / retention** | none (org data) / account-life |

### 1.3 `UserAccount`

| | |
|---|---|
| **Purpose** | Login identity (auth subject). Separate from personnel employment record. |
| **Key fields** | `id`, `email` UK, `display_name`, `status`, `created_at` |
| **Relationships** | 1→N `SchoolMembership`; optional 1→N `PersonnelProfile` |
| **Constraints** | email unique, normalized lowercase; `status ∈ {active, disabled, invited}` |
| **PII / retention** | direct / account-life |

### 1.4 `SchoolMembership`

| | |
|---|---|
| **Purpose** | Role of a user within a school (or area scope). Enforces school-scoped tenancy. |
| **Key fields** | `id`, `school_id?`, `user_id`, `role`, `membership_scope`, `area_id?`, `effective_from`, `effective_to?`, `status` |
| **Relationships** | N→1 `UserAccount`; N→1 `School` when scope=school |
| **Constraints** | `role ∈ {teacher, director, deputy, evaluator, school_admin, area_admin}`; if `membership_scope=school` then `school_id NOT NULL`; if `area` then `area_id NOT NULL`; no overlapping active membership for same `(user_id, school_id, role)` |
| **PII / retention** | indirect / account-life |

---

## 2. Personnel

### 2.1 `RankLevel`

| | |
|---|---|
| **Purpose** | Reference for วิทยฐานะ / expected-practice tier (Execute & Learn → Create an Impact). |
| **Key fields** | `code` PK, `role_family`, `label_th`, `sort_order` |
| **Relationships** | referenced by `PersonnelProfile`, `IndicatorLevelDescription` |
| **Constraints** | `role_family ∈ {teacher, administrator}`; `code` stable string |
| **PII / retention** | none / ref-data |

### 2.2 `PersonnelProfile`

| | |
|---|---|
| **Purpose** | Evaluatee / evidence owner as school staff (ครู or ผู้บริหาร). |
| **Key fields** | `id`, `school_id`, `user_id`, `employee_code`, `full_name`, `position_role`, `rank_level_code`, `status` |
| **Relationships** | N→1 `School`, `UserAccount`, `RankLevel`; 1→N agreements, evidence, assignments, reports |
| **Constraints** | UK `(school_id, employee_code)` where employee_code not null; `position_role ∈ {teacher, administrator}`; active profile must have active school membership with compatible role |
| **PII / retention** | direct / account-life |

---

## 3. Framework (versioned taxonomy — Protected Artifact data)

### 3.1 `FrameworkVersion`

| | |
|---|---|
| **Purpose** | Versioned indicator set (ว9/2564 teacher, ว10/2564 administrator, future revisions). |
| **Key fields** | `id`, `code` UK, `role_family`, `legal_ref`, `revision_year`, `status`, `effective_from`, `effective_to?` |
| **Relationships** | 1→N domains, score weights, cycles |
| **Constraints** | at most one `status=active` per `(role_family)` at a time (or allow multiple with explicit cycle pin); `code` immutable after seed |
| **PII / retention** | none / ref-data |

### 3.2 `EvaluationDomain` (ด้าน)

| | |
|---|---|
| **Purpose** | Grouping of indicators (ด้านที่ 1–3 teacher / 1–5 admin; challenge part). |
| **Key fields** | `id`, `framework_version_id`, `code`, `name_th`, `sort_order`, `part` |
| **Relationships** | N→1 `FrameworkVersion`; 1→N `Indicator` |
| **Constraints** | UK `(framework_version_id, code)`; `part ∈ {standards, challenge}` |
| **PII / retention** | none / ref-data |

### 3.3 `Indicator` (ตัวชี้วัด)

| | |
|---|---|
| **Purpose** | Single indicator or challenge item or workload gate definition. |
| **Key fields** | `id`, `domain_id`, `code`, `name_th`, `sort_order`, `is_scored`, `indicator_kind` |
| **Relationships** | N→1 domain; 1→N level descriptions, mappings, scores |
| **Constraints** | UK `(framework_version via domain, code)` — enforce via composite or generated `framework_version_id` denorm; `indicator_kind ∈ {standard, challenge, workload_gate}`; workload_gate rows: `is_scored=false` |
| **Seed intent** | Teacher: T-1.1…T-3.3 + T-C.1, T-C.2.1, T-C.2.2 (+ workload gate row). Admin: A-1.1…A-5.2 + challenge items + workload gate. |
| **PII / retention** | none / ref-data |

### 3.4 `IndicatorLevelDescription`

| | |
|---|---|
| **Purpose** | Per-วิทยฐานะ expected practice text for each rubric level (data, not hard-coded). |
| **Key fields** | `id`, `indicator_id`, `rank_level_code`, `rubric_level`, `expected_practice_th` |
| **Relationships** | N→1 `Indicator`, `RankLevel` |
| **Constraints** | UK `(indicator_id, rank_level_code, rubric_level)`; `rubric_level ∈ {1,2,3,4}` |
| **PII / retention** | none / ref-data |

### 3.5 `ScoreWeight`

| | |
|---|---|
| **Purpose** | Framework-configurable weights (60/40, 20/10/10, etc.). |
| **Key fields** | `id`, `framework_version_id`, `weight_key`, `weight_value`, `notes` |
| **Relationships** | N→1 `FrameworkVersion` |
| **Constraints** | UK `(framework_version_id, weight_key)`; `weight_value > 0`; application validates part weights sum to 1.0 |
| **PII / retention** | none / ref-data |

### 3.6 `EvidenceCategory`

| | |
|---|---|
| **Purpose** | Framework-named evidence classes with technical validation metadata. |
| **Key fields** | `id`, `code` UK, `label_th`, `allowed_mime_csv`, `max_duration_seconds?`, `required_for_dpa` |
| **Seed intent** | `lesson_plan_pdf`, `teaching_video_mp4`, `problem_inspiration_video_mp4` (≤600s), `learner_outcome_digital`, `academic_work_pdf` |
| **Constraints** | `code` unique; if video category, `max_duration_seconds` recommended |
| **PII / retention** | none / ref-data |

---

## 4. Cycles, rounds, agreements

### 4.1 `EvaluationCycle`

| | |
|---|---|
| **Purpose** | Fiscal-year (or DPA request) evaluation container for a school under a framework version. |
| **Key fields** | `id`, `school_id`, `framework_version_id`, `fiscal_year`, `evaluation_kind`, `title`, `status`, `starts_on`, `ends_on` |
| **Relationships** | 1→N rounds, agreements, reports; N→1 framework |
| **Constraints** | UK `(school_id, fiscal_year, evaluation_kind, framework_version_id)` for PA; DPA may allow multiple with distinct titles; `evaluation_kind ∈ {pa, dpa}`; `status ∈ {planned, open, closed}`; `starts_on ≤ ends_on` |
| **PII / retention** | none / cycle+N |

### 4.2 `EvaluationRound`

| | |
|---|---|
| **Purpose** | Configurable round 1..n within a cycle (PA formal vs salary-linked, etc.). |
| **Key fields** | `id`, `cycle_id`, `round_number`, `purpose`, `period_start`, `period_end`, `status` |
| **Relationships** | N→1 cycle; 1→N workload declarations, assignments |
| **Constraints** | UK `(cycle_id, round_number)`; `round_number ≥ 1`; `period_start ≤ period_end`; `status ∈ {planned, open, scoring, closed}`; CHECK: count of rounds is data-driven (no max=2 in schema) |
| **PII / retention** | none / cycle+N |

### 4.3 `PerformanceAgreement`

| | |
|---|---|
| **Purpose** | PA1-style agreement for one personnel in a cycle. |
| **Key fields** | `id`, `school_id`, `cycle_id`, `personnel_id`, `form_variant`, `status`, `submitted_at?` |
| **Relationships** | N→1 cycle, personnel; 1→N challenges, workload rows, assignments |
| **Constraints** | UK `(cycle_id, personnel_id)` for PA; `form_variant ∈ {PA1_s, PA1_bs, …}`; personnel.school_id = agreement.school_id |
| **PII / retention** | indirect + contents may be sensitive / cycle+N |

### 4.4 `WorkloadDeclaration` (ภาระงาน gate)

| | |
|---|---|
| **Purpose** | Boolean gate separate from scored indicators. |
| **Key fields** | `id`, `agreement_id`, `round_id`, `workload_met`, `notes?`, `declared_by_user_id`, `declared_at` |
| **Relationships** | N→1 agreement, round |
| **Constraints** | UK `(agreement_id, round_id)`; `workload_met` boolean NOT NULL once declared |
| **PII / retention** | sensitive (employment evaluation) / cycle+N |

### 4.5 `AgreementChallenge` (ประเด็นท้าทาย plan)

| | |
|---|---|
| **Purpose** | Subject’s planned challenge method/targets for ส่วนที่ 2. |
| **Key fields** | `id`, `agreement_id`, `indicator_id`, `method_plan`, `quantitative_target`, `qualitative_target` |
| **Relationships** | N→1 agreement; N→1 challenge `Indicator` |
| **Constraints** | UK `(agreement_id, indicator_id)`; indicator must be `indicator_kind=challenge` under agreement’s framework |
| **PII / retention** | sensitive / cycle+N |

---

## 5. Evidence (upload once)

### 5.1 `Evidence`

| | |
|---|---|
| **Purpose** | Logical evidence item owned by personnel; reusable across indicators and reports. |
| **Key fields** | `id`, `school_id`, `owner_personnel_id`, `uploaded_by_user_id`, `category_id`, `title`, `description?`, `status`, `captured_at?`, `created_at`, `deleted_at?` |
| **Relationships** | 1→N files; 1→N mappings; cited by report section refs |
| **Constraints** | owner.school_id = evidence.school_id; `status ∈ {draft, active, archived, rejected}`; soft-delete via `deleted_at` |
| **PII / retention** | **sensitive** (may include learner data) / evidence+N |

### 5.2 `EvidenceFile`

| | |
|---|---|
| **Purpose** | Physical file metadata; bytes in object storage (OPEN-4). |
| **Key fields** | `id`, `evidence_id`, `storage_provider`, `storage_uri`, `content_type`, `byte_size`, `checksum_sha256`, `duration_seconds?`, `original_filename`, `scan_status`, `uploaded_at` |
| **Relationships** | N→1 `Evidence` (usually 1:1 for MVP; 1:N allows multi-part) |
| **Constraints** | `byte_size ≥ 0`; `storage_uri` NOT NULL; `scan_status ∈ {pending, clean, blocked}`; if category has `max_duration_seconds`, CHECK `duration_seconds ≤ max` at app layer; mime must be in category allow-list |
| **PII / retention** | sensitive (filename + content) / evidence+N; binary GC after metadata retention policy |

---

## 6. Governed mappings (many-to-many)

### 6.1 `EvidenceIndicatorMapping`

| | |
|---|---|
| **Purpose** | Governed M:N link evidence ↔ indicator; supports human confirm and future AI suggestions without duplicating files. |
| **Key fields** | `id`, `school_id`, `evidence_id`, `indicator_id`, `cycle_id?`, `mapping_source`, `status`, `mapped_by_user_id`, `confirmed_by_user_id?`, `rationale?`, `mapped_at`, `confirmed_at?` |
| **Relationships** | N→1 evidence, indicator; optional cycle scope; referenced by reports |
| **Constraints** | UK active mapping `(evidence_id, indicator_id, cycle_id)` where `status ∈ {suggested, confirmed}` (partial unique index / exclusion); `mapping_source ∈ {human, ai_suggested}`; `status ∈ {suggested, confirmed, rejected, revoked}`; confirmed requires `confirmed_by_user_id` + `confirmed_at`; evidence and indicator frameworks must be compatible with cycle when cycle set |
| **Business rule** | Reports and scoring **reuse** evidence through confirmed mappings; no file copy per report |
| **PII / retention** | sensitive / cycle+N |

---

## 7. Committee & scores

### 7.1 `EvaluationAssignment`

| | |
|---|---|
| **Purpose** | Evaluation instance for one evaluatee in one round. |
| **Key fields** | `id`, `school_id`, `round_id`, `evaluatee_personnel_id`, `agreement_id`, `status` |
| **Relationships** | 1→N committee members, indicator scores, challenge scores, round results |
| **Constraints** | UK `(round_id, evaluatee_personnel_id)`; status ∈ `{pending, in_progress, completed, void}` |
| **PII / retention** | indirect / cycle+N |

### 7.2 `CommitteeMember`

| | |
|---|---|
| **Purpose** | Exactly the evaluators assigned (framework: 3 members). |
| **Key fields** | `id`, `assignment_id`, `evaluator_user_id`, `committee_role`, `seat_number` |
| **Relationships** | N→1 assignment, user |
| **Constraints** | UK `(assignment_id, evaluator_user_id)`; UK `(assignment_id, seat_number)`; `seat_number ∈ {1,2,3}`; `committee_role ∈ {chair, member}`; app/CHECK: count of members = 3 when assignment enters scoring (stated intent for DB-001 tests) |
| **PII / retention** | indirect / cycle+N |

### 7.3 `IndicatorScore`

| | |
|---|---|
| **Purpose** | **Per-evaluator** score for one standard indicator (ส่วนที่ 1). Grain: (assignment, indicator, evaluator). |
| **Key fields** | `id`, `assignment_id`, `indicator_id`, `evaluator_user_id`, `rubric_level`, `points_awarded?`, `comment?`, `scored_at` |
| **Relationships** | N→1 assignment, indicator, evaluator user |
| **Constraints** | UK `(assignment_id, indicator_id, evaluator_user_id)`; `rubric_level ∈ {1,2,3,4}`; evaluator must be a `CommitteeMember` of assignment; indicator `indicator_kind=standard`; immutability after round `closed` (app rule) |
| **PII / retention** | **sensitive** / cycle+N |

### 7.4 `ChallengeScore`

| | |
|---|---|
| **Purpose** | Per-evaluator score for challenge items (T-C.* / admin equivalents); points map level→% of item max (4=100%…1=25%). |
| **Key fields** | same grain as IndicatorScore |
| **Constraints** | UK `(assignment_id, indicator_id, evaluator_user_id)`; indicator `indicator_kind=challenge` |
| **PII / retention** | sensitive / cycle+N |

### 7.5 `RoundResult`

| | |
|---|---|
| **Purpose** | Per-evaluator rollup: part1/part2/total %, workload gate, individual ≥70% flag. |
| **Key fields** | `id`, `assignment_id`, `evaluator_user_id`, `part1_percent`, `part2_percent`, `total_percent`, `passed_workload_gate`, `passed_individual_threshold`, `status`, `computed_at` |
| **Constraints** | UK `(assignment_id, evaluator_user_id)`; `passed_individual_threshold = (total_percent ≥ 70)` derived or CHECK; overall pass requires **every** evaluator true (business rule, not a single row) |
| **PII / retention** | sensitive / cycle+N |

---

## 8. Reports & approvals

### 8.1 `Report`

| | |
|---|---|
| **Purpose** | Generated/issued form instance (PA1/PA2/PA3 × ส/บส). Payload is structured data; official layout is a Protected Artifact. |
| **Key fields** | `id`, `school_id`, `cycle_id`, `round_id?`, `subject_personnel_id`, `template_code`, `status`, `payload` (JSON), `generated_at` |
| **Constraints** | `template_code` controlled vocabulary; `status ∈ {draft, pending_approval, approved, issued, superseded}` |
| **PII / retention** | sensitive / cycle+N |

### 8.2 `ReportSectionRef`

| | |
|---|---|
| **Purpose** | Cites evidence/mappings used in a report **by reference** (no binary duplication). |
| **Key fields** | `id`, `report_id`, `evidence_id?`, `mapping_id?`, `section_key`, `sort_order` |
| **Constraints** | at least one of evidence_id or mapping_id OR section is narrative-only; FK integrity to existing evidence/mapping |
| **PII / retention** | indirect / cycle+N |

### 8.3 `Approval`

| | |
|---|---|
| **Purpose** | Approval workflow steps on a report (or future on assignment). |
| **Key fields** | `id`, `school_id`, `report_id`, `approver_user_id`, `step_code`, `decision`, `comment?`, `decided_at?` |
| **Constraints** | `decision ∈ {pending, approved, rejected, returned}`; when not pending, `decided_at NOT NULL` |
| **PII / retention** | sensitive / cycle+N |

---

## 9. Audit

### 9.1 `AuditEvent`

| | |
|---|---|
| **Purpose** | Append-only history of mutating actions across the system. |
| **Key fields** | `id`, `school_id?`, `actor_user_id?`, `action`, `entity_type`, `entity_id`, `before_state`, `after_state`, `request_id?`, `occurred_at` |
| **Relationships** | logical only (no FK cascade from domain rows — survives entity hard-delete) |
| **Constraints** | **no UPDATE/DELETE** granted to app role (DB privileges in SEIP-DB-001); `occurred_at` default now; index `(school_id, occurred_at)`, `(entity_type, entity_id)` |
| **PII / retention** | may contain PII snapshots — minimise fields in before/after; **audit-long** |

---

## 10. Cross-cutting constraint intentions (for SEIP-DB-001)

1. **Tenant isolation:** every operational query filters `school_id`; FKs that cross school are forbidden (composite FK or triggers).
2. **Framework pin:** `EvaluationCycle.framework_version_id` freezes taxonomy for that cycle; changing global active framework does not rewrite historical cycles.
3. **Mapping governance:** only `status=confirmed` mappings are eligible for official report inclusion (app rule).
4. **Score immutability:** when `EvaluationRound.status=closed`, reject writes to scores/results.
5. **Committee completeness:** scoring endpoints require 3 `CommitteeMember` rows.
6. **Workload gate:** `RoundResult.passed_workload_gate` false ⇒ overall fail regardless of percent.
7. **Individual threshold:** pass requires each evaluator’s `passed_individual_threshold` true (≥70%).
8. **Evidence reuse:** `Report` must not store file bytes; only `ReportSectionRef` + mappings.
9. **Soft delete:** `Evidence.deleted_at` hides from default lists; audit event required.
10. **AI mapping:** `mapping_source=ai_suggested` allowed in schema; AI pipeline tables deferred (Sprint 2).

---

## 11. Entity checklist (completeness vs work order)

| Domain theme | Entities |
|---|---|
| School | `Area`, `School` |
| Users | `UserAccount`, `SchoolMembership` |
| Personnel | `PersonnelProfile`, `RankLevel` |
| Configurable cycles/rounds | `EvaluationCycle`, `EvaluationRound` |
| Indicators (versioned) | `FrameworkVersion`, `EvaluationDomain`, `Indicator`, `IndicatorLevelDescription`, `ScoreWeight` |
| Evidence | `Evidence`, `EvidenceFile`, `EvidenceCategory` |
| Evidence↔indicator M:N | `EvidenceIndicatorMapping` |
| Reports | `Report`, `ReportSectionRef` |
| Approvals | `Approval` |
| Audit/history | `AuditEvent` (+ status fields on domain rows) |
| PA extras | `PerformanceAgreement`, `WorkloadDeclaration`, `AgreementChallenge` |
| Scoring | `EvaluationAssignment`, `CommitteeMember`, `IndicatorScore`, `ChallengeScore`, `RoundResult` |
