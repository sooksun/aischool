# SEIP Data Model Design (SEIP-DB-000)

Status: **Design proposal** (not implemented)  
Owner: codex  
Reviewer: grok  
Date: 2026-07-16  
Depends on: ADR-0003, `evaluation-framework.md`, `system-context.md`  
Blocked inputs: contracts v0.1 (SEIP-ARCH-001 not delivered)

## Scope

This package is the **stack-agnostic** domain data model for SEIP:

| Artifact | Path | Purpose |
|---|---|---|
| ERD | [`erd.mmd`](./erd.mmd) | Entity-relationship diagram (Mermaid) |
| Entity dictionary | [`entity-dictionary.md`](./entity-dictionary.md) | Purpose, keys, relationships, constraints, PII/retention |
| Design decisions | this file | Audit strategy, storage, open questions |
| Backend feasibility | [`../reviews/SEIP-DB-000-feasibility.md`](../../reviews/SEIP-DB-000-feasibility.md) | Verdict on contracts v0.1 |

**Out of scope (blocked paths / later tasks):**

- `prisma/schema.prisma`, migrations, SQL DDL against a live DB → SEIP-DB-001
- API field invention → forbidden; see CCR-001
- AI-mapping pipeline schema → Sprint 2 (OPEN-5)

## Design principles

1. **Upload once, reuse via governed mappings** — `Evidence` is stored once; reports and scores reference it through `EvidenceIndicatorMapping`, never by file copy.
2. **Indicator taxonomy is versioned data** — `FrameworkVersion → Domain → Indicator → IndicatorLevelDescription`. ว9/ว10 2564 is the first seed, not the schema.
3. **One structural shape for ครู and ผู้บริหาร** — role-specific codes (T-x.x / A-x.x) live in data rows under separate framework versions.
4. **Rounds configurable 1..n per fiscal-year cycle** — not hard-coded to 2.
5. **Per-evaluator scoring** — score grain is `(evaluatee, round, indicator|challenge_item, evaluator)`.
6. **ภาระงาน is a boolean gate**, not a scored indicator.
7. **Score weights are framework data** (60/40, 20/10/10), not application constants.
8. **School-scoped tenancy** — almost every operational row carries `school_id` (area-scoped roles are the exception, modelled via membership scope).

## Audit / history approach (explicit choice)

**Chosen: append-only `AuditEvent` table (event sourcing lite), plus domain status fields.**

| Option | Why not (or why) |
|---|---|
| **Append-only audit event table** (chosen) | Immutable trail for PDPA/accountability; covers all aggregates with one pattern; cheap to implement in SEIP-DB-001; supports “who changed mapping/score/approval” without temporal SQL dialect features. |
| Full system-versioned temporal tables | Correct but heavy for Sprint 1; Postgres temporal or application-level history tables per entity explode schema size. Can be added later for high-risk entities if needed. |
| Soft-delete only | Insufficient — loses who/when/why of updates to mappings and scores. |

**Rules:**

- Application code **never updates or deletes** `AuditEvent` rows.
- Domain tables may soft-delete (`deleted_at`) and may update mutable fields; every mutating command also writes an audit event with `actor_user_id`, `action`, `entity_type`, `entity_id`, `before`/`after` JSON snapshots (PII-minimised where possible), `school_id`, `occurred_at`.
- Committee scores: once a round is `closed`, score rows become immutable at the application layer (enforced in SEIP-DB-001 with status checks; optional DB trigger later).

## Evidence storage strategy (OPEN-4)

**OPEN-4 (object storage choice) is still open.** Evidence storage is therefore **provider-agnostic**:

| Column (conceptual) | Meaning |
|---|---|
| `storage_provider` | Enum-like code: `local` \| `s3` \| `gcs` \| `azure_blob` \| `minio` \| … (extensible string) |
| `storage_uri` | Opaque URI/key understood by that provider |
| `content_type`, `byte_size`, `checksum_sha256` | Validation + integrity |
| `duration_seconds` | Required for video categories (DPA ≤10 min rule) |

**Assumption recorded for this design:** binary bytes never live in PostgreSQL; only metadata + URI. Provider binding is a deployment config concern, not a schema shape change.

## Entity groups (summary)

```text
Tenancy & Identity     School, UserAccount, SchoolMembership
Personnel              PersonnelProfile, RankLevel (วิทยฐานะ ref)
Framework (seed data)  FrameworkVersion, Domain, Indicator,
                       IndicatorLevelDescription, ScoreWeight,
                       ChallengeItemDefinition, EvidenceCategory
Cycle & Agreement      EvaluationCycle, EvaluationRound,
                       PerformanceAgreement, WorkloadDeclaration,
                       AgreementChallenge
Evidence               Evidence, EvidenceFile
Governed mapping       EvidenceIndicatorMapping
Committee & scores     EvaluationAssignment, CommitteeMember,
                       IndicatorScore, ChallengeScore, RoundResult
Reports & approvals    Report, ReportSectionRef, Approval
Audit                  AuditEvent
```

See [`entity-dictionary.md`](./entity-dictionary.md) for the full dictionary and intended constraints.

## Open modelling questions

| ID | Question | Blocks | Disposition in this design |
|---|---|---|---|
| OPEN-4 | Object storage product | concrete deploy adapter | Storage-agnostic columns; assumption above |
| OPEN-3 | AI provider + PDPA residency | AI-mapping (Sprint 2) | No AI suggestion tables in this ERD |
| C-miss | Contracts v0.1 absent | feasibility criterion 5 | CCR-001; partial feasibility only |
| M-1 | Is Area Admin cross-school read-only or multi-tenant write? | membership model | Modelled as `membership_scope=area` + `area_id`; write rules deferred to permissions contract |
| M-2 | DPA as separate process entity vs PA extension? | report templates | Separate `evaluation_kind` on cycle/assignment (`pa` \| `dpa`) sharing evidence pool |
| M-3 | Soft-delete vs hard-delete for rejected evidence files | storage cost | Soft-delete metadata + async GC job (provider delete) — policy TBD with security review |
| M-4 | Exact official form field inventory for PA1/PA2/PA3 | report payload | Report stores `template_code` + structured JSON payload; field inventory is a Protected Artifact for Claude |

## Traceability to acceptance criteria

| AC | Coverage |
|---|---|
| School, users, personnel, cycles/rounds 1..n, indicators, evidence, mappings M:N, reports, approvals, audit | ERD + dictionary |
| Versioned framework → ด้าน → ตัวชี้วัด → per-วิทยฐานะ descriptions; per-evaluator scores; ภาระงาน gate; weights as data | Framework + scoring entities |
| Upload once / governed reuse | `Evidence` + `EvidenceIndicatorMapping` + `ReportSectionRef` |
| Audit history explicit | Append-only `AuditEvent` (this README) |
| Dictionary rows for every entity | `entity-dictionary.md` |
| Backend feasibility on contracts v0.1 | **Blocked** — CCR-001; interim note in feasibility doc |
| OPEN-2/OPEN-4 questions listed | OPEN-2 closed; OPEN-4 + table above |

## Next tasks

1. SEIP-ARCH-001 delivers contracts v0.1 → re-run feasibility (close CCR-001 or open field-level CCRs).
2. SEIP-QA-002 adversarial review of this model vs contracts vs UX.
3. SEIP-DB-001 implements Prisma schema + migrations + constraint tests from this dictionary.
