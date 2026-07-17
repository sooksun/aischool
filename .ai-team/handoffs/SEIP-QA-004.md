# Close-out: SEIP-QA-004 — Browser e2e smoke

Branch: bundled on `feat/SEIP-WAVE-B-CF` · Date: 2026-07-18

## Delivered
- Playwright config + `tests/e2e/smoke-login-evidence.spec.ts`
- `tests/e2e/global-setup.mjs` creates `e2e-teacher@seip.local`
- CI job `Gate: e2e smoke` (Postgres + MinIO + api + vite + chromium)
- `QUALITY-GATES.md` documents local + CI path
- `npm run test:e2e`

## Smoke path
login → หลักฐานของฉัน → /evidence/new pick step
