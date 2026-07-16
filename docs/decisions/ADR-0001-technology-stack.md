# ADR-0001: Technology Stack

## Status
Accepted

## Context

`docs/` describes the target repository in detail but never states the stack. The referenced paths, however, only make sense for one:

- `prisma/**` and `packages/database/**` — Prisma is a Node/TypeScript ORM
- `apps/api/**`, `apps/worker/**`, `apps/web/**`, `packages/ui/**`, `packages/design-tokens/**` — a JS/TS monorepo layout
- `contract-policy.md` requires OpenAPI **generated types** and `ANTIGRAVITY.md` requires **mock servers from OpenAPI** — a TypeScript codegen workflow
- `infra/docker/**` — containerised services

Against this, the project is located at `D:\laragon\www\aischool`. Laragon is a PHP/Apache/MySQL development environment, which is real evidence for a PHP stack and would invalidate `prisma/**` entirely.

Four agents are about to work in parallel. If each infers the stack from a different signal, Codex writes Prisma schemas while Antigravity scaffolds a PHP frontend. The stack must be recorded before any agent reads the board.

## Options Considered

1. **Node/TypeScript monorepo** — matches every path in the existing docs. Requires no changes to `module-ownership.yaml`, the task board, or any agent instruction file. Laragon becomes just a directory location.
2. **PHP (Laravel)** — matches the host environment and the user's PHPRunner background. Requires rewriting every path in `module-ownership.yaml`, `task-board.yaml`, and all four agent instruction files, and dropping `prisma/**` entirely.
3. **Defer to SEIP-ARCH-001** — keeps Sprint 0 stack-agnostic but leaves the highest-fanout decision open while three agents are told to start.

## Decision

**Option 1 — Node/TypeScript monorepo**, confirmed by the user on 2026-07-16.

Consequences for Sprint 0 work orders:
- Package manager and runtime versions are pinned by `SEIP-OPS-001` and recorded in a follow-up ADR if contested.
- `SEIP-DB-000` produces a **stack-agnostic ERD and entity dictionary** regardless. The ERD is a domain artifact; committing it to Prisma syntax in a design task would mix a modelling decision with an ORM decision. `prisma/schema.prisma` is written in `SEIP-DB-001` (Sprint 1).
- Verification commands in all work orders may assume Node tooling.

## Consequences

- The Laragon location is now understood as **incidental** — the project directory happens to live under `www/`. If the intent was ever to serve this through Laragon's Apache, that conflicts with this ADR and must be raised as a new ADR, not worked around.
- `prisma/**`, `apps/**`, `packages/**` in `module-ownership.yaml` are confirmed correct as written.
- The contract-first workflow (OpenAPI → generated types → mock server) is viable as specified.

## Approved By
User (2026-07-16), recorded by Claude

## Date
2026-07-16
