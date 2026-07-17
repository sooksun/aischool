# Close-out: SEIP-DB-001 — Core Database (schema + migrations + constraint tests + taxonomy seed)

Owner: claude (schema/migrations) + grok (close-out: seed, expanded tests, monorepo scripts) · Date: 2026-07-17 · Branch: `feat/SEIP-DB-001-core-database` · Mode: single-agent (ADR-0004) with user-directed co-pilot assist

## Objective

Implement the SEIP core data model from `docs/architecture/data-model/entity-dictionary.md` as Prisma + PostgreSQL, with DB-enforced ว9/ว10 rules, append-only audit, MinIO-oriented evidence metadata (ADR-0005), and seed taxonomy as **data** (ADR-0003).

## Delivered

| Artifact | Content |
|---|---|
| `prisma/schema.prisma` | 28 models; 21 enums; explicit `onDelete`; `ChallengeScore` merged into `IndicatorScore` |
| `prisma/migrations/20260716234528_init/` | Generated init against Postgres 17 |
| `prisma/migrations/20260716234600_constraints/` | Hand-written CHECKs, partial unique indexes, GENERATED column, audit triggers |
| `prisma/seed.mjs` | Idempotent ว9/ว10 FrameworkVersion + domains + 19+19 indicators + weights + rank levels + evidence categories |
| `tests/backend/constraints.test.mjs` | 13 constraint/behavior tests (DB rejects bad writes) |
| `tests/backend/schema-alignment.test.mjs` | Entity-dictionary table presence, tenancy `school_id`, constraint objects |
| `tests/backend/seed-taxonomy.test.mjs` | Seed shape (15+3+1 indicators per role, weights, 10-min video category) |
| `docker-compose.yml` | PostgreSQL 17 (:5433) + MinIO (ADR-0005) |
| `.env.example` | `DATABASE_URL` + S3_* template (real `.env` gitignored) |
| `docs/decisions/ADR-0005-*` | MinIO / S3-compatible on-prem (closes OPEN-4) |
| `package.json` | `prisma`, `@prisma/client`, `pg`; scripts `db:validate|generate|migrate|seed`, `test:backend`, `test:integration` |
| `.github/workflows/ci.yml` | migration-validation gate: Postgres service → validate → migrate deploy → test:backend |

## Entity-dictionary alignment (review)

| Dictionary entity | Physical table | Notes |
|---|---|---|
| Area … Approval, AuditEvent (all 28 design entities) | matching `@@map` snake tables | **Present** |
| ChallengeScore | — | **Merged** into `indicator_score` (same grain; `indicator.indicator_kind` discriminates) |
| IndicatorScore | `indicator_score` | UK (assignment, indicator, evaluator) |
| EvidenceFile | `evidence_file` | metadata only — no `bytea` (ADR-0005 / SEC-UPL-1) |
| AuditEvent | `audit_event` | append-only via BEFORE UPDATE/DELETE triggers |

Operational tenancy columns verified: `personnel_profile`, `evaluation_cycle`, `performance_agreement`, `evidence`, `evidence_indicator_mapping`, `evaluation_assignment`, `report`, `approval` all have `school_id`.

**PII / immutability notes (for implementers):**
- `UserAccount.email` CHECK lowercase; names/scores are direct/sensitive per dictionary.
- `AuditEvent.before_state/after_state` must use field allowlists in app code (SEC-PDPA-2) — schema allows JSON but discipline is application-level.
- Score immutability after round `closed` remains an **app rule** (SCORE path), not a DB trigger yet.

## Acceptance criteria

| Criterion | Result |
|---|---|
| Configurable evaluation rounds per year | **PASS** — `round_number >= 1`, no max cap; test inserts 3 rounds |
| Evidence M:N to indicators (both taxonomies) | **PASS** — mapping table + seed T-* and A-* codes; partial unique active mapping |
| Append-only audit | **PASS** — triggers + tests block UPDATE/DELETE |
| Migrations and constraint tests pass | **PASS** — see verification |

## Verification (recorded 2026-07-17, local)

```
npx prisma validate          → schema valid
npx prisma migrate reset --force
  → apply init + constraints from empty DB
  → seed OK { frameworks: 2, domains: 12, indicators: 38 (19+19), weights: 12, … }
npm run test:backend         → 18 pass / 0 fail
npm run gate:ownership       → 0 errors
npm run gate:dep-audit       → 0 vulnerabilities
```

**Migrate down:** Prisma migrations here are forward-only (no `down.sql`). Recovery path for on-prem = restore Postgres backup + re-`migrate deploy`. Documented as accepted limitation for DB-001.

**CI:** migration-validation job armed when `prisma/schema.prisma` exists (Postgres service + deploy + tests).

## Seed scope vs SEIP-DB-002

DB-001 seed loads **structure and codes** from `evaluation-framework.md`:
- Frameworks `v9-2564-teacher`, `v10-2564-administrator`
- 15 standard + 3 challenge + 1 workload per role
- Score weights 60/40 and 20/10/10 + pass threshold 70
- Rank levels (practice tiers) + 6 evidence categories (incl. inspiration video ≤600s)

**Not seeded:** full `IndicatorLevelDescription` wording per วิทยฐานะ from the official PDFs (hundreds of cells). That text must remain data loaded from source PDFs — residual for SEIP-DB-002 or a later data-load task. Empty level-description table does not block schema consumers.

## Known limitations / residual risk

1. No per-row composite FK enforcing `evidence.school_id == mapping.school_id` (app must enforce; optional future trigger).
2. Round-closed score immutability not DB-enforced yet.
3. Full rubric level text not seeded.
4. Branch protection still recommended on GitHub (ops residual from ARCH-002).
5. `package.json#prisma.seed` warns deprecated for Prisma 7 — fine on Prisma 6; migrate to `prisma.config.ts` when upgrading.

## Contract impact

None. No OpenAPI changes. Implementation remains bound to contracts v1.0.0.

## Database impact

Creates all core tables + seed reference data. Safe for empty environments only (Sprint 1 first schema).

## Verification commands

```bash
docker compose up -d postgres
cp .env.example .env   # if needed
npm install
npm run db:validate
npm run db:generate
npm run db:migrate
npm run db:seed
npm run test:backend
npm run gate:ownership
```

## Recommended next task

1. User review + merge `feat/SEIP-DB-001-core-database` → `develop` (CI migration gate must go green).
2. **SEIP-DB-002** (optional residual): load full IndicatorLevelDescription from PDFs.
3. **SEIP-UI-001** or API/auth scaffold consuming Prisma + OpenAPI codegen.

## Pre-commit review checklist (tenancy / PII / audit)

- [x] Tenant boundary: School + school_id on operational tables
- [x] Membership scope CHECK (school vs area ids)
- [x] Evidence bytes not in Postgres
- [x] Audit append-only at DB layer
- [x] Pass threshold generated, not writable
- [x] Secrets only in `.env.example` as throwaway dev values
- [x] No production feature API/UI in this task (schema layer only)