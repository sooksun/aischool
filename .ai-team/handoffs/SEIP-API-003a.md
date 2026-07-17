# Close-out: SEIP-API-003a — Presigned download when scan clean (UPL-006)

Branch: bundled on `feat/SEIP-WAVE-B-CF` · Date: 2026-07-18

## Delivered
- `presignDownload()` in `apps/api/src/lib/s3.ts` (GetObject, 15 min TTL)
- `serializeFile` issues `download_url` **only** if `scan_status === 'clean'`
- Never serializes `storage_uri`
- Tests: pending/blocked → null; clean → `http…` URL

## Verify
`npm run test:integration --workspace apps/api`
