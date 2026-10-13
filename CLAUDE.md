# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

SEIP — School Evidence Intelligence Platform: evidence collection, indicator mapping, committee scoring, and PA report generation for Thai teacher/administrator performance agreements (วPA ว9/2564 + ว10/2564, ADR-0003). Node/TypeScript npm-workspaces monorepo: Fastify API, Vite+React SPA, polling worker, Prisma/PostgreSQL 18 + pgvector (ADR-0012), S3-API object storage — SeaweedFS in dev/CI/staging, Amazon S3 Bangkok in production (ADR-0013). Product direction since the 2026-10 rethink: `docs/project/PRD.md`, `docs/project/plan.md`, ADR-0010–0018.

You are the sole developer — architect, backend, frontend, and QA in one (ADR-0004); the user is the final approver. The retired multi-AI mechanisms (file locks, dispatch prompts, cross-agent handoffs, per-agent ownership) and `AGENTS.md` / `ANTIGRAVITY.md` / `GROK.md` are superseded — ignore them.

## Before every task

1. Read `docs/project/PROJECT_STATE.md` and `.ai-team/task-board.yaml` (single tracker); confirm the task's dependencies are met.
2. ADR > board > narrative docs — correct the lower to match the higher. New architectural decisions get a `docs/decisions/ADR-*.md`.

## Commands

Local stack (ADR-0012/0013): `docker compose up -d` starts **PostgreSQL 18 + pgvector on :5432** (first boot runs `scripts/db/bootstrap-roles.sql`) and **SeaweedFS S3 on :8333** (bucket auto-created). Copy `.env.example` → `.env`. Two DB roles, neither superuser: `DATABASE_URL` = `seip_app` (app, tests, seed — DML only), `MIGRATE_DATABASE_URL` = `seip_migrator` (owns the schema). DB: `npm run db:generate`, `db:migrate` (deploy, runs as migrator via `scripts/db/migrate.mjs`), `db:migrate:dev`, `db:seed`, `db:reset`. Laragon MySQL is no longer used.

