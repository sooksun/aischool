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
| E2E smoke | `npm run test:e2e` (Playwright: login → evidence list → open submit) | `Gate: e2e smoke` | **LIVE** (SEIP-QA-004) | always; needs PostgreSQL 18 + SeaweedFS + api + web (ADR-0012/0013) |
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
| ~~**`file.process` performs no malware scan**~~ — **closed 2026-07-20** | ClamAV wired per ADR-0009. `apps/worker/test/clamav-scan.test.mjs` covers the protocol against a real INSTREAM server and, when `CLAMAV_HOST` is set, EICAR against a real clamd; `file-process.test.mjs` covers what the job writes to `scan_status` | The load-bearing assertion is *"an unreachable scanner leaves the file pending — never clean"*. A deployment running `SCAN_PROVIDER=none` still serves `unscanned` files: that is disclosed, not gated. **2026-07-20:** the re-scan sweep added `scanned_at`, so a `clean` status with no receipt is now a detectable contradiction rather than an indistinguishable one — see the row below on nothing verifying the sweep was run |
| **The backup's object half has never actually run** | `mc` is not installed on the dev machine; `backups/` holds six dumps and zero `objects-*` mirrors | Found 2026-07-20 while re-verifying after a schema change. The MySQL dump is genuinely verified (restored into a scratch DB, 32 tables); the MinIO mirror exits 1 immediately. **The 2026-07-20 close-out reported "a real backup ran and verified 32 tables" without noting that the evidence bytes — the actual PDPA payload — were not in it.** The script behaves correctly (exit 1, `!!! BACKUP FAILED`) and `Dockerfile.backup` installs `mc`, so staging is expected to be fine — but *expected* is the operative word until §5.5 is run there |
| **Nothing verifies that a deployment actually ran the re-scan sweep** | `npm run rescan:files -- --report` is an operator action; no gate or startup check calls it | Enabling ClamAV covers new uploads only. A store carrying pre-CCR-012 rows keeps serving stub-written `clean` files — downloadable, badged ปลอดภัย, never scanned — until someone runs the sweep. The census names that number, but only if asked. Pre-go-live checklist item, not an automated gate |
| **`dep-audit` ignores moderate advisories** | `npm audit --audit-level=high` | Moderate CVEs pass silently. Deliberate, noted here for completeness |
| ~~**Integration suites never delete what they create**~~ — **closed 2026-07-20** | `tests/helpers/db-cleanup.mjs`, wired into all 9 API suites, both worker suites, the database evidence suite and both security suites. Measured from an **all-zero baseline** after `db:reset`: 144 tests leave `school=0 evidence=0 files=0 users=0 jobs=0 outbox=0 mappings=0 cycles=0 reports=0` | Latent for months, and only mattered once the ADR-0009 sweep started reading the whole store: a fixture row registered without ever putting an object in MinIO is indistinguishable from production evidence whose bytes were lost. `audit_event` is deliberately still never deleted — the immutability trigger refuses, correctly. **A zero baseline is what makes this measurable**: against the old 994-row database a delta of zero could hide a partial failure, and it did — three suites looked clean by delta and were not |
| ~~**e2e picked its framework by guessing**~~ — **fixed 2026-07-20** | `global-setup.mjs` selected `findFirst({status:'active', roleFamily:'teacher'}, orderBy revisionYear desc)`. Now selects `v9-2564-teacher` **by code**, and throws a sentence naming `npm run db:seed` if it is missing | Every leftover suite framework is created `active`, `teacher`, `revisionYear 2564` — identical on every field the query sorted by, so the winner was whichever row MySQL returned first. On the first post-reset e2e run that was a 3-indicator `rpt-fw-*` fixture with no challenge indicator: the entire e2e run silently moved onto a framework that is not the product's, then failed deep inside agreement creation with `SYS-001 framework has no challenge indicator`. **A leaked framework is worse than a leaked row — it shadows the seeded ว9 taxonomy (ADR-0003).** Frameworks are not school-scoped, so teardown missed them until `created.addFramework(...)` |
| **Two classes of fixture are invisible to school-scoped teardown** | Users with no school link (`score-foreign-*`, `session-attacker-*`) and **area-scoped memberships** (`area_admin` carries `schoolId = NULL` by contract, `membershipScope: 'area'`) | Both are deliberate — a non-member proving they cannot score, an area role proving it is read-only across schools — so both need `created.addUser(...)`, and the helper clears area memberships only for users named that way. Any new fixture that is intentionally school-less must do the same or it leaks silently, with green tests |
| **Test files share one database, one MinIO and one worker-job queue** | `node:test` runs files in parallel processes against the same MySQL, the same bucket and the same `worker_job` table. `reports-and-ai.test.mjs` calls `runOnce`, which claims **one** job — a sibling file's `file.process` job can be the one it takes | Surfaced 2026-07-19 as a ~2-in-3 flake once the CCR-014/CCR-015 suites made the queue busier. Fixed by looping until *that* job is claimed rather than assuming the next one is yours. **Any future test that calls `runOnce` must do the same.** Separately, on 2026-07-20 the `apps/worker` suite was observed failing 4 of 8 once when run in a compound command alongside other suites; **not reproducible in 5 subsequent runs**, cause not established, recorded here so a recurrence is investigated rather than dismissed as noise. A gate that fails at random is a gate people learn to ignore. **2026-07-20:** adding teardown surfaced two real robustness bugs of the same shape in `outbox.ts` and `jobs.ts` — see the row below |
| ~~**A single vanished row aborts an entire dispatch/poll cycle**~~ — **fixed 2026-07-20** | `markOutboxPublished`/`markOutboxFailed` and `markJobDone`/`markJobFailed`/`markJobTerminalFailed` used `update`, which throws P2025 when the row is gone. Now `updateMany`, returning a count | Both loops *claim* with a proper compare-and-swap and then completed with a call that assumed exclusive ownership of a row they had merely read. Worse, in each loop the recovery handler made the same call — so a P2025 in the `try` produced a second P2025 in the `catch`, which propagated out and abandoned every other claimed item in the batch. Found because test teardown began deleting rows concurrently, but nothing about it is test-only: any retention job, operator cleanup, or second worker would do the same. Regression test: `outbox-claim.test.mjs` "an event that disappears between claim and publish does not abort its batch" |
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
# terminal 1: `docker compose up -d` (PostgreSQL 18 + SeaweedFS, ADR-0012/0013), then:
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

