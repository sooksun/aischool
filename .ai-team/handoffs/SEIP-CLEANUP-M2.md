# Handoff — SEIP-CLEANUP-M2 (ReportPayloadV1)

## Summary
Single typed `ReportPayloadV1` (`schema_version=1`) for the full report payload path:
Worker generate → Prisma JSON → API getReport → PDF → OpenAPI/UI.

## Surfaces
| Layer | Change |
|---|---|
| `@seip/backend-shared` | `report-payload-v1.ts` types + parse/coerce/pending helpers |
| `packages/database` | create draft + `generateReportPayload` use typed payload |
| `apps/api` | routes + `pa-report-pdf` coerce/use `ReportPayloadV1` |
| openapi **2.6.0** | `ReportPayload` schema; `ReportDetail.payload` `$ref` |
| `apps/web` | ReportDetailPage uses generated `ReportPayload` fields |

## CCR
`docs/reviews/CCR-011-report-payload-v1.md`

## Verify
```
npm run gate:contracts
npm run codegen:api-types
npm run build:libs
npm run test:unit --workspace packages/backend-shared
npm run build --workspace apps/api
npm run typecheck --workspace apps/web
node --env-file-if-exists=.env --test apps/api/test/report-pdf.test.mjs
```
