# CCR-010: Lazy evidence file download URL (cleanup H2)

## Request
Stop presigning MinIO/S3 download URLs on every `getEvidence` / `completeFileUpload`
serialize. Metadata reads must not depend on object-storage availability, and
list→detail N+1 (B1) must not multiply S3 signing cost for pages that never
download.

## Changes
| Surface | Change |
|---|---|
| openapi.yaml | **2.4.0 → 2.5.0** additive: `GET /evidence/{evidenceId}/files/{fileId}/download-url` (`getEvidenceFileDownloadUrl`); `FileDownloadUrl` schema; `EvidenceFile.download_url` documented as always null on embedded payloads |
| permissions.yaml | **→ 1.4.0** additive: `getEvidenceFileDownloadUrl` (same grants as `getEvidence`) |
| Implementation | `serializeFile` never calls `presignDownload`; new route issues URL only when `scan_status=clean` (UPL-006) |
| UI | Evidence detail download button fetches lazy URL on click |

## Breaking?
Schema: **no** — field type unchanged; new endpoint only (oasdiff should be clean).

Behavior: **yes, intentional** — clients that expected a non-null `download_url` on
clean files from `getEvidence` must call `getEvidenceFileDownloadUrl` instead.
Acceptable: same monorepo clients updated in this change; no external consumers.

## Related
- UPL-006 still enforced at issue time (not only at serialize).
- B1 list `scan_status` reduced detail fetches; H2 stops the remaining S3 tax on detail.
