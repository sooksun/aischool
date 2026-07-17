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