CI starts PostgreSQL 18 (roles bootstrapped, migrations as `seip_migrator`), SeaweedFS, seed, API (as `seip_app`), Vite, then Playwright Chromium.
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

## Verified runs (2026-10-13, local — SEIP-P2-004, app capture first cut)

| Command | Result |
|---|---|
| mobile `flutter analyze --fatal-infos` · `flutter test` | pass, 16 (+1 capture flow), 2 live skipped |

## Verified runs (2026-10-13, local — SEIP-P2-003, web multi-file upload)

| Command | Result |
|---|---|
| `typecheck` · `lint` · `format:check` · `test:unit` · `gate:ownership` | pass. Web unit 48 (+3 batch queue) |
| `test:e2e` | 17/17 (new: batch-upload) |

## Verified runs (2026-10-13, local — SEIP-P2-002, offline outbox engine)

| Command | Result |
|---|---|
| mobile `flutter analyze --fatal-infos` · `flutter test` | pass, 15 (+5 outbox), 2 live skipped |
| `SEIP_API_URL=… flutter test test/live_outbox_test.dart test/live_api_test.dart` | 2/2 against the real API + SeaweedFS + worker: 17 MiB, drop after part 1, restart, only part 2 resent, sha256 verified |

## Verified runs (2026-10-13, local — SEIP-P2-001, duplicate files, contract 4.8.0)

| Command | Result |
|---|---|
| `typecheck` · `lint` · `format:check` · `test:unit` · `gate:contracts` · `gate:ownership` | pass |
| api · security · database · worker · `test:backend` | 137 (+2 duplicates) · 12 · 23 · 24 (+1) · 27 |
| `test:e2e` | 16/16 |
| Dart client analyse/test · mobile analyse/test | pass against 4.8.0 |

## Verified runs (2026-10-13, local — SEIP-P1-016, owner decisions OQ-31 / OQ-12, permissions 2.7.0)

| Command | Result |
|---|---|
| `typecheck` · `lint` · `format:check` · `test:unit` · `gate:contracts` · `gate:ownership` | pass |
| api · security · database · `test:backend` | 135 (+2 agreement-approver, +1 transfer OQ-12) · 12 · 23 · 27 |

## Verified runs (2026-10-13, local — SEIP-P1-015, evidence owner acceptance + move, contract 4.7.0)

| Command | Result |
|---|---|
| `typecheck` · `lint` · `format:check` · `test:unit` · `gate:contracts` · `gate:ownership` | pass. Web unit 45 |
| api · security · database · worker · `test:backend` | 132 (+3 evidence-context) · 12 · 23 · 23 · 27 |
| `test:e2e` | 16/16 |
| Dart client analyse/test · mobile analyse/test | pass against 4.7.0 |

