# Handoff — SEIP-CLEANUP-L1 (PDF UX fidelity)

## Summary
Contracts already accept that `getReportPdf` is **not** the pixel-perfect ก.ค.ศ.
Protected Artifact plate. Product UX now matches: no oversell of “official form”.

## Copy source
`apps/web/src/lib/reportPdfCopy.ts` — single place for list/detail Thai strings.

## User-facing changes
| Surface | Before risk | After |
|---|---|---|
| Report list intro | “ยังไม่ใช่ PDF” (outdated) / vague | JSON + PDF draft/review; not official plate |
| Download button | “ดาวน์โหลด PDF แบบฟอร์ม PA” | “ดาวน์โหลด PDF ร่าง/ตรวจสอบ” |
| Detail note | none when ready | Explicit non-official disclaimer |
| PDF banner | already cautious | Aligned draft/review wording |

## Non-goals
- No contract version bump (schema unchanged)
- No Protected Artifact layout work

## Verify
```
npm run typecheck --workspace apps/web
npm run test:unit --workspace apps/web
npm run build --workspace apps/api
node --env-file-if-exists=.env --test apps/api/test/report-pdf.test.mjs
```
