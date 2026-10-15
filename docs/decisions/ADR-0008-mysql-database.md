# ADR-0008 — Database engine: MySQL 8 (PostgreSQL retired)

Status: **Accepted** · Date: 2026-07-18 · Decider: user (request) + Claude Code (execution, ADR-0004)
Supersedes: the PostgreSQL choice embedded in ADR-0001/ADR-0005-era tooling (docker-compose Postgres :5433, `pg` test client). Object storage (ADR-0005 MinIO) and all contracts are unaffected.

## Context

The user directed the project to run on the host's Laragon-managed MySQL server
(`localhost:3306`, `root`, empty password) instead of the dockerized PostgreSQL
the repo had used since DB-001. Motivation: the dev machine already runs
MySQL 8.0.30 as part of Laragon; a second database engine in Docker duplicates
infrastructure for no product gain. Nothing in the product depends on
Postgres-only features at the application layer — the audit found **zero raw
SQL** in apps/packages (everything goes through Prisma), so the engine surface
was exactly: `schema.prisma`, the migration SQL, and the raw-SQL constraint
tests.

## Decision

- Provider `mysql` (Prisma), targeting **MySQL 8.0.30+** (needs enforced CHECK
  constraints 8.0.16+, stored generated columns, single-statement triggers).
  MariaDB is not the target; if it ever becomes one, re-verify CHECK
  enforcement and JSON behavior first.
- **Dev DB = host Laragon MySQL** `mysql://root@localhost:3306/seip` — no DB
  container in `docker-compose.yml` (MinIO only). Staging/on-prem and CI run
  `mysql:8.0` containers with real credentials.
- **Migration history rebaselined**: the five Postgres migrations are replaced
  by `20260718210000_init` (Prisma-generated) + `20260718210100_constraints`
  (hand-written MySQL dialect). Prisma migration histories are
  provider-specific; the Postgres history remains in git history only.

## Dialect mapping (what changed and why)

| Postgres construct | MySQL 8 replacement | Note |
|---|---|---|
| `UUID` columns (`@db.Uuid` ×92) | `CHAR(36)` | ids generated client-side by Prisma `uuid()` — unchanged |
| `text[]` `allowed_mime_types` | `JSON` | MySQL has no scalar lists; consumers cast to `string[]` (one site: evidence.ts UPL-001) |
| Unbounded `TEXT` for every String | explicit `@db.Text` on long free-text (rubric text, descriptions, comments, storage URIs); `VARCHAR` sized from the zod caps elsewhere (title 300, filename 255…) | MySQL default `VARCHAR(191)` would truncate-reject seeded Thai rubric text |
| Partial unique `evaluation_cycle_pa_uk WHERE kind='pa'` | STORED GENERATED `pa_uk_key` (NULL for DPA) + plain unique index | MySQL unique indexes ignore NULLs — NULL rows opt out of uniqueness |
| Partial unique + `NULLS NOT DISTINCT` on active mappings | trigger-maintained `active_uk_key` (BEFORE INSERT/UPDATE) + unique index; NULL `cycle_id` folds to `'~'` sentinel | **not** GENERATED: InnoDB refuses any cascading FK (even evidence's `ON DELETE CASCADE`) on a generated base column — errno 1215, verified |
| `GENERATED ALWAYS AS (total_percent >= 70)` | same, `TINYINT(1) STORED` | unchanged semantics; writes rejected (errno 3105) |
| plpgsql append-only trigger on audit_event | two single-statement `SIGNAL SQLSTATE '45000'` triggers | no DELIMITER blocks — Prisma splits migration files on `;` |
| `CHECK (email = lower(email))` | `CHECK (CAST(email AS BINARY) = CAST(LOWER(email) AS BINARY))` | utf8mb4_unicode_ci is case-insensitive — the naive check would enforce nothing |
| Prisma JSON filter `path: ['field']` | `path: '$.field'` | provider-specific Prisma API (one site, reports test) |
| FK `ON UPDATE CASCADE` (Prisma default) | `onUpdate: Restrict` on relations whose columns sit in CHECKs/generated keys | MySQL forbids CASCADE-updated columns there; UUID PKs never update, so this is free |

## Consequences

- Laragon dev loop needs no Docker for the DB; `docker compose up -d` is MinIO only.
- `tests/backend/*` now speak mysql2 (errno map: 3819 CHECK · 1644 SIGNAL ·
  1062 dup · 3105 generated-write); `pg` is gone from devDependencies.
- Backup/restore = `mysqldump --single-transaction --triggers` (runbook §5) —
  **`--triggers` is load-bearing**: the append-only and active_uk_key triggers
  are schema integrity, not decoration.
- `active_uk_key`/`pa_uk_key` exist in `schema.prisma` as plain nullable
  columns (Prisma cannot express generated/trigger-maintained columns — same
  documented drift as `passedIndividualThreshold` since DB-001). Never write
  them from app code; the DB overwrites/rejects anyway.
- Root/no-password is acceptable **only** for the Laragon dev box; staging/CI
  templates require real credentials (`MYSQL_*` in `.env.staging.example`).

## Verification (2026-07-18, this machine)

Full pipeline on MySQL 8.0.30: migrate deploy + seed (792 level rows) ·
test:backend 19/19 · api 29/29 · worker 9/9 · database 9/9 · security 3/3 ·
typecheck all workspaces · **e2e 10/10** (upload → scan-gated download, session
refresh rotation, report + PDF, committee scoring).
