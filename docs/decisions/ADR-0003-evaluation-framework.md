# ADR-0003: Evaluation Framework — ว9/2564 + ว10/2564 (วPA)

## Status
Accepted

## Context

The team charter lists "evaluation indicator definitions" as a Protected Artifact, but no document defined which framework SEIP implements (OPEN-2 in `SPRINT-0.md`). Codex cannot model evidence→indicator mapping against an unknown indicator set, and the AI mapping engine has no target taxonomy.

## Decision

SEIP implements the **ก.ค.ศ. Performance Agreement (วPA) framework**, per the user's direction on 2026-07-16:

- **ครู**: หลักเกณฑ์ ว9/2564 — PA with 3 ด้าน / 15 ตัวชี้วัด (8+4+3) + ประเด็นท้าทาย, and DPA evaluation with 2–3 ด้าน
- **ผู้บริหารสถานศึกษา**: หลักเกณฑ์ ว10/2564 — PA with 5 ด้าน / 15 ตัวชี้วัด (6+3+2+2+2) + ประเด็นท้าทาย

The extracted, verified structure lives in `docs/architecture/evaluation-framework.md` (source of truth). Key structural commitments:

1. Indicator sets are **versioned data** (framework revision 2564 is the first row, not the schema).
2. One structural shape serves both roles: framework → ด้าน → ตัวชี้วัด → per-วิทยฐานะ expected-level descriptions → 4-level rubric.
3. Rounds per fiscal year are configurable (1..n), per-evaluator scores are stored individually (3-member committee, ≥70% each).
4. Score weights (60/40, 20/10/10) and ภาระงาน gate are framework data, not code.

## Options Considered

1. **วPA (ว9+ว10/2564)** — current legal framework since 1 ต.ค. 2564; matches the school's actual evaluation duty; the two source manuals are official and complete.
2. Older ว21/2560 or generic KPI model — superseded; would not match real forms; rejected.
3. Framework-agnostic abstract model only — defers the question Codex needs answered; the abstraction is still needed (point 1 above) but must be validated against a real framework, so this is subsumed by option 1.

## Consequences

- `SEIP-DB-000` models against a known taxonomy; its acceptance criteria now reference `evaluation-framework.md`.
- The AI mapping engine (Sprint 2+) maps evidence to the T-x.x / A-x.x indicator codes defined there.
- Report templates PA1/PA2/PA3 (ส and บส variants) become the official output targets.
- If ก.ค.ศ. revises the criteria, a new framework version row is added — a data migration, not a schema change. This directly addresses the recorded risk "criteria and official forms may change by year".
- OPEN-2 is closed.

## Approved By
User (2026-07-16), recorded by Claude

## Date
2026-07-16
