# Cleanup B1–B3 (behavior-preserving)

Branch: `feat/cleanup-B1-B3` · Date: 2026-07-18  
Based on audit findings from `/code-review` (maintainability).

## B1 — List scan without N+1
- **Contract (CCR-009):** `Evidence.scan_status` nullable aggregate (pending > blocked > clean; null = no files)
- **API:** `listEvidence` includes file `scanStatus` only; `aggregateScanStatus()` in database package
- **UI:** `EvidenceListPage` uses list field; removed per-row `GET /evidence/{id}`

## B2 — Framework id on assignment detail
- **Contract:** `AssignmentDetail.framework_version_id` (required)
- **API:** `getAssignment` returns `assignment.round.cycle.frameworkVersionId`
- **UI:** deleted `discoverFrameworkVersionId` graph walk; uses detail field (+ optional nav state fallback)

## B3 — Authorized binary download
- **Client:** `authorizedFetch` + `downloadAuthorized` share in-memory access/school tokens with openapi-fetch; 401 refresh path aligned
- **UI:** `ReportDetailPage` no longer reads `sessionStorage` for auth

## Verify
```
npm run gate:contracts
npm run build:libs && npm run build --workspace apps/api
npm run typecheck --workspace apps/web
npm run test:unit --workspace apps/web
```
