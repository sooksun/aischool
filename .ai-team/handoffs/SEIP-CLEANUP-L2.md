# Handoff — SEIP-CLEANUP-L2 (e2e depth)

## Summary
Expand Playwright beyond shell login/nav to cover real product paths:
upload, session refresh (SEC-002), create report, PDF download, chair scoring.

## Layout
| File | Role |
|---|---|
| `tests/e2e/helpers.ts` | login + load fixtures |
| `tests/e2e/global-setup.mjs` | teacher/director + eval2/3, open cycle/round/assignment, ready report |
| `tests/e2e/smoke-login-evidence.spec.ts` | shell smoke (kept) |
| `tests/e2e/flows-depth.spec.ts` | depth flows (L2) |

## Paths covered
1. **Upload** — teacher stepper PDF → MinIO → complete → done (scan may stay pending; no worker)
2. **Session refresh** — corrupt access token → navigate reports → silent refresh (CCR-008)
3. **Create report** — director form with seeded cycle + teacher personnel UUID
4. **PDF** — open seeded ready report → download button → `.pdf` filename
5. **Score** — director chair on seeded assignment → fill rubrics + workload → submit

## CI note
Gate `e2e-smoke` already has Postgres+MinIO+api+web. No worker process required.

## Verify
```
# with api+web+db+minio running:
npm run test:e2e
```
