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
1. ~~SEIP-DB-001~~ **DONE** — schema + migrations + seed + constraint tests
2. ~~SEIP-DB-002~~ **DONE** (structure)
2b. ~~SEIP-DB-003~~ **DONE** — IndicatorLevelDescription matrix seeded (432+360; framework-anchored operational text)
3. ~~SEIP-API-001~~ **DONE** — evidence-workflow 15 ops (3db868d)
4. ~~SEIP-QA-003~~ **DONE** — permission matrix tests
5. ~~SEIP-UI-001~~ **DONE** — evidence SPA (3db868d)
6. ~~SEIP-OPS-002~~ **DONE** — develop CI fix (556958c)
7. ~~SEIP-API-002~~ **DONE** — cycles + committee scoring (remaining 11 ops); all 27 contract operations implemented
8. Contracts at **v2.1.0** (CCR-005 reports + AI suggest; was 2.0.0 after CCR-004)
9. ~~SEIP-WORKER-001~~ **DONE** — outbox + file.process (scan/duration) + storage GC
10. ~~SEIP-UI-002~~ **DONE** — director/admin UI for cycles, rounds, committee assignment; handoff `.ai-team/handoffs/SEIP-UI-002.md`
11. ~~SEIP-OPS-003~~ **DONE** — staging compose + TLS/backup runbook + worker (`6b8b66c` on develop)
12. ~~Wave D+E reports/AI~~ **DONE** (`f014cf8`) — ARCH-003/API-003/WORKER-002/UI-004 + ARCH-005/API-004/UI-005
13. ~~SEIP-UI-003~~ **DONE** — evaluator scoring UI (`feat/SEIP-UI-003-evaluator-scoring`); handoff `.ai-team/handoffs/SEIP-UI-003.md`
14. ~~SEIP-API-003a / UI-003b / QA-004~~ **DONE** on `feat/SEIP-WAVE-B-CF` — safe download_url, scan UI, Playwright e2e smoke
15. ~~SEIP-OPS-004~~ **DONE** — edge login rate limit + security headers; API AUTH-004 defense-in-depth
16. ~~PA form PDF + expanded e2e~~ **DONE** on `feat/SEIP-PDF-E2E` — getReportPdf, UI download, Playwright director/teacher paths
17. ~~Cleanup B1–B3 / H1 / H2~~ **DONE** — list scan_status; atomic AI suggest; **lazy download_url** (CCR-010, openapi 2.5.0)
18. ~~Cleanup M2~~ **DONE** — ReportPayloadV1 shared type (CCR-011, openapi 2.6.0)
19. ~~Cleanup M3~~ **DONE** — capability flags from memberships (no ad-hoc App.tsx role arrays)
20. ~~Cleanup M4~~ **DONE** — login rate limiter process-global singleton; multi-instance = edge primary (Redis deferred)
21. ~~Cleanup L1~~ **DONE** — PDF UX draft/review fidelity (not official plate)
22. ~~Cleanup L2~~ **DONE** — e2e depth (upload, score, report/PDF, session refresh)
23. **Sprint 2+ remaining** — multi-instance Redis rate limits *only if* no trusted edge; pixel-perfect official paper plates (Protected Artifact).

**Product slice (REPORTS-AI branch):** login → evidence → MinIO/worker scan → mapping (+ local AI suggest) → cycles/rounds → 3-evaluator scoring → structured PA report generation (JSON + section refs). PDF layout still deferred.


### Incident: develop CI broke on the API-001+UI-001 merge, fixed same-day
The merge (`3db868d`, 2026-07-17) went in with CI never having exercised real
Postgres+MinIO service containers on GitHub's runners before — 3 of 12 gates
failed. Fix in `556958c` (contract gate missing npm ci; MinIO services entrypoint).
Verified green on GitHub Actions run 29549242802.

## Active Tasks
See `.ai-team/task-board.yaml` (single tracker).

## Major Decisions
- ADR-0001 — Technology stack: Node/TypeScript monorepo (Accepted)
- ADR-0002 — Repository layout canonicalization (Accepted; per-agent ownership parts superseded by ADR-0004)
- ADR-0003 — Evaluation framework: วPA ว9/2564 (ครู) + ว10/2564 (ผู้บริหาร); taxonomy in `docs/architecture/evaluation-framework.md` (Accepted)
- ADR-0004 — Single-agent development by Claude Code (Accepted)
- ADR-0005 — Object storage: MinIO / S3-compatible; deployment: on-premise (Accepted)
- ADR-0006 — Implementation frameworks: Fastify (api), Vite+React (web), npm workspaces (Accepted)
- ADR-0007 — AI mapping provider: on-prem `local_heuristic` only; cloud LLM forbidden while ADR-0005 holds (Accepted for product progress)

## Open Questions
- ~~OPEN-3~~ **Closed by ADR-0007** — default path is local_heuristic; cloud/foreign LLM requires a superseding ADR.
- ~~OPEN-1~~ GitHub · ~~OPEN-2~~ วPA per ADR-0003 · ~~OPEN-4~~ MinIO on-prem per ADR-0005 · ~~OPEN-5~~ AI-mapping implemented as local_heuristic

## Known Risks
- Criteria and official forms may change by year → framework versioned as data (ADR-0003)
- AI mapping must remain human-reviewable
- Uploaded evidence contains personal data (PDPA) — never in git, storage design server-side
- Video storage can grow quickly (mitigated by ADR-0005 MinIO on-prem + retention policy)
- Solo-agent risk (replaces multi-agent drift risk): no independent reviewer — mitigate with CI gates + user review before contract lock
