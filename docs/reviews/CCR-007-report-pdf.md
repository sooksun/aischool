# CCR-007: Report PDF download (additive → OpenAPI 2.2.0)

## Request
Expose on-demand PA form PDF from structured report payload so SPA can print/review without embedding file bytes in the DB.

## Changes
| Surface | Change |
|---|---|
| openapi.yaml | **2.1.0 → 2.2.0**; `GET /reports/{reportId}/pdf` (`getReportPdf`) |
| permissions.yaml | **1.1.0 → 1.2.0**; `getReportPdf` same grants as `getReport` |
| error-codes.yaml | **1.2.0 → 1.3.0**; `RPT-002` PDF not ready |

## Breaking?
No — additive paths/codes only.

## Notes
PDF is SEIP structure-faithful PA1/PA2/PA3 layout (Thai font), not the Protected Artifact pixel plate.
