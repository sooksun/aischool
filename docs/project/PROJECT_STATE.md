# Project State

## Project
School Evidence Intelligence Platform (SEIP)

## Current Phase
**Sprint 1 — First production features** (opened 2026-07-17 when the ARCH-002 merge went green on develop, run `b5c6d6a`). Single-agent mode per ADR-0004.

## Development Model
Claude Code is the sole developer (architect + backend + frontend + QA); the user is the final approver. The multi-AI team model (Codex/Antigravity/Grok) was retired by ADR-0004 — its docs remain with SUPERSEDED banners.

## Sprint 0 exit — CLEARED 2026-07-17
Gate result: 8 pass, 1 accepted deviation (direct commits to develop — sanctioned by ADR-0004), 2 superseded by ADR-0004. Item-by-item evaluation in `.ai-team/handoffs/SEIP-ARCH-002.md`.
The no-production-code constraint is **lifted**. Contracts are locked at v1.0.0 and now bind implementation: no invented fields, changes need a CCR + version bump (enforced by the contract-compatibility gate on every push and PR).

## Sprint 0 — all done 2026-07-17
OPS-001 (repo + CI) · ARCH-001 (contracts v0.1) · DB-000 (data model, inherited from Codex, review PASS) · UI-000 (evidence UX + CCR-002) · QA-001 (gates) · ARCH-002 (lock v1.0.0). QA-002 cancelled by ADR-0004.

## Current Objectives (Sprint 1)
1. ~~SEIP-DB-001~~ **DONE** — schema + migrations + constraints + taxonomy seed merged (be36eff); 18 backend tests pass; handoff .ai-team/handoffs/SEIP-DB-001.md
2. SEIP-DB-002 residual — full IndicatorLevelDescription wording from official PDFs (structure seed already in DB-001)
3. **SEIP-API-001** — evidence-workflow API (15/27 ops) ← **in review** on eat/SEIP-API-001-evidence-workflow
4. SEIP-UI-001 — evidence submission flow (depends on API-001)
5. Infra: docker-compose (PostgreSQL + MinIO) per ADR-0005 — landed with DB-001

## Active Tasks
See `.ai-team/task-board.yaml` (single tracker).

## Major Decisions
- ADR-0001 — Technology stack: Node/TypeScript monorepo (Accepted)
- ADR-0002 — Repository layout canonicalization (Accepted; per-agent ownership parts superseded by ADR-0004)
- ADR-0003 — Evaluation framework: วPA ว9/2564 (ครู) + ว10/2564 (ผู้บริหาร); taxonomy in `docs/architecture/evaluation-framework.md` (Accepted)
- ADR-0004 — Single-agent development by Claude Code (Accepted)
- ADR-0005 — Object storage: MinIO / S3-compatible; deployment: on-premise (Accepted)

## Open Questions
- OPEN-3: AI provider + PDPA data-residency (blocks Sprint 2 AI-mapping only). **Note: ADR-0005 keeps all evidence on Thai on-prem hardware — sending it to a foreign AI provider would cross the border this decision avoids. OPEN-3 must respect that.**
- ~~OPEN-1~~ GitHub · ~~OPEN-2~~ วPA per ADR-0003 · ~~OPEN-4~~ MinIO on-prem per ADR-0005 · ~~OPEN-5~~ AI-mapping task created in Sprint 2 planning

## Known Risks
- Criteria and official forms may change by year → framework versioned as data (ADR-0003)
- AI mapping must remain human-reviewable
- Uploaded evidence contains personal data (PDPA) — never in git, storage design server-side
- Video storage can grow quickly (mitigated by ADR-0005 MinIO on-prem + retention policy)
- Solo-agent risk (replaces multi-agent drift risk): no independent reviewer — mitigate with CI gates + user review before contract lock
