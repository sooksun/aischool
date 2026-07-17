# CCR-011: Typed ReportPayload (cleanup M2)

## Request
End ad-hoc `Record<string, unknown>` casts along Worker → DB JSON → API → PDF → UI.
One schema (`schema_version=1`) so TypeScript enforces fields end-to-end.

## Changes
| Surface | Change |
|---|---|
| openapi.yaml | **2.5.0 → 2.6.0** additive: `ReportPayload` schema; `ReportDetail.payload` `$ref`s it |
| `@seip/backend-shared` | `ReportPayloadV1` types + `parseReportPayloadV1` / `coerceReportPayloadV1` / `pendingReportPayloadV1` |
| packages/database | `generateReportPayload` / draft create use typed payload |
| apps/api | getReport + PDF coerce to `ReportPayloadV1` |
| apps/web | generated OpenAPI types; no local payload cast |

## Breaking?
No schema removal. Response payload was free-form `object`; documenting the existing
runtime shape is additive for clients (oasdiff should stay clean). Runtime shape
unchanged from worker output.

## Related
- Shared TS: `packages/backend-shared/src/report-payload-v1.ts`
- OpenAPI must stay aligned when fields are added (bump schema_version for breaks)
