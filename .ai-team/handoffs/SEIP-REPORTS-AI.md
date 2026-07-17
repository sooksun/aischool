# Handoff — Reports + AI (bundled Wave D + E)

**Branch:** `feat/SEIP-REPORTS-AI` (based on `origin/develop` incl. OPS-003 `6b8b66c`)  
**Date:** 2026-07-18  
**Tasks closed on this branch:** SEIP-ARCH-003, SEIP-API-003, SEIP-WORKER-002, SEIP-UI-004, SEIP-ARCH-005, SEIP-API-004, SEIP-UI-005

## What shipped

### Contracts (CCR-005 → OpenAPI **2.1.0**)
- Paths: `GET/POST /reports`, `GET /reports/{reportId}`, `POST /evidence/{id}/mappings/suggest`
- Schemas: Report*, MappingSuggest*, ReportTemplateCode, ReportStatus
- permissions.yaml **1.1.0** — listReports, createReport, getReport, suggestMappings
- events.yaml **1.1.0** — `report.generated`, `ai.suggestion.created`
- error-codes.yaml **1.1.0** — RPT-001, AI-001
- ADR-0007: **local_heuristic only** (no foreign LLM while ADR-0005 holds)

### Backend
- `packages/database` — `reports.ts` repo + `local-heuristic-mapping` + `suggestMappingsLocalHeuristic`
- `apps/api` — `routes/reports.ts`; suggest on `mappings.ts`
- `apps/worker` — `report.generate` job fills payload + section_refs (confirmed mappings only)

### UI
- `/reports`, `/reports/:id` — list/create/detail with draft polling
- Evidence detail — “แนะนำตัวชี้วัด” (local heuristic); confirm only for director/school_admin (matrix: teacher is own-revoke)

## Verification
| Command | Result |
|---|---|
| `npm run gate:contracts` | green |
| `packages/database/test/local-heuristic.test.mjs` | 3/3 |
| `apps/api/test/reports-and-ai.test.mjs` | 3/3 |
| `npm run test:security` | 3/3 |
| build libs + api + worker; web typecheck | green |

## Not in scope / follow-ups
- Official PA PDF layout (x-deferred.report-pdf-layout)
- Cloud LLM (requires new ADR superseding 0007)
- listPersonnel API (create report form still accepts subject UUID by hand)
- Approval workflow UI (`report.approved` still deferred in events)
- OPS-003 / API-003a / UI-003 remain on other branches unless already merged

## Merge note
User should review CCR-005 + ADR-0007 then merge `feat/SEIP-REPORTS-AI` → `develop`.
