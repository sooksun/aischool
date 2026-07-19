# Quality Gates — Runnable Definitions (SEIP-QA-001)

Status: Operational since 2026-07-17 · replaces the checklist version
CI: `.github/workflows/ci.yml` · Local: `npm run gate:*`
Pattern: **LIVE** gates run now; **SELF-ARMING** gates watch for their subject and activate automatically when Sprint 1 lands it — no workflow edits needed.

## PR gates (run on every push/PR to develop/main)

| Gate | Command (pass = exit 0) | CI job | State | Arming condition |
|---|---|---|---|---|
| Module ownership | `npm run gate:ownership` | `Gate: module ownership` | **LIVE** | always |
| Contract compatibility | `npm run gate:contracts` (lint + typegen + yaml parse + **authz coverage**) **+** oasdiff breaking vs base, `--fail-on ERR`, on **both** PR and push | `Gate: contract compatibility` | **LIVE** | always; diff skips only if base has no openapi.yaml |
| Secret scan | gitleaks v8.18.4 (pinned), full history, `--redact` · local: `npm run gate:secret-scan` | `Gate: secret scan` | **LIVE** | always |
| Dependency audit | `npm run gate:dep-audit` (`npm audit --audit-level=high`) | `Gate: dependency audit` | **LIVE** | lockfile present (committed 2026-07-17) |
| Format | `npm run format:check` | `Gate: format` | self-arming | `scripts.format:check` defined |
| Lint | `npm run lint` | `Gate: lint` | self-arming | `scripts.lint` defined |
| Type check | `npm run typecheck` | `Gate: type check` | self-arming | `scripts.typecheck` defined |
| Unit tests | `npm run test:unit` | `Gate: unit tests` | self-arming | `scripts.test:unit` defined |
| Integration tests | `npm run test:integration` | `Gate: integration tests` | self-arming | `scripts.test:integration` defined |
| Build | `npm run build` | `Gate: build` | self-arming | `scripts.build` defined |
| Migration validation | `npx prisma validate` (DB-001 extends: `migrate diff` up/down) | `Gate: migration validation` | self-arming | `prisma/schema.prisma` exists |
| Permission tests | `npm run test:security` — asserts the `permissions.yaml` matrix (esp. cross-school RES-001) | `Gate: permission tests` | self-arming | files in `tests/security/` |
| E2E smoke | `npm run test:e2e` (Playwright: login → evidence list → open submit) | `Gate: e2e smoke` | **LIVE** (SEIP-QA-004) | always; needs MySQL 8 + MinIO + api + web (ADR-0008) |
| Code owner review | — (not a CI job) | branch protection + CODEOWNERS | policy | requires branch protection (below) |