## Verified runs (2026-10-13, local — SEIP-P1-014, personnel profile confirmation, contract 4.6.0)

| Command | Result |
|---|---|
| `typecheck` · `lint` · `format:check` · `test:unit` · `gate:contracts` · `gate:ownership` | pass. Web unit 45 |
| api · security · database · `test:backend` | 129 (+3 personnel-profile) · 12 · 23 · 27 |
| Dart client analyse/test · mobile analyse/test | pass against 4.6.0 |

## Verified runs (2026-10-13, local — SEIP-P1-013, admin-issued password reset, contract 4.5.0)

| Command | Result |
|---|---|
| `typecheck` · `lint` · `format:check` · `test:unit` · `gate:contracts` · `gate:ownership` | pass. Web unit 45 |
| api · security · database · `test:backend` | 126 (+4 password-reset, one against real Keycloak) · 12 · 23 · 27 |
| Dart client analyse/test · mobile analyse/test | pass against 4.5.0 |

## Verified runs (2026-10-13, local — SEIP-P1-012, device sessions, no contract change)

| Command | Result |
|---|---|
| `typecheck` · `lint` · `format:check` · `test:unit` · `gate:contracts` · `gate:ownership` | pass. Auth unit 25 (+azp), web unit 45 |
| api · security · database · `test:backend` | 122 (+2 devices, real Keycloak) · 12 · 23 · 27 |
| mobile analyse · test | pass, 10 (+1 User-Agent) |

## Verified runs (2026-10-13, local — SEIP-P1-011, transfer within one สพท., no contract change)

| Command | Result |
|---|---|
| `typecheck` · `lint` · `format:check` · `gate:contracts` · `gate:ownership` | pass |
| api · security · database · `test:backend` | 120 (+3 transfer) · 12 · 23 · 27 |

## Verified runs (2026-10-13, local — SEIP-P1-010, area admin manages schools, contract 4.4.0 / permissions 2.3.0)

| Command | Result |
|---|---|
| `typecheck` · `lint` · `format:check` · `gate:contracts` · `gate:ownership` | pass. oasdiff 4.3.0 → 4.4.0: no breaking changes (the policy change is CCR-021, approved by the owner). Web unit 45 |
| api · security · `test:backend` | 117 (+4 area-schools) · 12 (sweep covers the 4 new ops) · 27 |
| Dart client analyse/test · mobile analyse/test | pass against 4.4.0 |

## Verified runs (2026-10-13, local — SEIP-P1-009, school context, contract 4.3.0)

| Command | Result |
|---|---|
| static gates · `test:unit` | pass. oasdiff 4.2.0 → 4.3.0: no breaking changes. Web unit 44 |
| api · security | 113 · 12 (+2 school-context) |
| `test:e2e` | 16/16 (new: school-picker) |
| Dart client analyse · mobile test | pass |

## Verified runs (2026-10-13, local — SEIP-P1-008, bulk member import, contract 4.2.0)

| Command | Result |
|---|---|
| `typecheck` · `lint` · `format:check` · `test:unit` · `gate:contracts` · `gate:ownership` · `gate:dep-audit` | pass. oasdiff 4.1.0 → 4.2.0: no breaking changes. Web unit +3 (CSV parser) |
| api · security · `test:backend` | 111 · 12 · 27. All pass (+3 member-import; sweep and step-up cover importMembers) |
| `test:e2e` | 15/15 (new: admin uploads a CSV, checks it, imports it) |
| Dart client · `apps/mobile` | pass against 4.2.0 |

## Verified runs (2026-10-13, local — SEIP-P1-006, Flutter SEIP ID + step-up expiry)

Flutter 3.47.7 reinstalled in the container.

| Command | Result |
|---|---|
| Dart client: generate · `dart analyze --fatal-infos` · `dart test` | pass |
| `apps/mobile`: `flutter analyze --fatal-infos` · `flutter test` | no issues · 9 pass, 1 live test skipped (+7 seip_id_test) |
| `typecheck` · `lint` · `format:check` · `test:unit` · `gate:contracts` · `gate:ownership` · `gate:dep-audit` | pass (auth unit tests +1 for step-up expiry) |
| api · security · `test:backend` · database · worker | 108 · 9 · 27 · 23 · 23. All pass (+2 mobile offline session / acr through refresh, +1 web step-up expiry) |
| `test:e2e` | 14/14 |

**Not run:** the app on an Android emulator or iOS simulator. No emulator is available here.

