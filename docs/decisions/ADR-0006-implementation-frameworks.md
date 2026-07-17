# ADR-0006: Implementation Frameworks — API and Web

## Status
Accepted

## Context

ADR-0001 fixed the umbrella stack (Node/TypeScript monorepo) but deliberately left specific frameworks open. As of 2026-07-17, `apps/` and `packages/` contain only `.gitkeep` — the plan (module-boundaries.md, contracts v1.0.0, the evidence-submission UX) has no implementation yet. Before writing `apps/api` and `apps/web`, the framework choice needs to be recorded once, the same way ADR-0001 prevented four agents from guessing differently — now it's one developer across many sessions who must not re-decide this per file.

## Decision

- **API — Fastify.** Schema-driven request/response validation (fits a contract-first OpenAPI workflow), low overhead for a modest evidence-workflow API, native async/await, first-class TypeScript types.
- **Validation — Zod**, with schemas mirrored from `openapi.yaml` components by hand (small enough surface to keep in sync manually; `openapi-typescript` covers the *type* side, Zod covers the *runtime-check* side that generated types alone don't give).
- **Web — Vite + React + TypeScript**, plain SPA (no Next.js/meta-framework). The evidence-submission flow (`docs/architecture/ux/evidence-submission-flow.md`) is client-driven with no SSR/SEO requirement; a meta-framework would add routing/server conventions this project doesn't need yet.
- **Package manager — npm workspaces** (already the lockfile in use since QA-001; no need to introduce pnpm/yarn).
- **Auth — Argon2id password hashing + JWT** (access + refresh, rotation on use), per `SECURITY-BASELINE.md` SEC-AUTH-1/2.
- **Object storage client — AWS SDK v3 S3 client**, pointed at the MinIO endpoint (ADR-0005: MinIO is consumed through the S3-compatible API only, so the *official* S3 SDK is the correct client, not a MinIO-specific one — this is what keeps a future migration to real S3/R2 a config change).

## Options Considered

- API: Express (larger ecosystem, but no built-in schema validation — would need an equivalent amount of Zod/ajv wiring anyway with less structure) vs NestJS (heavier, opinionated DI framework — more ceremony than a 15-operation MVP slice justifies) vs Fastify (chosen).
- Web: Next.js (chosen against — no SSR need, adds a server runtime and routing conventions the SPA doesn't use) vs Vite+React (chosen — matches the UX design's client-driven flow exactly).

## Consequences

- `apps/api/package.json` depends on `fastify`, `zod`, `@aws-sdk/client-s3`, `@prisma/client` (via `packages/database`).
- `apps/web/package.json` depends on `react`, `vite`, generated types from `openapi-typescript`.
- Root `package.json` gains `"workspaces": ["apps/*", "packages/*"]`; CI gates (`format`, `lint`, `typecheck`, `unit`, `build`) arm once each workspace defines its own script, aggregated at the root.
- This ADR does not choose a scoring/committee UI framework decision beyond what's already decided here — none needed, same stack.

## Approved By
Claude (implementation-detail ADR under the existing solo mandate, ADR-0004) — flagged for user review, not blocking (unlike ADR-0005's storage/PDPA choice, a framework substitution here is a refactor, not a data-migration risk).

## Date
2026-07-17
