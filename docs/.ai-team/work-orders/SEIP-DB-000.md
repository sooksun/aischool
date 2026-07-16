# Work Order: SEIP-DB-000

## Objective
Produce the **data model design** for SEIP as a stack-agnostic ERD and entity dictionary, plus a backend-feasibility review of contracts v0.1. This is a **design and validation task, not implementation** — no `prisma/schema.prisma`, no migrations, no executed SQL. Per ADR-0001 §Decision, the ERD is a domain artifact and is kept separate from the Prisma commitment, which happens in SEIP-DB-001 (Sprint 1).

This is the Codex half of the contract approval loop in `contract-policy.md` step 2 ("Codex validates backend feasibility").

## Owner
codex

## Reviewer
grok

## Dependencies
- SEIP-OPS-001 (repo + operating system ready)
- SEIP-ARCH-001 (module boundaries + contracts v0.1 exist to validate against)
- OPEN-2 **closed 2026-07-16: วPA (ว9/2564 ครู + ว10/2564 ผู้บริหาร).** Model against `docs/architecture/evaluation-framework.md` — it defines the indicator taxonomy (T-x.x / A-x.x), versioned-framework requirement, configurable rounds, per-evaluator scoring, and evidence categories. Its "Implications" section is a hard input to this task.
- **OPEN-4 (object storage)** is still open and affects the storage strategy for mp4 evidence. If still unanswered when this task starts, design the evidence entity storage-agnostic (URI + provider column) and record the assumption.

## Allowed Paths
- `docs/architecture/data-model/**` (ERD, entity dictionary — new)
- `.ai-team/handoffs/SEIP-DB-000.md`
- `docs/reviews/` — may file a feasibility findings note (input to Grok, not a review verdict)

## Blocked Paths
- `prisma/**` (no schema, no migration — Sprint 1)
- `apps/**`, `packages/**`
- `docs/contracts/**` (read-only; propose changes via Contract Change Request, do not edit)
- Any executed database migration or SQL DDL against a live database

## Acceptance Criteria
1. ERD covers the domain in `architecture/system-context.md` and `MULTI-AI-DEVELOPMENT-PLAN.md` workstream B: school, users, personnel, **configurable evaluation cycles/rounds (1..n per fiscal year)**, indicators, evidence, **evidence↔indicator mappings (many-to-many, governed)**, reports, approvals, and **audit/history**.
1a. The indicator taxonomy implements `evaluation-framework.md`: versioned framework → ด้าน → ตัวชี้วัด → per-วิทยฐานะ expected-level descriptions; committee scoring stores **per-evaluator** records (3 members, ≥70% each); ภาระงาน as a boolean gate; score weights as data.
2. Realizes the core principle "upload once, reuse through governed mappings in multiple reports" — evidence is not duplicated per report.
3. Audit history is preserved as an explicit design choice (append-only / temporal / event table — state which and why).
4. Every entity in the ERD has a dictionary row: purpose, key fields, relationships, retention/PII classification (evidence carries personal data — PROJECT_STATE.md risk).
5. A written backend-feasibility verdict on contracts v0.1: which endpoints/fields are cheap, which are expensive, which are impractical as specified. Each concern is a Contract Change Request, not a silent deviation.
6. Open modelling questions that depend on OPEN-2/OPEN-4 are listed, not hidden behind an assumption.

## Required Tests
- None executed (design task). Constraint intentions (uniqueness, FK, check constraints) are **stated in the dictionary** so SEIP-DB-001 can test them, not implemented here.

## Verification Commands
```bash
ls docs/architecture/data-model/                     # ERD + entity dictionary present
# ERD renders (if authored as mermaid/dbml):
npx @mermaid-js/mermaid-cli -i docs/architecture/data-model/erd.mmd -o /tmp/erd.svg   # exit 0
```

## Expected Handoff
`.ai-team/handoffs/SEIP-DB-000.md`: entity list, the audit-history approach chosen, the feasibility verdict on contracts v0.1, any Contract Change Requests raised, and the OPEN-2/OPEN-4 assumptions made. Recommended next task: feed findings into SEIP-QA-002, then SEIP-DB-001 in Sprint 1.