## Verified runs (2026-10-13, local — SEIP-P1-005, Keycloak provisioning)

| Command | Result |
|---|---|
| `typecheck` · `lint` · `format:check` · `test:unit` · `gate:contracts` · `gate:ownership` · `gate:dep-audit` | pass |
| api · security · `test:backend` · database · worker | 105 · 9 · 27 · 23 · 23. All pass, with provisioning switched on for every suite (+5 keycloak-provisioning) |
| `test:e2e` | 14/14 |

## Verified runs (2026-10-13, local — SEIP-P1-004, web sign-in through Keycloak, contract 4.1.0)

| Command | Result |
|---|---|
| `typecheck` · `lint` · `format:check` · `test:unit` | pass |
| `gate:contracts` · `gate:ownership` · `gate:dep-audit` | pass; oasdiff 4.0.0 → 4.1.0: no breaking changes |
| api · security · `test:backend` · database · worker | 100 · 9 · 27 · 23 · 23 — all pass (+7 web-session, against the real realm) |
| `test:e2e` | 14/14 (new: sso.spec — SEIP ID button → Keycloak → shell → reload → CSRF-checked sign-out) |

**Not run locally:** the Dart client and `apps/mobile` gates (no Dart/Flutter SDK in this
container after it was recycled). CI ran both against the 4.1.0 contract: run
[38328163583](https://github.com/sooksun/aischool/actions/runs/38328163583) on `d3beedb`,
all jobs green, e2e sso.spec included.

## Verified runs (2026-10-13, local — SEIP-P1-003, Keycloak + step-up)

Keycloak 26.7.5 with `infra/keycloak/seip-realm.dev.json`, `KEYCLOAK_ISSUER` set.

| Command | Result |
|---|---|
| `typecheck` · `lint` · `format:check` · `test:unit` | pass (auth +5 OIDC, backend-shared +4 min_acr) |
| `gate:contracts` · `gate:ownership` · `gate:secret-scan` | pass |
| api · security · `test:backend` · database · worker | 93 · 9 · 27 · 23 · 23 — all pass (+8 step-up, against the real realm) |
| `test:e2e` | 13/13 |

CI now starts Keycloak in the integration job (`scripts/ci/keycloak.sh`). The step-up
suite fails rather than skips when `CI=true` and `KEYCLOAK_ISSUER` is missing.

**Caveat:** `ENFORCE_MIN_ACR` defaults to false. The step-up suite proves the
enforcement works when it is on. It does not mean a deployment enforces it.

## Verified runs (2026-10-13, local and CI — SEIP-P1-002, RLS backstop)

CI: run [38325277042](https://github.com/sooksun/aischool/actions/runs/38325277042) on `7a6a9d3` — green.

Bootstrap re-run (adds `seip_scoped`), then `migrate deploy` of `20261013000200_rls_backstop`.

| Command | Result |
|---|---|
| `build` · `typecheck` · `lint` · `format:check` · `test:unit` | pass (web 39 unit tests, +1 for the FEATURE_SCORING mask) |
| `gate:contracts` · `gate:ownership` · `gate:dep-audit` · `gate:secret-scan` | pass |
| `test:backend` · database · worker · api · security | 27 · 23 · 23 · 85 · 9 — all pass (+7 rls-backstop, +5 area-scope) |
| `test:storage` · `test:e2e` | 4/4 · 13/13 |

**Caveat:** the backstop covers only what runs inside `withAreaScope` (today `listEvidence`).
A green run does not mean every read is area-fenced at the database (ADR-0019 Consequences).

## Verified runs (2026-10-12, local and CI — SEIP-P1-001, contract 4.0.0 applied)

CI: run [38321728017](https://github.com/sooksun/aischool/actions/runs/38321728017) on `03f64b8` — all 15 jobs green.

Fresh database (bootstrap → migrate as `seip_migrator` → seed). `FEATURE_SCORING=true`
for the API suites, as in CI, so the frozen v2 scoring and report routes keep their
tests (ADR-0017).

| Command | Result |
|---|---|
| `build` · `typecheck` · `lint` · `format:check` · `test:unit` | pass (web 38 unit tests) |
| `gate:contracts` · `gate:ownership` · `gate:dep-audit` · `gate:secret-scan` | pass (74 ops, authz coverage OK; 0 vulnerabilities; no leaks) |
| contract compatibility vs develop (oasdiff) | 95 breaking items, accepted on the 2.6.0 → 4.0.0 major bump (CCR-017) |
| `test:backend` · database · worker · api · security | 20 · 18 · 23 · 85 · 9 — all pass |
| `test:storage` (S3 conformance) | 4/4, twice in a row (the suite now drops its buckets) |
| `test:e2e` | 13/13 (new: teacher maps at upload, director validates) |
| Dart client generate + analyse + test · `apps/mobile` analyse + test | pass |

The permission sweep now **derives its coverage from the matrix**. It fails if any
served `permissions.yaml` row has no sweep entry, instead of comparing against a
hand-kept count. The one exclusion is getAssignmentResults, which has a temporal
rule covered in scoring-flow. The sweep also checks that every phase-gated
operation answers 501 SYS-003.

**Caveat added:** `min_acr` (acr ≥ 2 for validate / return / cross-person export)
is in the contract but not enforced, because step-up authentication lands in P2
(ADR-0014). No test asserts it yet. A green permission gate does not prove it.

## New gate 2026-10-12: `Gate: dart client` (14th)

`clients/dart/seip_api`: swagger_parser generates the Flutter API client from the
contract (`docs/contracts/openapi.yaml`, 4.0.0 since SEIP-P1-001), then `build_runner`, `dart analyze
--fatal-infos` and `dart test` (decode tests for sync batches, suggestions and
upload sessions). Fails if the contract stops generating valid Dart.

## Gate defect fixed 2026-10-12: contract compatibility could pass unchecked

`scripts/security/check-contract-compatibility.mjs` runs oasdiff via `docker run`
when it is not on PATH (always, in CI). It parsed `result.stdout || '[]'`, so a
failed image pull (Docker Hub 429 → exit 125, empty stdout) read as "no breaking
changes" and the gate passed without comparing anything. Seen live on the CCR-017
draft: 87 breaking items reported as none. Now a non-0/1 exit or empty output
fails the gate (oasdiff prints `[]` when clean). Verified: identical specs pass;
a docker that exits 125 fails.

## Verified runs (2026-10-12, local — P0-002 Prisma 7.10 upgrade)

Same stack as below, fresh database (bootstrap → migrate as `seip_migrator` →
seed as `seip_app`). Prisma 6.19.3 → **7.10.0** with `@prisma/adapter-pg`.

| Command | Result |
|---|---|
| `build` · `typecheck` · `lint` · `format:check` · `test:unit` | pass |
| `gate:dep-audit` | 0 vulnerabilities (mysql2 override for the Prisma 7 CLI) |
| `test:backend` · api · database · worker · security | 20 · 78 · 17 · 21 · 6 — all pass |
| `test:e2e` | 12/12 |

## Verified runs (2026-10-12, local — P0 rebaseline on PostgreSQL 18 + SeaweedFS)

ADR-0012/0013. Stack: `pgvector/pgvector:pg18` with `seip_migrator` (migrations)
and `seip_app` (everything else), neither superuser; `chrislusf/seaweedfs:4.48`
S3 gateway. Fresh lockfile (npm 11), React Router 7.18, `deepmerge-ts` override.

| Command | Result |
|---|---|
| `npm run gate:ownership` · `gate:contracts` · `gate:secret-scan` | pass |
| `npm run gate:dep-audit` | **0 vulnerabilities** (was 17: 11 high) |
| `npm run build` · `typecheck` · `lint` · `format:check` · `test:unit` | pass |
| `npm run test:backend` (as `seip_app` and as `seip_migrator`) | 20/20 — CHECKs, partial unique indexes, generated threshold, audit REVOKE + trigger, role checks |
| `npm run test:integration --workspace apps/api` | 78/78 |
| `npm run test:integration --workspace packages/database` | 17/17 (outbox claim ×3 runs) |
| `npm run test:integration --workspace apps/worker` | 21/21 |
| `npm run test:security` | 6/6 |
| `npm run test:e2e` | 12/12 |
| `npm run backup -- --no-objects` + `npm run restore -- --dry-run` | dump verified, drill passed |

Defects the move surfaced (all latent on MySQL, fixed in the same change):
- presigned PUTs carried the SDK's default CRC32 of an **empty** body — S3 and
  SeaweedFS reject every upload (400 BadDigest); MinIO had ignored it.
- the outbox claim's optimistic CAS let a dispatcher that read after the
  winner's write claim the same event again — replaced by `FOR UPDATE SKIP
  LOCKED` + a lease.
- "current memberships" kept a membership ended today until midnight; it only
  passed on the dev box because of a UTC+7 DATE artefact.

## Verified runs (2026-07-18, local — ADR-0008 MySQL migration, full suite + e2e) — historical

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
