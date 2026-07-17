# Close-out: PA form PDF + expanded e2e

Branch: `feat/SEIP-PDF-E2E` · Date: 2026-07-18

## PDF (official-style form)
- `GET /reports/{id}/pdf` → `application/pdf` (OpenAPI **2.2.0**, CCR-007)
- Generator: `apps/api/src/lib/pa-report-pdf.ts` (pdfkit + Noto Sans Thai)
- RPT-002 when draft / generation pending
- UI: download button on `ReportDetailPage`
- Unit: `apps/api/test/report-pdf.test.mjs`

## E2E expanded
- global-setup: teacher **and** director users + optional open cycle
- Specs: teacher evidence + reports nav; director cycles, reports, evaluator nav

## Verify
```
npm run codegen:contracts && npm run gate:contracts
npm run build --workspace apps/api
node --env-file-if-exists=.env --test apps/api/test/report-pdf.test.mjs
npm run typecheck --workspace apps/web
# with stack up:
npm run test:e2e
```
