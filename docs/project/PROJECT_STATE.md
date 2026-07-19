# Project State

## Project
School Evidence Intelligence Platform (SEIP)

## Current Phase
**Sprint 1 — First production features** (opened 2026-07-17 when the ARCH-002 merge went green on develop, run `b5c6d6a`). Single-agent mode per ADR-0004.

> ✅ **All three audit blockers closed** (2026-07-19/20): B-1 onboarding (CCR-014, openapi 2.9.0), B-2 agreements + ประเด็นท้าทาย (CCR-015, **3.0.0** breaking), B-3 report approval (CCR-016, 3.1.0). The วPA flow now runs end to end through the API: invite → accept → PA1 + ประเด็นท้าทาย → evidence → mapping → cycles/rounds → 3-evaluator scoring with the challenge visible → report → **director approves**.
>
> **This is not the same as "ready to deploy."** What remains is listed under "Known gaps at blocker-close" below. The two items previously flagged as not-safe-to-defer — **no malware scanning** and **manual backups** — were both closed 2026-07-20 (ADR-0009; `npm run backup`/`restore` + a scheduled staging service). The largest gap left is that nothing consumes the outbox, which makes notification-shaped features no-ops rather than hazards.

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
9. ~~SEIP-WORKER-001~~ **DONE** — outbox + file.process + storage GC. CCR-012 *deleted* the virus-scan stub and the duration probe rather than fixing them; **ADR-0009 (2026-07-20) replaced the scanner for real** with on-prem ClamAV that fails closed. The duration probe is still absent by design — `duration_seconds` stays null unless the client declares it, because an estimate is not a measurement.
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
    - ~~**B-1 Onboarding path**~~ (`SEIP-BLOCK-001`, CCR-014) — **DONE 2026-07-19.** `listPersonnel` / `listMembers` / `inviteMember` / `endMembership` + unauthenticated `acceptInvite` (openapi 2.9.0). The first admin and school provisioning ship as operator CLIs (`npm run provision:school`, `npm run bootstrap:admin`) because no role may write across schools and inventing a `system_admin` would rewrite all 31 matrix rows. Proven by an e2e spec that onboards a teacher through the browser with no Prisma write in the path.
    - ~~**B-2 PerformanceAgreement + AgreementChallenge**~~ (`SEIP-BLOCK-002`, CCR-015) — **DONE 2026-07-19.** 6 operations (list/get/create/update/submit/acknowledge) + `AssignmentDetail.challenge`, so the committee now reads the method and targets that C.1/C.2.1/C.2.2 rate instead of scoring 40% blind. `AssignmentCreate.agreement_id` removed (**breaking → openapi 3.0.0**) — the server derives it from (cycle, evaluatee), and an unvalidated client value was letting one person's workload gate read another's row. Both raw `performanceAgreement.create` fixtures deleted: the suite can no longer be green while scoring is unreachable.
    - ~~**B-3 Approval**~~ (`SEIP-BLOCK-003`, CCR-016) — **DONE 2026-07-20.** `approveReport` / `returnReport` / `listReportApprovals` + `ReportDetail.approvals`, and `report.approved` left the `events.yaml` `deferred:` block. Approval requires the round **closed** (RPT-003): nothing checked round state before a report was generated, and scores stay mutable until close (SCORE-002), so signing earlier produced a document its own data could contradict. Nobody may approve their own report. The PDF now states whether it has been endorsed. `rejected` / `issued` / `superseded` stay deliberately unreachable — reasons in the CCR.
26. ~~Malware scanning + automated backups~~ **DONE 2026-07-20** — ADR-0009 (ClamAV on-prem, fail-closed) and `scripts/ops/backup.mjs` + `restore.mjs` with a scheduled staging service. The backup verifies each dump by restoring it, which immediately exposed a schema bug that had made every prior backup unable to restore its audit triggers (migrations `20260720060000`–`3`, runbook §5.4).
27. **Sprint 2+ remaining** — outbox consumers (nothing reacts to any event); multi-instance Redis rate limits *only if* no trusted edge; pixel-perfect official paper plates (Protected Artifact); a real video duration probe; re-scan of files uploaded before ADR-0009.

