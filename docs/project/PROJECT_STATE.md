# Project State

## Project
School Evidence Intelligence Platform (SEIP)

## Current Phase
Sprint 0 — Foundation (single-agent mode per ADR-0004, since 2026-07-17)

## Development Model
Claude Code is the sole developer (architect + backend + frontend + QA); the user is the final approver. The multi-AI team model (Codex/Antigravity/Grok) was retired by ADR-0004 — its docs remain with SUPERSEDED banners.

## Hard Constraint
No production feature code until the Sprint 0 exit gate passes: contracts v1.0 locked (SEIP-ARCH-002) + data model and UX designs approved.
Status 2026-07-17: contracts locked; gate is 7 pass / 1 accepted deviation / 2 superseded / **1 pending — item 7 (PR pipeline proof) + user approval**. See `.ai-team/handoffs/SEIP-ARCH-002.md` for the item-by-item evaluation.

## Current Objectives (sequence)
1. ~~SEIP-OPS-001~~ DONE 2026-07-17 — repo live, CI green (close-out in `.ai-team/handoffs/`)
2. ~~SEIP-ARCH-001~~ DONE 2026-07-17 — contracts v0.1 drafted + verified; CCR-001 resolved; DB-000 review PASS
3. ~~SEIP-UI-000~~ DONE 2026-07-17 — UX design + field trace (CCR-002 applied); ~~SEIP-QA-001~~ DONE 2026-07-17 — 4 LIVE + 8 self-arming gates
4. SEIP-ARCH-002 — contracts **locked at v1.0.0** 2026-07-17; ← **awaiting user approval of the PR** (this is the Sprint 0 exit gate; PR also provides the item-7 pipeline proof)
5. Sprint 1 (opens on that merge): SEIP-DB-001 (schema + migrations), SEIP-UI-001 (evidence flow)

## Active Tasks
See `.ai-team/task-board.yaml` (single tracker).

## Major Decisions
- ADR-0001 — Technology stack: Node/TypeScript monorepo (Accepted)
- ADR-0002 — Repository layout canonicalization (Accepted; per-agent ownership parts superseded by ADR-0004)
- ADR-0003 — Evaluation framework: วPA ว9/2564 (ครู) + ว10/2564 (ผู้บริหาร); taxonomy in `docs/architecture/evaluation-framework.md` (Accepted)
- ADR-0004 — Single-agent development by Claude Code (Accepted)

## Open Questions
- OPEN-3: AI provider + PDPA data-residency (blocks Sprint 2 AI-mapping contract)
- OPEN-4: object storage choice (blocks storage strategy in SEIP-DB-001)
- ~~OPEN-1~~ GitHub (github.com/sooksun/aischool, public) · ~~OPEN-2~~ วPA per ADR-0003 · ~~OPEN-5~~ AI-mapping task will be created in Sprint 2 planning

## Known Risks
- Criteria and official forms may change by year → framework versioned as data (ADR-0003)
- AI mapping must remain human-reviewable
- Uploaded evidence contains personal data (PDPA) — never in git, storage design server-side
- Video storage can grow quickly (OPEN-4)
- Solo-agent risk (replaces multi-agent drift risk): no independent reviewer — mitigate with CI gates + user review before contract lock
