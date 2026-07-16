# Project State

## Project
School Evidence Intelligence Platform (SEIP)

## Current Phase
Sprint 0 — Multi-AI Team Operating System (planned 2026-07-16)

## Sprint 0 Goal
Make the division-of-work system executable before any agent writes a production feature. See `project/SPRINT-0.md`.

## Hard Constraint
No production feature code until the Definition of Ready to Build gate in `project/SPRINT-0.md` passes.

## Current Objectives
- Bootstrap the repository so the operating system actually runs (SEIP-OPS-001)
- Draft and validate contracts v0.1, then lock v1.0 (SEIP-ARCH-001 → SEIP-ARCH-002)
- Produce data model and UX flow designs (SEIP-DB-000, SEIP-UI-000)
- Stand up runnable QA/security gates (SEIP-QA-001) and run one adversarial review (SEIP-QA-002)

## Wave Sequence
0. SEIP-OPS-001 (claude) — repo + operating system
1. SEIP-ARCH-001 (claude) + SEIP-QA-001 (grok)
2. SEIP-DB-000 (codex) + SEIP-UI-000 (antigravity)
3. SEIP-QA-002 (grok) — verdict gate
4. SEIP-ARCH-002 (claude) — contract lock → Definition of Ready to Build

## Active Tasks
See `.ai-team/task-board.yaml`. Only SEIP-OPS-001 is `ready`; all others are `blocked` on their wave predecessor.

## Major Decisions
- ADR-0001 — Technology stack: Node/TypeScript monorepo (Accepted)
- ADR-0002 — Repository layout and ownership canonicalization (Accepted)
- ADR-0003 — Evaluation framework: วPA ว9/2564 (ครู) + ว10/2564 (ผู้บริหาร) (Accepted); taxonomy in `architecture/evaluation-framework.md`
- See `decisions/`.

## Open Questions
- ~~OPEN-1~~ CLOSED: GitHub remote — server-side branch protection + GitHub Actions
- ~~OPEN-2~~ CLOSED: วPA ว9/ว10 2564 — see ADR-0003
- OPEN-3: AI provider + PDPA data-residency (blocks Sprint 2 AI-mapping contract)
- OPEN-4: object storage choice (blocks SEIP-DB-000 storage strategy)
- OPEN-5: AI-mapping contract has no owning task (Sprint 2)
See `project/SPRINT-0.md` for detail and owners.

## Known Risks
- Criteria and official forms may change by year
- AI mapping must remain human-reviewable
- Uploaded evidence contains personal data
- Video storage can grow quickly
- Multiple AI agents may create incompatible assumptions unless contracts are locked
- Bootstrap (SEIP-OPS-001) is single-threaded and blocks all other agents
- `docs/` currently duplicates `aischool-docs.zip`; the zip will drift once git exists
