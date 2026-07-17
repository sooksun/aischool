# Handoff — SEIP-CLEANUP-H2 (lazy download_url)

## Summary
`serializeFile` no longer calls MinIO/S3. `getEvidence` and `completeFileUpload`
return `download_url: null` always. Clients fetch a short-lived URL only when the
user downloads via `GET /evidence/{id}/files/{fileId}/download-url`.

## Contract
- openapi **2.5.0** (CCR-010)
- permissions **1.4.0** — `getEvidenceFileDownloadUrl` (same grants as `getEvidence`)
- CCR: `docs/reviews/CCR-010-lazy-evidence-file-download-url.md`

## Implementation
| Layer | Change |
|---|---|
| API | `serializeFile` sync metadata-only; new route presigns when `scan_status=clean` else UPL-006 |
| Web | Evidence detail download button → lazy endpoint → open presigned URL |
| Tests | evidence-flow: detail never embeds URL; lazy path clean/pending/blocked |

## Why
- Metadata reads must not depend on MinIO availability
- List N+1 (B1) must not multiply S3 signing cost for non-download views
- Pages that only show scan status should not pay S3

## Verify
```
npm run gate:contracts
npm run codegen:api-types
npm run build --workspace apps/api
npm run typecheck --workspace apps/web
# with Postgres+MinIO:
node --test apps/api/test/evidence-flow.test.mjs
```