Build/run:
- `npm run build:libs` — builds packages/* which apps import; root `build`/`typecheck`/`lint`/`test:unit`/`test:security` run it first automatically.
- api and worker `dev` scripts run `node --watch dist/index.js` — they watch **built output, not src**; run `npm run build --workspace apps/api` after editing (there is no tsx/ts-node watcher).
- `npm run dev:api` (Fastify, `PORT` from `.env`) · `npm run dev:web` (Vite :5173) · `npm run dev:worker`.
- **Ports:** the Vite dev proxy targets `http://localhost:3011` and `.env.example` ships `PORT=3011` to match — keep them in sync (override with `VITE_API_PROXY_TARGET` if the API moves).

Tests (integration/backend/security/e2e need the docker stack migrated + seeded):
- `npm run test:backend` — root DB constraint/schema-alignment/seed-taxonomy tests (`node --test tests/backend/*.test.mjs`).
- `npm run test:unit` — packages/auth + backend-shared (`node --test` on src), apps/web (vitest).
- `npm run test:integration --workspace apps/api` (likewise `apps/worker`, `packages/database`) — builds, then runs `test/*.test.mjs` against real PostgreSQL/SeaweedFS.
- `npm run test:security` — permission-matrix sweep asserting every operation in `permissions.yaml`.
- `npm run test:e2e` — Playwright, chromium only, 1 worker; spawns Vite itself unless `E2E_BASE_URL` is set; API must already be running on the proxy port. `npx playwright install chromium` once. Fixture users (`e2e-teacher@seip.local`, `e2e-director@seip.local`, committee) are seeded by `tests/e2e/global-setup.mjs`.
- Single test: `node --test tests/backend/constraints.test.mjs` · `npm run test:unit --workspace apps/web -- src/lib/capabilities.test.ts` · `npx playwright test tests/e2e/flows-depth.spec.ts`.

Gates — run the relevant ones before claiming a task done; CI (`.github/workflows/ci.yml`) runs the same names on every push/PR to develop/main: `npm run gate:contracts` (lint + typegen sync + authz coverage; CI adds oasdiff breaking-diff), `gate:ownership`, `gate:secret-scan` (dockerized gitleaks, full history), `gate:dep-audit`, plus `typecheck` / `lint` / `format:check`. Definitions and verified-run history: `docs/qa/QUALITY-GATES.md`. A confirmed gitleaks false positive gets an inline `// gitleaks:allow` comment with justification on the flagged line — never skip the gate.

Codegen after contract edits: `npm run codegen:api-types` (openapi.yaml → `apps/web/src/api/schema.generated.ts`) and `npm run codegen:contracts` (error-code/permission constants → packages/backend-shared).

## Architecture

Modules and hard boundaries (`docs/architecture/module-boundaries.md`):
- `apps/api` — Fastify HTTP layer and the **only** authorization enforcement point (`src/lib/permission-guard.ts` asserting `permissions.yaml`; plugins for auth/JWT, error shaping, security headers; per-domain routes: auth, evidence, mappings, cycles, scoring, reports, taxonomy). S3 presigned upload/download, on-demand PA-form PDF (pdfkit).
- `apps/web` — SPA; calls the API **only** through generated types (`openapi-fetch` + `src/api/schema.generated.ts`); never imports `packages/database`; hides affordances via capability flags derived from memberships but is never the security gate.
- `apps/worker` — polling loop over `WorkerJob`/`OutboxEvent`: outbox event dispatch, file scan + duration probe, report generation, storage GC.
- `packages/database` (Prisma client + repositories — imported by api/worker only) · `packages/auth` (argon2, JWT, refresh tokens, role resolution from `SchoolMembership`) · `packages/backend-shared` (error codes / event envelopes / report payload — generated from contracts).

Rules that bind implementation:
- **Contract-first (locked since Sprint 0 exit):** `docs/contracts/{openapi,events,permissions,error-codes}.yaml` are the protected source of truth — no invented fields, types generated never hand-written. Additive change → minor bump, noted in close-out. Breaking change → CCR doc in `docs/reviews/CCR-NNN-*.md` + major bump + **user approval before merge**; the contract-compatibility gate fails breaking diffs lacking a same-change major bump. Flow details: `docs/contracts/contract-policy.md`.
- **Taxonomy is data** (ADR-0003): indicators, level descriptions, and weights come from versioned framework seed rows — never hard-coded.
- **Events over dual writes:** cross-module side effects ride the transactional outbox per `events.yaml`.
- **Storage:** evidence binaries live in S3-API storage; PostgreSQL stores metadata only. Uploads contain personal data (PDPA) — never commit uploads, keep `.gitignore` intact, storage stays server-side.
- **Database rules (ADR-0012):** constraints Prisma can't express live in `prisma/migrations/20261013000100_constraints` — partial unique indexes (`evidence_indicator_mapping_active_uk` on (evidence, indicator, framework_version) where not revoked, `evaluation_cycle_pa_uk`), generated `passed_individual_threshold`, CHECKs, and `audit_event` append-only via REVOKE from `seip_app` + trigger. Migrations must run as `seip_migrator` (non-superuser) — never write one that needs superuser. **Prisma 7.10** (pinned exactly — npm `latest` is 8.0.0-rc): the CLI reads `prisma.config.ts` (datasource URL, migrations path, seed), not `schema.prisma`; the client needs the `@prisma/adapter-pg` driver adapter — use `createPrismaClient()` (`@seip/database`, or `prisma/client.mjs` for seed/scripts/tests), never bare `new PrismaClient()`. Prisma JSON path filters use the array form (`path: ['file_id']`). Leases use `FOR UPDATE SKIP LOCKED`. S3 clients set `requestChecksumCalculation: 'WHEN_REQUIRED'` (SDK default breaks presigned PUTs).
- **Evidence and mappings (contract 4.0.0, CCR-017):** evidence belongs to a **person** (`owner_person_id`), with an origin school; authorize it through `apps/api/src/lib/evidence-access.ts` (owner → origin-school grant → committee; no route = RES-001, never PERM-001). Mappings are two-tier: the owner confirms (`owner_confirmed`), the director or committee validates/returns, and only the owner revokes. Reports read `validated` mappings only. Bytes arrive through upload sessions (`/uploads`: single PUT ≤16 MiB, else S3 multipart completed server-side from ListParts — never set ChecksumAlgorithm on CreateMultipartUpload). Creates take `Idempotency-Key`; versioned writes need `If-Match` (`lib/concurrency.ts`). Unbuilt contract ops live in `routes/phase-gated.ts` (501 SYS-003). v2 scoring + reports register only with `FEATURE_SCORING=true` (default false; tests/CI set it); the web build reads the same variable (`apps/web/vite.config.ts`) and hides those screens when it is off.
- **Identity (ADR-0014):** `docker compose up -d` also starts Keycloak (:8180, realm `seip` from `infra/keycloak/seip-realm.dev.json`). The API routes a token by header alg — HS256 is its own (acr 1), anything else is verified against `KEYCLOAK_ISSUER`'s JWKS (`packages/auth/src/oidc.ts`; the account is the admin-only `seip_uid` claim). Step-up: call `requireAcr(auth, operationId, action?)` AFTER the role check on every op in permissions.yaml `min_acr` (enforced only with `ENFORCE_MIN_ACR=true`); `apps/api/test/step-up.test.mjs` fails if an entry has no test. Tests get real tokens via `tests/helpers/keycloak.mjs` (browser flow over HTTP; a direct grant always yields acr "pwd"). Web sign-in (CCR-018) is a BFF cookie session: `routes/web-auth.ts` + `lib/web-session.ts`; cookie-session writes must carry `X-CSRF-Token` (AUTH-007); served when `KEYCLOAK_WEB_CLIENT_SECRET` and `WEB_PUBLIC_ORIGIN` are set. Accounts are provisioned into Keycloak at accept-invite / password login via the `seip-provisioner` service account (`KEYCLOAK_ADMIN_CLIENT_SECRET`; `user_account.kc_linked_at`), best effort — never block a sign-in on Keycloak. A second factor counts for `STEP_UP_MAX_AGE_S` (15 min) from `auth_time` / session sign-in — Keycloak keeps acr "mfa" through refreshes. Mobile (`apps/mobile/lib/src/auth.dart`): flutter_appauth PKCE + offline_access, refresh token in flutter_secure_storage only. Device sessions (FR-093, `routes/devices.ts`): a seip-mobile token's `sid` becomes a `device_session` row on first sight (platform from the `SEIP-Mobile/<v> (<os>)` User-Agent); revocation marks the row (tokens refused at once) and deletes the Keycloak offline session (admin sign-out does not reliably end it).
- **RLS backstop (ADR-0019):** raw SQL that reads tenant data runs inside `withAreaScope(scope, tx => …)` (`packages/database/src/area-scope.ts`; scope from `resolveAreaScope`), which switches to the read-only role `seip_scoped` so policies on evidence / evidence_file / evidence_indicator_mapping / upload_session / personnel_profile hide other สพท. Pass `tx` down; the global `prisma` is unscoped. A new tenant table needs a policy in a migration.
- **Area admin (CCR-021):** area_admin is read-only (PERM-004) except the closed list `area_admin_writes` in permissions.yaml (createSchool / updateSchool / appointSchoolAdmin, `routes/areas.ts`); another area is RES-001. A membership at an inactive school is not active (`isActiveNow`).
- **AI is in-country only** (ADR-0010, supersedes ADR-0007): open models self-hosted in Thailand; no foreign or cloud AI. `local_heuristic` remains the fallback floor. AI only suggests — never auto-confirms.

Product flow: login (JWT + refresh rotation, rate-limited) → evidence capture (upload session → worker re-hash + scan) → owner-confirmed indicator mapping → director/committee validation (in-country AI suggestions arrive in P3) → evaluation cycles/rounds → 3-evaluator committee scoring → structured PA report (JSON + section refs) → on-demand PDF. Pixel-perfect official ก.ค.ศ. paper plates are explicitly deferred.

## Process

- `main` is the release branch; day-to-day work happens on `develop` (direct commits sanctioned by ADR-0004) or `feat/<task-id>-<name>`. Never force-push either.
- Write tests with the implementation; run the task's verification commands before claiming completion; keep `PROJECT_STATE.md` and the task board current as tasks move.
- Self-review each diff against its acceptance criteria, then hand it to the user — the user is the final approver on breaking contract changes, sprint gates, and releases.
