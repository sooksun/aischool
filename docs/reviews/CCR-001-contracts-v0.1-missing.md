# Contract Change Request: CCR-001

## Requested By
codex (SEIP-DB-000)

## Contract Affected
All protected contracts at v0.1 (draft), expected paths:

- `docs/contracts/openapi.yaml`
- `docs/contracts/events.yaml`
- `docs/contracts/permissions.yaml`
- `docs/contracts/error-codes.yaml`

## Reason
SEIP-DB-000 acceptance criterion 5 requires a **backend-feasibility verdict on contracts v0.1**.  
As of 2026-07-16 those files **do not exist**. Only `docs/contracts/contract-policy.md` is present.

Per `contract-policy.md` and task-board dependency, contracts are produced by **SEIP-ARCH-001** (currently `blocked` on SEIP-OPS-001).  
Codex must not invent OpenAPI paths, DTO fields, error codes, or events.

## Proposed Change
1. Complete **SEIP-ARCH-001** and publish contracts v0.1 draft covering at minimum:
   - Evidence upload/list/detail
   - PA cycle + round configuration (1..n rounds)
   - Indicator taxonomy read (framework → ด้าน → ตัวชี้วัด)
   - Evidence↔indicator mapping CRUD (human-confirmed)
   - Committee scoring (per-evaluator records; ≥70% documented as business rule)
   - Permissions: roles + school-scoped tenancy
   - Error codes for auth, validation, upload constraints (mime/size/duration)
   - Domain events for evidence lifecycle
2. Re-open or extend SEIP-DB-000 feasibility (or a short follow-up task) so Codex can file **field-level** CCRs if any endpoint is impractical.
3. Until then, treat data model in `docs/architecture/data-model/**` as **domain design only**, not an API contract.

## Breaking Change
N/A — contracts have not been published yet. This CCR is a **missing-artifact** request, not a breaking change to a locked version.

## Affected Modules
- SEIP-DB-000 (feasibility incomplete)
- SEIP-UI-000 (frontend cannot trace UI fields to contract fields)
- SEIP-QA-002 (cannot prove mutual consistency)
- SEIP-DB-001 / SEIP-UI-001 (Sprint 1 blocked by Definition of Ready)

## Migration Plan
No data migration. Process only:

1. Claude delivers SEIP-ARCH-001 artifacts.
2. Codex runs feasibility against real YAML.
3. Close CCR-001 when feasibility handoff amendment exists; open CCR-002+ for concrete field issues.

## Reviewers
- claude (contract owner)
- grok (SEIP-DB-000 reviewer; adversarial later in SEIP-QA-002)

## Approval Status
**RESOLVED 2026-07-17** — SEIP-ARCH-001 delivered contracts v0.1
(`openapi.yaml`, `permissions.yaml`, `error-codes.yaml`, `events.yaml`; all lint/parse-verified).
Feasibility follow-up absorbed into `SEIP-DB-000-claude-review.md` under single-agent mode (ADR-0004).

## Related
- Task board: SEIP-DB-000 `status: blocked` (dependency SEIP-ARCH-001)
- Work order: `.ai-team/work-orders/SEIP-DB-000.md`
- Policy: `docs/contracts/contract-policy.md`
