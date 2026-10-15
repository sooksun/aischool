# Contract-First Development Policy

Updated 2026-07-17 (SEIP-ARCH-002) — approval flow rewritten for single-agent mode (ADR-0004).

## Protected Contracts

| File | Version | Surface |
|---|---|---|
| `openapi.yaml` | **3.1.0** (CCR-016 report approval; CCR-015 agreements, BREAKING; CCR-014 onboarding; …) | HTTP API — the only web↔api interface |
| `events.yaml` | **1.3.0** | Domain events (outbox-delivered) |
| `permissions.yaml` | **1.7.0** | Roles, tenancy rule, per-operation matrix |
| `error-codes.yaml` | **1.6.0** | Stable error codes + response shape |

Reports ship as **structured JSON + section refs** (CCR-005) and **on-demand PA form PDF** (CCR-007). Pixel-perfect ก.ค.ศ. plates remain deferred (`x-deferred.official-paper-signature-fidelity`).

## Rule

No implementation may invent fields outside an approved contract. Types are generated from `openapi.yaml`, never hand-written (ADR-0001).

## Versioning

- **Additive** (new endpoint, new optional field, new error code, new event) → minor bump `1.x`, no CCR ceremony required, but the change is called out in the task's close-out.
- **Breaking** (remove/retype a field, change an error code's meaning, rename an event, tighten a required constraint) → **CCR required** + major bump `2.0` + migration plan for affected modules.
- The CI gate `Gate: contract compatibility` runs `scripts/security/check-contract-compatibility.mjs` (`oasdiff breaking` under the hood) on every push and PR: a breaking change fails the build **unless** `info.version`'s major component was actually bumped in the same change — that's the automated form of "version bump and CCR land in the same PR". A breaking change with no major bump fails regardless of intent.

- **Open enums (CCR-028, owner decision A, 2026-10-14).** A response enum whose schema carries `x-seip-open-enum: true` may gain a value in a minor version. Its description must tell clients to accept a value they do not know. The gate excuses only oasdiff's `response-property-enum-value-added` / `response-body-enum-value-added` whose source line lies inside that schema. Any other change to it (a removed or renamed value, a value in a request) is still breaking. Marking a schema open is a policy change that needs the owner. Open today: `NotificationKind` (CCR-028) and `Role` (CCR-029).

## Change flow (single-agent, ADR-0004)

1. Claude drafts the change and records the reason in a CCR under `docs/reviews/CCR-NNN-*.md`.
2. Claude self-reviews against: backend feasibility (data model), frontend usability (UX field trace), security baseline §2/§3, and error/permission consistency — the four checks the old multi-agent loop distributed across Codex/Antigravity/Grok.
3. **User approves** any breaking change before it merges. Additive changes proceed and are reported.
4. Version bumped, generated types refreshed by the gate, CCR marked APPLIED with the date.

## History

| CCR | Change | Status |
|---|---|---|
| CCR-001 | Publish contracts v0.1 (they did not exist) | RESOLVED 2026-07-17 |
| CCR-002 | `CurrentUser.personnel` object; evidence draft→active lifecycle; `duration_seconds` nullable | APPLIED 2026-07-17 (pre-lock) |
| CCR-003 | Current-school resolution for multi-membership users (`X-School-Id` header) — clarification, no schema change | APPLIED 2026-07-17 |
| CCR-004 | `FileUploadComplete` gains required `content_type`/`byte_size`/`original_filename` | **BREAKING**, v1.0.0→2.0.0, APPLIED 2026-07-17 — see CCR doc for the self-correction (first shipped as an uncommitted code comment claiming "additive", caught by actually running `oasdiff`, not by inspection |
| CCR-009 | List `scan_status` + `AssignmentDetail.framework_version_id` | APPLIED 2026-07-18 (v2.4.0) |
| CCR-010 | Lazy `getEvidenceFileDownloadUrl`; no presign on getEvidence | APPLIED 2026-07-18 (v2.5.0) |
| CCR-011 | `ReportDetail.payload` → typed `ReportPayload` (schema_version=1) | APPLIED 2026-07-18 (v2.6.0) |
| CCR-012 | `ScanStatus` gains `unscanned`; the filename-matching "scanner" deleted | APPLIED 2026-07-18 (v2.7.0) |
| CCR-013 | `AssignmentDetail.evaluatee_rank_level_code` — makes the seeded rubric text usable | APPLIED 2026-07-18 (v2.8.0) |
| CCR-014 | Onboarding: listPersonnel/listMembers/inviteMember/endMembership + unauthenticated acceptInvite. Bootstrap admin and school provisioning stay operator CLIs (no new role). Closes SEIP-BLOCK-001 — before this, no operation created a user and a fresh install could not be logged into. | APPLIED 2026-07-19 (v2.9.0; permissions 1.5.0, error-codes 1.4.0) |
| CCR-015 | Performance agreements (แบบ PA1) + ประเด็นท้าทาย: 6 operations, `AssignmentDetail.challenge`. **BREAKING** — `AssignmentCreate.agreement_id` removed (unvalidated client input for a value the server can derive). Closes SEIP-BLOCK-002 — before this no score could be submitted at all, and the committee scored the 40% ส่วนที่ 2 without ever seeing the method and targets it rates. | APPLIED 2026-07-19 (**v3.0.0**; permissions 1.6.0, error-codes 1.5.0) |
| CCR-016 | Report approval: approveReport/returnReport/listReportApprovals, `ReportDetail.approvals`, `report.approved` out of the events `deferred:` block. Approval requires the round closed (RPT-003) — scores stay mutable until then, so signing earlier yields a document its own data can contradict. Closes SEIP-BLOCK-003, the last of the three audit blockers. | APPLIED 2026-07-20 (v3.1.0; permissions 1.7.0, error-codes 1.6.0, events 1.3.0) |
| CCR-017 | **Contract 4.0.0** — person-owned portfolio, two-tier confirmation, async in-country AI suggestions, resumable uploads, sync, notifications, devices, coverage, committee evidence view, DPA/PA2 exports; scoring + report approval tagged `x-seip-feature: v2`. 87 oasdiff breaking items, all on evidence/mapping/upload. Applied to `openapi.yaml` 4.0.0 by SEIP-P1-001 (the draft file was removed). Also fixes the compatibility gate passing when oasdiff could not run. | **APPROVED 2026-10-12** (owner) — application: SEIP-P1-001 |
| CCR-018 | **Contract 4.1.0** — web sign-in through Keycloak behind a BFF: webLogin / webCallback / webLogout, `webSession` cookie scheme with `X-CSRF-Token`, AUTH-007 (permissions 2.1.0, error-codes 2.1.0). oasdiff: no breaking changes from 4.0.0. | **Additive**, APPLIED 2026-10-13 (SEIP-P1-004) |
| CCR-019 | **Contract 4.2.0**: importMembers, bulk onboarding with a dry run and per-row results (FR-091); permissions 2.2.0. oasdiff: no breaking changes from 4.1.0. | **Additive**, APPLIED 2026-10-13 (SEIP-P1-008) |
| CCR-020 | **Contract 4.3.0**: `CurrentUser.memberships` lists only memberships in effect and adds `school_name` (FR-019 school picker). oasdiff: no breaking changes from 4.2.0. | **Additive**, APPLIED 2026-10-13 (SEIP-P1-009) |
| CCR-021 | **Contract 4.4.0 / permissions 2.3.0**: area_admin lists, opens, renames and closes the schools of its own area and appoints school_admins (`area_admin_writes` exception, min_acr 2). A closed school ends its members' access. oasdiff: no breaking changes from 4.3.0. | **Policy change**, APPROVED + APPLIED 2026-10-13 (SEIP-P1-010) |
| CCR-022 | **Contract 4.5.0 / permissions 2.4.0 / error-codes 2.2.0**: issuePasswordReset (school_admin, min_acr 2) and completePasswordReset (unauthenticated, AUTH-008). A redeemed reset ends every session and sets the SEIP ID password (FR-099). oasdiff: no breaking changes from 4.4.0. | **Additive**, APPLIED 2026-10-13 (SEIP-P1-013) |
| CCR-023 | **Contract 4.6.0 / permissions 2.5.0**: confirmMyPersonnel, requestPersonnelCorrection (self-scoped), updatePersonnel (school_admin, min_acr 2); PersonnelSummary / CurrentUser.personnel gain rank_since, confirmed_at, correction_note (FR-099a). | **Additive**, APPLIED 2026-10-13 (SEIP-P1-014) |
| CCR-024 | **Contract 4.7.0 / permissions 2.6.0**: Evidence.owner_accepted_at + acceptEvidence (owner only); items uploaded on someone's behalf cannot be mapped until accepted; EvidencePatch.origin_school_id moves an item to another of the owner's schools in the same สพท.; CurrentUser.person_id (FR-019). | **Additive**, APPLIED 2026-10-13 (SEIP-P1-015) |
| CCR-025 | **Permissions 2.7.0** (no openapi change): area_admin acknowledges school administrators' agreements, and only those (OQ-31); the origin school keeps a moved teacher's evidence only where its own evaluation mapped it (OQ-12). | **Policy change**, DECIDED BY THE OWNER 2026-10-13, APPLIED (SEIP-P1-016) |
| CCR-026 | **Contract 4.8.0 / permissions 2.8.0**: findMyDuplicateFiles (self-scoped, verified bytes only) and EvidenceFile.duplicate_of_evidence_id set by the worker after re-hash (FR-012). | **Additive**, APPLIED 2026-10-13 (SEIP-P2-001) |
| CCR-027 | **Contract 4.9.0**: evidence injection flags and clearInjectionFlag (school_admin, not the owner) (FR-028). | **Additive**, APPLIED 2026-10-14 |
| CCR-028 | **Contract 4.10.0 / permissions 2.10.0 / events 2.1.0**: committee comments and requests per indicator; the evaluatee replies (FR-064). **4.11.0 / events 2.2.0**: `NotificationKind` becomes an open enum and gains `committee_comment`; the notification consumer joins `assignment.comment.created`. | **Additive**, APPLIED 2026-10-14; open-enum rule **DECIDED BY THE OWNER 2026-10-14 (option A)** |
| CCR-029 | **Contract 4.12.0 / permissions 2.11.0 / events 2.3.0**: an area-scoped `dpo` role (appointDpo, listAreaDpos — area_admin) and the data-subject request register (createSubjectRequest / listSubjectRequests / getSubjectRequest — own; decideSubjectRequest — dpo, min_acr 2) (FR-117). `Role` becomes an open enum. | **Policy change**, DECIDED BY THE OWNER 2026-10-15, APPLIED (SEIP-P5-002) |
