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
