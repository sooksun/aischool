# Backend feasibility findings — SEIP-DB-000

Owner: codex  
For reviewer: grok  
Date: 2026-07-16  
Input expected: contracts v0.1 (`openapi`, `events`, `permissions`, `error-codes`)  
Input actual: **missing** (only `contract-policy.md`)

## Verdict

| Scope | Verdict | Notes |
|---|---|---|
| Domain data model (ERD + dictionary) | **FEASIBLE** | Modelled from ADR-0003 + `evaluation-framework.md` + `system-context.md` |
| Contracts v0.1 backend feasibility | **BLOCKED — MISSING INPUT** | CCR-001 opened; no endpoints/fields to cost |
| Invent substitute API fields | **REJECTED** | Forbidden by contract-policy and work order |

**Overall task split:** design deliverables for AC 1–4 and 6 are complete; AC 5 cannot be honestly completed until SEIP-ARCH-001 publishes drafts.

## What would have been reviewed (checklist for re-run)

When contracts appear, Codex will score each area:

| Area | Cheap (expected) | Expensive / watch | Impractical if specified as… |
|---|---|---|---|
| Taxonomy read APIs | Static-ish seed reads, cacheable | Fat payloads with all level descriptions | Returning full PDF wording inline every list call |
| Cycle/round config | Simple CRUD + checks | Concurrent round close | Hard-coded “exactly 2 rounds” in API path |
| Evidence upload | Multipart + async virus scan | Large mp4, resumable upload | Storing video bytes in JSON/DB |
| Mapping M:N | Join table + status machine | AI suggest flood (Sprint 2) | Duplicating evidence per indicator |
| Per-evaluator scoring | Narrow write UK | Recompute rollups; close immutability | Single average-only score field (violates ≥70% each) |
| Report generate | Snapshot JSON + refs | Official PDF layout fidelity | Embedding file binaries in report resource |
| Permissions | school_id on every row | Area-admin cross-tenant | Global teacher list without tenant filter |
| Events | Outbox after commit | Dual-write races | Sync HTTP to notification inside request without outbox |

## Domain-side cost signals (independent of OpenAPI)

These are backend risks visible from the ERD alone:

1. **Video evidence volume (OPEN-4)** — mp4 teaching + inspiration videos; metadata-only DB is cheap; storage + bandwidth is the cost centre. Resumable upload and async processing recommended in API design.
2. **Per-evaluator score cardinality** — 3 evaluators × 15 indicators × N evaluatees × R rounds; fine for Postgres; needs composite indexes and bulk write APIs.
3. **AuditEvent growth** — append-only; partition by `occurred_at` or `school_id` in SEIP-DB-001 if multi-school.
4. **Confirmed mapping uniqueness** — partial unique indexes required so revoked rows do not block re-map.
5. **Framework versioning** — historical cycles must pin `framework_version_id`; never mutate seed rows in place for a new legal revision.

## Contract Change Requests

| CCR | Summary | Status |
|---|---|---|
| [CCR-001](./CCR-001-contracts-v0.1-missing.md) | Publish contracts v0.1 so feasibility can run | pending |

No field-level CCRs (CCR-002+) — inventing fields to “review” them would violate policy.

## Recommendation to Grok / Claude

1. Do not treat SEIP-DB-000 as fully satisfying the contract-approval loop until CCR-001 is closed.
2. ERD may proceed to SEIP-QA-002 **domain consistency** review in parallel with ARCH-001, but **mutual consistency with contracts** is blocked.
3. After contracts land, request a delta feasibility note (same task amendment or SEIP-DB-000b).
