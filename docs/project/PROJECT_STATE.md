# Project State

## Project
School Evidence Intelligence Platform (SEIP)

## Current Phase
**Sprint 1 — First production features** (opened 2026-07-17 when the ARCH-002 merge went green on develop, run `b5c6d6a`). Single-agent mode per ADR-0004.

> ⚠️ **Not releasable.** Three blockers (B-1/B-2/B-3 under Current Objectives) mean a fresh install cannot create a login and no score can be submitted through the API. See "Audit correction — 2026-07-19".

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
7. ~~SEIP-API-002~~ **DONE** — cycles + committee scoring (remaining 11 ops); all 27 contract operations implemented *(contract has since grown to 35 ops; all 35 are implemented)*
8. Contracts at **v2.8.0** (was v2.1.0 at CCR-005; CCR-010 lazy download_url → 2.5.0, CCR-011 ReportPayloadV1 → 2.6.0, CCR-012 `unscanned` → 2.7.0, CCR-013 rubric text → 2.8.0)
9. ~~SEIP-WORKER-001~~ **DONE** — outbox + file.process + storage GC. **Superseded in part by CCR-012:** the virus-scan stub and the duration probe were *deleted*, not fixed — `file.process` now only verifies stored size against declared size. There is no scanner. See "Audit correction" below.
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
23. ~~DB engine migration~~ **DONE 2026-07-18** — PostgreSQL → MySQL 8 per ADR-0008 (Laragon localhost dev; staging/CI containers swapped; migrations rebaselined; full suite + e2e green on MySQL).
24. ~~Cleanup L2-a~~ **DONE 2026-07-19** — `.category-card` selected-state CSS matched `aria-pressed` while the markup renders `role="radio" aria-checked`; the rule never applied, so picking an evidence category gave sighted users no visual confirmation. Verified fixed against the real stylesheet on the dev server.
25. **Sprint 2 — BLOCKERS (must precede any release; each needs a CCR + a version bump — major vs minor decided per CCR, not assumed).** Tracked as `SEIP-BLOCK-001/002/003` on `.ai-team/task-board.yaml` (CCR-014/015/016). **CCR-014 drafted 2026-07-19, awaiting approval** — it lands additive (openapi 2.8.0 → 2.9.0), correcting this entry's original claim that all three require a major bump:
    - **B-1 Onboarding path** (`SEIP-BLOCK-001`, CCR-014)**.** No operation in `openapi.yaml` creates `School` / `UserAccount` / `SchoolMembership` / `PersonnelProfile`, and `prisma/seed.mjs` seeds none of them. `hashPassword` has no caller outside its own test. **A fresh install cannot produce a first login.**
    - **B-2 PerformanceAgreement + AgreementChallenge** (`SEIP-BLOCK-002`, CCR-015)**.** Both models have **zero references** in `apps/` and `packages/`. `submitMyScores` therefore always fails the workload gate (`apps/api/src/routes/scoring.ts:220-227`, VAL-002/SCORE-004). ประเด็นท้าทาย (ส่วนที่ 2) is **40% of the วPA score** and has no code at all.
    - **B-3 Approval** (`SEIP-BLOCK-003`, CCR-016)**.** Schema-only. Reports reach `pending_approval` and stall permanently.
26. **Sprint 2+ remaining** — multi-instance Redis rate limits *only if* no trusted edge; pixel-perfect official paper plates (Protected Artifact); real file scanning to replace the deleted stub (CCR-012).

## Audit correction — 2026-07-19

A full evidence-based code audit was run against `feat/cleanup-L2-e2e-depth` (`42173e0`). **It contradicted this document.** The previous wording of this section claimed the product slice "works" end-to-end; that is true only because `tests/e2e/global-setup.mjs:196` and `apps/api/test/scoring-flow.test.mjs:114` write bootstrap rows **straight into Prisma, bypassing the API**. Corrected statement:

**Product slice, as reachable through the API today:** login → evidence upload → MinIO → `file.process` size check (no scan) → mapping (+ local AI suggest) → cycles/rounds → committee assignment → report JSON + section refs → on-demand PDF.
**Not reachable through the API:** creating the first user/school/personnel (B-1); linking a PerformanceAgreement, hence submitting any score (B-2); ประเด็นท้าทาย (B-2); approving a report (B-3).

Audited completeness ≈ **70%** weighted. Quality of what exists is high — 35/35 contract operations implemented with zero stubs or TODOs, `permission-guard.ts` reads `permissions.yaml` at runtime and fails closed, zero raw SQL, 180 verbatim ก.ค.ศ. paragraphs seeded, migration drift verified zero, `npm run typecheck` clean across all 6 workspaces, 164 real test cases. **The gap is missing scope, not rot** — closing it is a sprint of new contract operations, not bug-fixing.

Lower-severity findings (full list in the audit session): `completeFileUpload` does not re-validate category rules despite a comment at `apps/api/src/routes/evidence.ts:289` claiming it does; 3 taxonomy routes never call `resolveGrant`; 4 FK fields unvalidated (→ P2003 500s, one cross-tenant write); outbox dispatch has no backoff and no dead-letter; `permissions.yaml` promises an `access_denied` AuditEvent that is emitted nowhere; the n8n key in `autokey.md` is gitignored but **not rotated**; backups are manual copy-paste per `ops-runbook.md:147`; no test-coverage instrumentation exists anywhere.


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
- ADR-0008 — Database engine: MySQL 8 (Laragon local dev, containerized staging/on-prem); PostgreSQL retired (Accepted)

## Open Questions
- ~~OPEN-3~~ **Closed by ADR-0007** — default path is local_heuristic; cloud/foreign LLM requires a superseding ADR.
- ~~OPEN-1~~ GitHub · ~~OPEN-2~~ วPA per ADR-0003 · ~~OPEN-4~~ MinIO on-prem per ADR-0005 · ~~OPEN-5~~ AI-mapping implemented as local_heuristic

## Known Risks
- Criteria and official forms may change by year → framework versioned as data (ADR-0003)
- AI mapping must remain human-reviewable
- Uploaded evidence contains personal data (PDPA) — never in git, storage design server-side
- Video storage can grow quickly (mitigated by ADR-0005 MinIO on-prem + retention policy)
- Solo-agent risk (replaces multi-agent drift risk): no independent reviewer — mitigate with CI gates + user review before contract lock
- **Green CI is compatible with an undeployable system.** The e2e and scoring suites seed `PerformanceAgreement` and all identity rows directly through Prisma, so they prove the scoring *logic* while saying nothing about whether the flow is *reachable*. This masked B-1/B-2 until the 2026-07-19 audit. Any future fixture shortcut that bypasses the API must be recorded in `docs/qa/QUALITY-GATES.md` as a coverage caveat.
- **Evidence store has no malware scanning.** CCR-012 deleted the filename-matching stub rather than replacing it; `unscanned` is disclosed in the UI but files are still served (`apps/api/src/routes/evidence.ts:376`). Accepted knowingly — revisit before any multi-school deployment.