**Pass thresholds:** every gate is binary (exit 0). `dep-audit` fails on **high+** advisories. oasdiff fails on **breaking** changes only (additive contract changes pass). Secret scan fails on any leak — a confirmed false positive gets an inline `// gitleaks:allow` comment on the exact flagged line (gitleaks' native line-level suppression), with a code comment explaining why it isn't a real secret, reviewed in the same PR. Never skip the gate to work around one. (A repo-wide `.gitleaks.toml` allowlist was tried first for SEIP-API-001's one false positive — `credentials: { ..., secretAccessKey: env.S3_SECRET_KEY }`, gitleaks' `generic-api-key` rule matching the *identifier* `secretAccessKey:` regardless of the RHS being a literal or a variable reference — but its regex/fingerprint matching didn't reliably suppress findings already baked into git history when run through the pinned docker image; the inline comment is simpler, guaranteed to work per-line, and keeps the justification next to the code it excuses.)

**Why the contract check runs on push, not just PRs:** ADR-0004 sanctions committing straight to `develop`, so a PR-only breaking-change check would almost never execute in the real workflow. On `push` it diffs against `github.event.before`; on `pull_request`, against the target branch. Both paths fail the build on a breaking change without an accompanying version bump.

**Authz coverage (SEC-TEN-5):** `gate:contracts` fails if any `operationId` in `openapi.yaml` lacks either a rule in the `permissions.yaml` matrix or an explicit entry under `unauthenticated:` / `any_authenticated:`. An endpoint cannot ship with undocumented authorization.

## Coverage caveats — what a green run does NOT prove

Added 2026-07-19 after a full code audit found the suite passing on a system that cannot be deployed. **A green gate bounds only what it actually exercised.** Every known place where the gates' coverage is narrower than their name suggests is listed here. Keeping this list honest is part of the gate.

**Rule going forward:** any test fixture that reaches past the API — direct Prisma writes, hand-seeded rows, mocked auth — **must be recorded in this section** in the same change that introduces it. A fixture that manufactures state the product cannot manufacture makes the suite prove the wrong thing.

| Caveat | Evidence | Consequence |
|---|---|---|
| ~~**Fixtures bypass the API to create state the product cannot create**~~ — **closed 2026-07-19** | `grep -rn "performanceAgreement.create" apps/ tests/` returns only the repository that implements it. CCR-014 made identity rows creatable (`tests/e2e/onboarding.spec.ts` onboards a teacher through the browser); CCR-015 did the same for agreements, and `global-setup.mjs` now **fails loudly** if the API is unreachable rather than falling back to a direct write | What remains is scaffolding for flows that *do* have working operations (cycle, round, assignment, ready-report payload) — desirable to convert, but no longer capable of hiding an unreachable path. The one identity still created outside the API is the bootstrap admin, an operator CLI by design (CCR-014 decision 1) |
| ~~**Permission sweep covers 28 of 31 matrix operations**~~ — **closed 2026-07-19** | Sweep now covers **40 of 41** rows (`permission-matrix.test.mjs`, 240 assertions). `completeFileUpload` and `getEvidenceFileDownloadUrl` were added and immediately reported 3 mismatches — all three were the sweep not knowing those ops are ownership-gated, not enforcement bugs | The single remaining exclusion is `getAssignmentResults`, excluded *deliberately* with a documented reason and covered by `scoring-flow.test.mjs:333` |
| **No coverage instrumentation exists anywhere** | no `coverage` config in any vite/vitest config or `package.json` | The 164 test cases have no denominator. "Unit tests pass" says nothing about what fraction of the code ran |
| **Three e2e tests skip silently green** | `tests/e2e/flows-depth.spec.ts:82`, `:107`, `:127` — `test.skip(!creds.…)` | If `global-setup.mjs` half-fails in CI, the three deepest flows vanish and the build still reports success. A CI-only `throw` would close this |
| **One e2e assertion is still too soft** — *half closed 2026-07-19* | The create-report test now asserts the report list actually grew by one, not just that the form closed. **Still soft:** the PDF test asserts only `/\.pdf$/i` on the suggested filename | A 0-byte or HTML-error body saved as `.pdf` still passes. Asserting on downloaded bytes is the fix |
| **`Gate: integration tests` does not run the integration suites** | root `test:integration` in `package.json` is byte-identical to `test:backend` (`node --test "tests/backend/*.test.mjs"`) | The job name overstates it. Saved only because `ci.yml:226-231` invokes the three workspace suites separately. Also `ci.yml:216` creates the MinIO bucket *after* the step that would need it |
| **`file.process` performs no malware scan** | CCR-012 deleted the filename-matching stub rather than replacing it; `apps/worker/src/jobs/file-process.ts:75-82` only compares stored size to declared size | No gate asserts uploaded evidence is safe, because nothing checks. `unscanned` is disclosed in the UI and still served (`apps/api/src/routes/evidence.ts:376`) |
| **`dep-audit` ignores moderate advisories** | `npm audit --audit-level=high` | Moderate CVEs pass silently. Deliberate, noted here for completeness |
| **Test files share one database and one worker-job queue** | `node:test` runs files in parallel processes against the same MySQL and the same `worker_job` table. `reports-and-ai.test.mjs` calls `runOnce`, which claims **one** job — a sibling file's `file.process` job can be the one it takes | Surfaced 2026-07-19 as a ~2-in-3 flake once the CCR-014/CCR-015 suites made the queue busier. Fixed by looping until *that* job is claimed rather than assuming the next one is yours. **Any future test that calls `runOnce` must do the same** — a queue race reads exactly like a product bug, and a gate that fails at random is a gate people learn to ignore |
| **No SAST, no container image scan, no license check** | `.github/workflows/ci.yml` has no CodeQL/Trivy/Grype job despite three Dockerfiles | Image and code-level vulnerability classes are entirely unexamined |

## Release gates (run before tagging a release from main — not CI jobs yet)

| Gate | Owner (ADR-0004: claude executes, user approves) | Trigger | Command status |
|---|---|---|---|
| End-to-end tests | claude | before merge develop→main | **smoke armed** — `npm run test:e2e` / CI `Gate: e2e smoke` (login→evidence); expand coverage per release |
| Security tests | claude | before merge develop→main | scenario list seeded by SECURITY-BASELINE.md |
| Backup/restore test | claude + user | before first production deploy, then per release | procedure written with DB-001 (needs real schema) |
| Report accuracy | claude + user (คนตรวจแบบ ก.ค.ศ.) | any release touching report generation | golden-file compare vs PA2/PA3 samples — Sprint with reports |
| Accessibility | claude | any release touching UI | axe-core automated + manual checklist from `ux/evidence-submission-flow.md` §Accessibility |
| Performance | claude | release with upload path changes | k6 upload-path scenario — Sprint 1 |
| UAT | user | before production go-live | script from UX flows |

## Enforcement — GitHub required status checks

Branch protection on `develop` and `main` should require these check names (exact strings):

```
Gate: module ownership
Gate: contract compatibility
Gate: secret scan
Gate: dependency audit
Gate: e2e smoke
```

### E2E smoke (SEIP-QA-004)

Local (API already on `PORT` matching Vite proxy, default proxy `3011`):

```bash
# terminal 1: MinIO via docker compose (DB is the host's Laragon MySQL 8, ADR-0008), then:
export DATABASE_URL=... JWT_SECRET=... S3_*=... PORT=3011
npm run build:libs && npm run build --workspace apps/api
node apps/api/dist/index.js

# terminal 2 (optional — playwright.config spawns vite itself when E2E_BASE_URL is unset):
npm run dev --workspace apps/web

# terminal 3:
npx playwright install chromium
npm run test:e2e
```

**Windows PowerShell 5.1:** `&&` is a parser error — chain with `;` or separate
lines (`docker compose up -d; npm run db:migrate; npm run db:seed`), and set env
vars as `$env:DATABASE_URL = "..."` before `npm run test:e2e` (global-setup needs
it to seed fixtures). The spawned vite is forced to `--host 127.0.0.1` in
playwright.config.ts because on Windows vite's default host can bind IPv6-only
(`[::1]`), which the IPv4 `baseURL` poll never reaches (found 2026-07-18 — the
local webServer path had never actually run on Windows before that).

CI starts MySQL 8, MinIO, migrate+seed, API, Vite, then Playwright Chromium.
Fixture users from `tests/e2e/global-setup.mjs`:
- `e2e-teacher@seip.local` — evidence upload + reports nav
- `e2e-director@seip.local` — cycles, create report, PDF, chair scoring
- committee fixtures + ready report seeded in global-setup (no worker required for PDF)

Smoke + depth (L2): login → evidence list/submit/upload; director cycles/reports/evaluator; session refresh; create report; PDF download; chair score submit.

Add the self-arming gate names to the required list **when they arm** (a required check that always no-ops gives false confidence; a required check that's armed is real). Protection setup itself still needs `gh auth login` or the web UI — steps recorded in `.ai-team/handoffs/SEIP-OPS-001.md`.

## Verified runs (2026-07-17, local)

| Command | Result |
|---|---|
| `npm run gate:ownership` | exit 0 — 5 modules, 27 globs, 0 errors |
| `npm run gate:contracts` | exit 0 — lint OK, typegen OK, 3× yaml parse OK |
| `npm run gate:dep-audit` | exit 0 — 0 vulnerabilities |
| `npm run gate:secret-scan` | exit 0 — 7 commits scanned, no leaks (docker image, pinned v8.18.4) |
| oasdiff breaking (develop v0.1-draft → ARCH-002 v1.0.0) | exit 0 — "No breaking changes to report" (docker, digest-pinned) |

## Verified runs (2026-07-18, local — SEIP-SEC-002, full suite; closes the audit's "no recorded test run" finding)

Against disposable Postgres 16 (:15439, fresh migrate deploy + seed) and MinIO
(:19001) — never the shared dev stack. Every suite the CI defines, executed and
passing on the same tree that introduced CCR-008 + the committee-integrity fix:

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 — all 6 workspaces |
| `npm run lint` | exit 0 — **now a real gate**: apps/web ESLint (typescript-eslint + react-hooks + jsx-a11y), 0 problems. Before this, no workspace defined `lint`, so the CI job was a silent no-op |
| `npm run test:backend` | 19/19 |
| `npm run test:integration --workspace apps/api` | 27/27 (incl. 4 new CCR-008 session tests + committee-eligibility test) |
| `npm run test:integration --workspace apps/worker` | 9/9 |
| `npm run test:integration --workspace packages/database` | 9/9 |
| `npm run test:unit --workspace packages/auth` | 13/13 |
| `npm run test:unit --workspace apps/web` | 20/20 |
| `npm run test:security` | 3/3 (permission sweep now covers 34 operations · 4 exemptions) |
| `npm run gate:contracts` | exit 0 — openapi 2.3.0, generated types + constants in sync |
| `npm run gate:ownership` | exit 0 |
| `npm run gate:dep-audit` | exit 0 — 0 vulnerabilities |

## Verified runs (2026-07-18, local — full suite incl. e2e, Windows host)

Against the shared dev compose stack (:5433/:9000), migrate deploy (no pending) +
seed (792 level rows). All green: `test:backend` 19/19 · api integration 29/29 ·
worker 9/9 · database 9/9 · `test:security` 3/3 · `typecheck` all workspaces ·
gates ownership/contracts/dep-audit exit 0 · **`test:e2e` 10/10** — the first
time the L2 depth specs ever ran green anywhere (CI does not run on `feat/*`
branches, and the local webServer path was broken on Windows — see the
PowerShell/IPv4 note above). The run surfaced and fixed **5 authoring bugs in
`flows-depth.spec.ts`** (substring locators hitting "ไม่ผ่าน…", regex passed to
`selectOption`, missing shell-wait before `page.goto` mid-login, missing
`page.reload()` before asserting sessionStorage rotation) — all test bugs; no
app defects found. Two first-run-only flakes (1× api integration, 2× worker
file-process) appeared on the cold stack and vanished on re-run — consistent
with cross-suite state in the shared dev DB; the disposable-stack discipline
above remains the recommendation for release verification.

## Verified runs (2026-07-18, local — ADR-0008 MySQL migration, full suite + e2e)

Engine switched PostgreSQL → **MySQL 8.0.30** (Laragon host server, ADR-0008);
migrations rebaselined (init + constraints in MySQL dialect), backend raw-SQL
tests ported pg → mysql2. Everything re-verified on the same day against
`mysql://root@localhost:3306/seip`:

| Command | Result |
|---|---|
| `npm run db:migrate` + `db:seed` | exit 0 — 2 migrations, 792 level rows (432+360) |
| `npm run test:backend` | 19/19 — CHECKs, BINARY email check, trigger-maintained `active_uk_key`, generated `pa_uk_key` + threshold, append-only triggers all enforced by MySQL itself |
| `npm run test:integration --workspace apps/api` | 29/29 (one Prisma JSON-path filter ported to `'$.field'` form) |
| worker / database / security suites | 9/9 · 9/9 · 3/3 |
| `npm run typecheck` / `lint` / `build` / `test:unit` | all green (one cast added: evidence.ts UPL-001 `allowed_mime_types` Json) |
| `npm run gate:ownership` / `gate:contracts` | exit 0 — contracts untouched by the engine swap |
| **`npm run test:e2e`** | **10/10** — upload → scan-gated download, session refresh, report + PDF, chair scoring, all against Laragon MySQL |

**Branch protection (user action still required):** `test:unit` / `test:integration` /
`test:security` / `typecheck` / `build` / `lint` are armed and green but NOT in the
required-check list above — a PR can still merge with them failing. Add them via
GitHub → Settings → Branches → develop/main, or:
`gh api -X PATCH repos/sooksun/aischool/branches/develop/protection/required_status_checks -f "contexts[]=..."`
(needs `gh auth login`; agent sessions here run unauthenticated by design).
