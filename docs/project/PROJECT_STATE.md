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
1. ~~SEIP-DB-001~~ **DONE** — schema + migrations + seed + 18 constraint tests (`be36eff`)
2. ~~SEIP-DB-002~~ **DONE** (structure) — residual only: full IndicatorLevelDescription wording from PDFs
3. ~~SEIP-API-001~~ **DONE** — evidence-workflow API 16/27 ops, merged to `develop` (`3db868d`)
4. ~~SEIP-QA-003~~ **DONE** — permission-matrix tests arm `test:security` / permission-tests gate
5. ~~SEIP-UI-001~~ **DONE** — evidence submission SPA (`apps/web`), verified end-to-end in a real browser against the real API + Postgres + MinIO, merged to `develop` (`3db868d`)
6. ~~SEIP-OPS-002~~ **DONE** — develop CI break fixed same-day (`556958c`) — see incident note below
7. ~~SEIP-API-002~~ **DONE** — cycles + committee scoring, the remaining 11/27 ops, on `feat/SEIP-API-002-cycles-scoring` — **all 27 contract operations now implemented**; awaiting user review/merge
8. Contracts at **v2.0.0** (CCR-004, breaking: `FileUploadComplete` gained required metadata fields) — was v1.0.0 at Sprint 0 exit
9. Future: SEIP-WORKER-001 (virus scan/video-duration probe/outbox event dispatch — events.yaml defines events but nothing dispatches them yet), director/evaluator UI screens (cycle management, committee scoring UI — apps/web still only has the teacher evidence-submission flow), full IndicatorLevelDescription rubric text from the official PDFs (SEIP-DB-002 residual), PA1/PA2/PA3 report generation (deferred, needs official form field inventory)

**`develop` now contains a complete, working vertical slice**: real login → evidence submission → real MinIO upload → indicator mapping → governed confirmation, provable end-to-end. **`feat/SEIP-API-002-cycles-scoring` (awaiting merge) completes the API surface**: cycle/round setup → committee assignment → per-evaluator scoring → ≥70%-per-evaluator pass verdict, also provable end-to-end (`apps/api/test/scoring-flow.test.mjs`).

### Incident: develop CI broke on the API-001+UI-001 merge, fixed same-day
The merge (`3db868d`, 2026-07-17) went in with CI never having exercised real
Postgres+MinIO service containers on GitHub's runners before — 3 of 12 gates
failed (`contract compatibility`, `integration tests`, `permission tests`).
Root causes (both pre-existing latent bugs, unrelated to the merge's own
code) and fix in `556958c`:
- `contract-compatibility` never ran `npm ci`, so its codegen-diff step's
  bare `js-yaml` import had nothing to resolve against.
- `integration`/`permission-tests`' MinIO `services:` entry used
  `--entrypoint sh`, which replaces startup with a no-op shell — GitHub
  Actions services can't pass MinIO's required `server /data` command, so
  MinIO now starts as a manual `docker run` step instead.
Fix verified against disposable containers matching CI's exact image
tags/credentials before push, then confirmed green on GitHub's own runners
(run `29549242802`, all 12 jobs `success`). Lesson: a CI gate that only
self-arms once real code lands (per this file's own "self-arming gates"
pattern) is, by definition, unverified against real infra until that day —
worth a deliberate dry-run next time a self-arming gate is about to arm for
the first time, rather than discovering it via a broken merge.

## Active Tasks
See `.ai-team/task-board.yaml` (single tracker).

## Major Decisions
- ADR-0001 — Technology stack: Node/TypeScript monorepo (Accepted)
- ADR-0002 — Repository layout canonicalization (Accepted; per-agent ownership parts superseded by ADR-0004)
- ADR-0003 — Evaluation framework: วPA ว9/2564 (ครู) + ว10/2564 (ผู้บริหาร); taxonomy in `docs/architecture/evaluation-framework.md` (Accepted)
- ADR-0004 — Single-agent development by Claude Code (Accepted)
- ADR-0005 — Object storage: MinIO / S3-compatible; deployment: on-premise (Accepted)
- ADR-0006 — Implementation frameworks: Fastify (api), Vite+React (web), npm workspaces (Accepted)

## Open Questions
- OPEN-3: AI provider + PDPA data-residency (blocks Sprint 2 AI-mapping only). **Note: ADR-0005 keeps all evidence on Thai on-prem hardware — sending it to a foreign AI provider would cross the border this decision avoids. OPEN-3 must respect that.**
- ~~OPEN-1~~ GitHub · ~~OPEN-2~~ วPA per ADR-0003 · ~~OPEN-4~~ MinIO on-prem per ADR-0005 · ~~OPEN-5~~ AI-mapping task created in Sprint 2 planning

## Known Risks
- Criteria and official forms may change by year → framework versioned as data (ADR-0003)
- AI mapping must remain human-reviewable
- Uploaded evidence contains personal data (PDPA) — never in git, storage design server-side
- Video storage can grow quickly (mitigated by ADR-0005 MinIO on-prem + retention policy)
- Solo-agent risk (replaces multi-agent drift risk): no independent reviewer — mitigate with CI gates + user review before contract lock