## Audit correction — 2026-07-19

A full evidence-based code audit was run against `feat/cleanup-L2-e2e-depth` (`42173e0`). **It contradicted this document.** The previous wording of this section claimed the product slice "works" end-to-end; that is true only because `tests/e2e/global-setup.mjs:196` and `apps/api/test/scoring-flow.test.mjs:114` write bootstrap rows **straight into Prisma, bypassing the API**. Corrected statement:

**Product slice, as reachable through the API today** (updated 2026-07-20): onboarding (invite → accept → login) → **PA1 agreement + ประเด็นท้าทาย (write → submit → director acknowledges)** → evidence upload → MinIO → `file.process` size check **+ ClamAV scan (ADR-0009)** → mapping (+ local AI suggest) → cycles/rounds → committee assignment → **3-evaluator scoring with the challenge visible** → report JSON + section refs → on-demand PDF.
Creating the very first admin and provisioning schools are operator CLIs by design, not gaps (CCR-014 decisions 1 and 2).

## Known gaps at blocker-close — 2026-07-20

The three blockers are closed; these are not, and none of them is a blocker only
because none of them stops the วPA flow from completing. Listed so "all blockers
closed" is never read as "done".

| Gap | Why it matters |
|---|---|
| ~~**No malware scanning**~~ — **CLOSED 2026-07-20 (ADR-0009)** | ClamAV on-prem (never a cloud AV — same PDPA reasoning as ADR-0007). Fails closed: if the scanner is unreachable the file stays `pending` and undownloadable, never `clean`. `SCAN_PROVIDER=none` keeps the honest `unscanned` and is the only way to opt out — there is no silent fallback. `scan_status = clean` is reachable for the first time |
| ~~**Backups are manual**~~ — **CLOSED 2026-07-20** | `npm run backup` / `npm run restore`, plus a scheduled `backup` service in staging compose. Each dump is **restored into a scratch database and row-counted before being called a backup** — which is how it immediately caught a schema bug that made every prior backup unable to restore its audit triggers (runbook §5.4) |
| **The outbox delivers to nobody.** `outbox.dispatch` marks events published and returns; 6 of 14 declared events have a producer and none has a consumer | Every notification-shaped feature is a no-op. `report.approved` is durably recorded and read by nothing |
| **No deploy automation.** One CI workflow, no image build/push, no registry, no rollback path. Containers run as root | Deployment is a human following a runbook |
| **`ReportStatus` is 3-of-5 reachable.** `issued` and `superseded` have no operation, by design (CCR-016) | Stop describing the report lifecycle as complete |
| **Committee seats are still raw UUIDs**, and rank codes display as codes | Documented in CCR-015; needs a contract addition each |
| **The report page dumps `payload` as raw JSON** | A developer view serving as a director's primary content |
| **No test-coverage measurement anywhere** | 190+ tests with no denominator |

**Both items flagged as not-safe-to-defer are now closed** (2026-07-20). What is
left on this list is real but none of it silently loses or exposes data. The
largest remaining is that the outbox delivers to nobody, which makes every
notification-shaped feature a no-op rather than a hazard.

One thing the backup work surfaced that is worth carrying forward: the trigger
bug had existed since 2026-07-18 and no test, gate or review found it. It was
found by a script that verified its own output. Prefer that shape.

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
- ~~Evidence store has no malware scanning~~ — **CLOSED 2026-07-20 by ADR-0009.** ClamAV on-prem, fail-closed. Residual risk worth carrying: a deployment may still set `SCAN_PROVIDER=none`, in which case files read `unscanned` and are served — disclosed, not gated. And files uploaded **before** ADR-0009 were never scanned; any deployment predating it should re-scan its store once, which no operation currently does.
