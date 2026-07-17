# Close-out: SEIP-WORKER-001 — Async worker (outbox, scan, duration, GC)

Owner: grok (co-pilot) · Date: 2026-07-18 · Branch: `feat/SEIP-WORKER-001-async-pipeline`  
Collision: Claude holds UI cycles/scoring (`apps/web/**`) — not touched.

## Delivered

| Artifact | Role |
|---|---|
| `prisma` OutboxEvent + WorkerJob models + migration `20260718120000_worker_outbox` | Transactional outbox + job queue |
| `packages/database` `outbox.ts`, `jobs.ts`, `registerEvidenceFileWithWorkerJobs` | Same-TX file + outbox + job |
| `apps/worker` | Poll loop: `file.process`, `storage.gc`, outbox publish |
| `apps/api` completeFileUpload | Uses register helper (minimal secondary path) |
| `docker-compose.yml` profile `worker` | Optional container |
| `npm run dev:worker` | Host runner |

## Behaviour

1. **completeFileUpload** writes `evidence_file` (scan=pending) + draft→active + outbox `evidence.file.registered` + job `file.process` in one transaction.
2. **Worker** claims jobs → HEAD MinIO object → stub scan (eicar/virus filename → blocked, else clean) → video duration probe if null → outbox `evidence.file.scan_completed` → mark registered outbox published.
3. **Outbox dispatch** marks remaining unpublished events published (notification channel deferred).
4. **storage.gc** deletes MinIO objects + file rows for soft-deleted evidence older than `WORKER_GC_AFTER_DAYS`.

Scan/duration are **stubs with documented rules** (ClamAV/ffprobe later without new process).

## Verification

```
npm run build:libs && npm run build --workspace apps/worker
npm run test:integration --workspace apps/worker   # 5/5
npm run test:integration --workspace apps/api      # 12/12 (no regression)
```

## Paths not touched

`apps/web/**` (Claude UI).

## Review pass (claude, 2026-07-18) — 3 blocking issues found and fixed before merge

Independently reviewed against this repo's established conventions (tenancy-by-construction, CAS-based job claiming already proven in `jobs.ts`) before merging third-party work, same bar as any other PR. Found and fixed:

1. **`claimUnpublishedOutbox` had no locking despite its own docstring claiming otherwise** (`outbox.ts`) — a bare `findMany`, not the CAS pattern `jobs.ts`'s `claimPendingJobs` already uses correctly one file over. Fixed: same per-row `updateMany({where:{id, publishedAt:null}, ...})` + `count===1` check, reusing `attempts` (already incremented on failure) as the claim gate rather than adding a new column. Harmless today only because dispatch is a no-op stub; would have caused duplicate delivery the moment real fan-out lands.
2. **`apps/worker`'s tests never ran in CI** — `ci.yml`'s `integration` job had steps for `apps/api` and `packages/database` but not `apps/worker`, despite the handoff's original "5/5" being real (just never continuously verified). Added the missing step.
3. **`storage.gc` had zero test coverage** — the only job type of the three this task delivers with no test at all. Added `apps/worker/test/storage-gc.test.mjs`: eligible (past cutoff), not-yet-eligible (soft-deleted but within retention), never-deleted, and already-gone-from-S3 cases — 4 new tests against real Postgres + MinIO.

Also fixed one non-blocking finding: `getEvidenceFileById` took no `schoolId`, breaking this file's own stated "every function folds schoolId into WHERE" convention, and `processFileJob` had the data to cross-check tenancy but didn't. Fixed by adding `schoolId` as the function's first param (matching every other function in `evidence.ts`) rather than a bolt-on check after the fact.

**Not fixed here** (flagged, left for a follow-up — none block correctness today): hand-typed event payload types bypass the generated `EventType`/`Event_*` types from `@seip/backend-shared` (drift risk, no runtime bug); the outbox-publish short-circuit in `file-process.ts` overlaps with `dispatchOutboxBatch`'s own sweep in a way that's redundant but not wrong; a killed worker leaves a `worker_job` row stuck in `running` forever (no heartbeat/reaper); `WorkerJob.status`/`jobType` are plain `String` instead of enums like every other status field in this schema.

Re-verified end-to-end after all fixes, against disposable Postgres+MinIO (not the shared dev stack, since this branch carries its own migration): `apps/worker` 9/9, `apps/api` 12/12, `packages/database` 6/6, `test:security` 3/3, root `test:backend` 18/18, `gate:ownership` clean.

## Process note, not fixed here (flagging for the user, not deciding unilaterally)

This handoff and this session's `task-board.yaml`/`PROJECT_STATE.md` edits are written in the retired multi-AI model's own vocabulary — "Owner: grok (co-pilot)," cross-agent collision notes, a new path-based ownership scheme — dated 2026-07-18, one day after `CLAUDE.md` states ADR-0004 retired exactly this (file locks, cross-agent handoffs, per-agent module ownership). Not something I'm silently going along with or unilaterally reverting; surfaced to the user directly instead.
