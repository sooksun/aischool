# Review: SEIP-DB-000 data model — Claude (ARCH-001, single-agent mode)

Date: 2026-07-17 · Reviewer: claude (inherited reviewer per ADR-0004)
Inputs: `docs/architecture/data-model/{README,entity-dictionary,erd.mmd}`, `docs/architecture/evaluation-framework.md`, contracts v0.1

## Verdict: **PASS** — design accepted as the domain model for contracts v0.1 and SEIP-DB-001

## Checks against evaluation-framework.md implications

| Implication (framework §Implications) | Model | Result |
|---|---|---|
| 1. Indicator sets versioned data | `FrameworkVersion→Domain→Indicator→IndicatorLevelDescription` | ✅ |
| 2. One shape for ครู/ผู้บริหาร | role_family on FrameworkVersion; codes as rows | ✅ |
| 3. Rounds configurable 1..n | `EvaluationRound` UK (cycle, round_number), no max | ✅ |
| 4. Per-evaluator scoring, ≥70% each | `IndicatorScore`/`ChallengeScore` grain + `RoundResult` per evaluator | ✅ |
| 5. ภาระงาน boolean gate | `WorkloadDeclaration` separate from scores | ✅ |
| 6. Evidence categories with technical constraints | `EvidenceCategory` (mime csv, max duration) | ✅ |
| 7. Weights as data | `ScoreWeight` per framework version | ✅ |
| 8. PA1/PA2/PA3 as report targets | `Report.template_code` + payload JSON (M-4 open) | ✅ (deferred detail acceptable) |

## Consistency with contracts v0.1 (mutual-consistency check)

- `openapi.yaml` schemas use dictionary field names (`framework_version_id`, `owner_personnel_id`, `scan_status`, `mapping_source`, `rubric_level` 1..4) — no invented fields.
- Two-phase upload (initiate/complete) matches `EvidenceFile` metadata + provider-agnostic storage (OPEN-4 assumption).
- `submitMyScores` submits standard + challenge items in one set; implementation may keep the model's two tables (`IndicatorScore`/`ChallengeScore`) or merge — **implementation freedom noted for DB-001**, contract is agnostic.
- `AssignmentResults.overall_pass` encodes constraint intentions §10.6–10.7 (workload gate + every evaluator ≥70%).
- Tenancy rule in `permissions.yaml` matches dictionary §10.1 (school_id everywhere; area scope read-only per M-1 disposition).

## Observations (non-blocking, for SEIP-DB-001)

1. `ChallengeScore` and `IndicatorScore` share a grain — consider one table with `indicator_kind` discriminator; revisit at implementation.
2. `RoundResult.passed_individual_threshold` should be DB-derived (generated column or trigger), not app-written, to prevent drift.
3. `Area` is nullable on School — fine for single-school deployment; seed must allow school without area.
4. AuditEvent PII minimisation in before/after snapshots needs a concrete field-allowlist during DB-001 — flagged as a test requirement.

## CCR-001 disposition

Contracts v0.1 now exist (this task). Feasibility concerns from `SEIP-DB-000-feasibility.md` §checklist were incorporated:
light taxonomy payloads (`include=levels` opt-in), no hard-coded 2 rounds, presigned upload (no bytes through API), M:N via mapping status machine, per-evaluator bulk score write, outbox events.
**CCR-001 → resolved.**
