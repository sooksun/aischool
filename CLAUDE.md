# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

SEIP — School Evidence Intelligence Platform: evidence collection, indicator mapping, committee scoring, and PA report generation for Thai teacher/administrator performance agreements (วPA ว9/2564 + ว10/2564, ADR-0003). Node/TypeScript npm-workspaces monorepo: Fastify API, Vite+React SPA, polling worker, Prisma/MySQL 8 (ADR-0008), MinIO object storage (ADR-0005/0006).

You are the sole developer — architect, backend, frontend, and QA in one (ADR-0004); the user is the final approver. The retired multi-AI mechanisms (file locks, dispatch prompts, cross-agent handoffs, per-agent ownership) and `AGENTS.md` / `ANTIGRAVITY.md` / `GROK.md` are superseded — ignore them.

## Before every task

1. Read `docs/project/PROJECT_STATE.md` and `.ai-team/task-board.yaml` (single tracker); confirm the task's dependencies are met.
2. ADR > board > narrative docs — correct the lower to match the higher. New architectural decisions get a `docs/decisions/ADR-*.md`.

## Commands

Local stack (ADR-0008): the database is the host's **Laragon MySQL 8 on :3306** (root, no password) — `docker compose up -d` starts **MinIO only** (:9000, console :9001, bucket auto-created). Create the DB once: `mysql -u root -e "CREATE DATABASE IF NOT EXISTS seip CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"`. Copy `.env.example` → `.env`. DB: `npm run db:generate`, `db:migrate` (deploy), `db:migrate:dev`, `db:seed`, `db:reset`.

Build/run:
- `npm run build:libs` — builds packages/* which apps import; root `build`/`typecheck`/`lint`/`test:unit`/`test:security` run it first automatically.
- api and worker `dev` scripts run `node --watch dist/index.js` — they watch **built output, not src**; run `npm run build --workspace apps/api` after editing (there is no tsx/ts-node watcher).
- `npm run dev:api` (Fastify, `PORT` from `.env`) · `npm run dev:web` (Vite :5173) · `npm run dev:worker`.
- **Ports:** the Vite dev proxy targets `http://localhost:3011` and `.env.example` ships `PORT=3011` to match — keep them in sync (override with `VITE_API_PROXY_TARGET` if the API moves).

Tests (integration/backend/security/e2e need the docker stack migrated + seeded):
- `npm run test:backend` — root DB constraint/schema-alignment/seed-taxonomy tests (`node --test tests/backend/*.test.mjs`).
- `npm run test:unit` — packages/auth + backend-shared (`node --test` on src), apps/web (vitest).
- `npm run test:integration --workspace apps/api` (likewise `apps/worker`, `packages/database`) — builds, then runs `test/*.test.mjs` against real Postgres/MinIO.
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
- **Storage:** evidence binaries live in MinIO; MySQL stores metadata only. Uploads contain personal data (PDPA) — never commit uploads, keep `.gitignore` intact, storage stays server-side.
- **MySQL dialect notes (ADR-0008):** no partial unique indexes — the two conditional uniques ride `pa_uk_key` (STORED GENERATED) and `active_uk_key` (trigger-maintained; InnoDB refuses cascading FKs on generated bases). CHECKs comparing case must use BINARY (collation is case-insensitive). Prisma JSON filters take a `'$.field'` JSONPath string, not the Postgres array form. `allowed_mime_types` is a Json column (no scalar lists on MySQL).
- **AI mapping is `local_heuristic` on-prem only** (ADR-0007): cloud/foreign LLM calls are forbidden while ADR-0005 holds; a superseding ADR is required to change this.

Product flow: login (JWT + refresh rotation, rate-limited) → evidence upload (presigned PUT → worker scan) → indicator mapping (+ local AI suggest) → evaluation cycles/rounds → 3-evaluator committee scoring → structured PA report (JSON + section refs) → on-demand PDF. Pixel-perfect official ก.ค.ศ. paper plates are explicitly deferred.

## Process

- `main` is the release branch; day-to-day work happens on `develop` (direct commits sanctioned by ADR-0004) or `feat/<task-id>-<name>`. Never force-push either.
- Write tests with the implementation; run the task's verification commands before claiming completion; keep `PROJECT_STATE.md` and the task board current as tasks move.
- Self-review each diff against its acceptance criteria, then hand it to the user — the user is the final approver on breaking contract changes, sprint gates, and releases.
