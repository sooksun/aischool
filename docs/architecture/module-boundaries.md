# Module Boundaries — SEIP (ARCH-001)

Status: v0.1 draft (locked with contracts at ARCH-002)
Date: 2026-07-17 · Mode: single-agent (ADR-0004) — boundaries define *code structure*, not team ownership.

## Modules

| Module | Path (planned) | Responsibility | Talks to |
|---|---|---|---|
| **web** | `apps/web` | Teacher/admin UI; consumes REST via generated types only | api (HTTP per `openapi.yaml`) |
| **api** | `apps/api` | HTTP layer: authn/authz, validation, tenancy enforcement, orchestration | database, storage, outbox |
| **worker** | `apps/worker` | Async jobs: virus scan, video metadata probe, event dispatch from outbox, storage GC | database, storage, notification |
| **database** | `packages/database` | Prisma schema + repositories implementing `entity-dictionary.md` | (owned by api/worker only — web never imports) |
| **auth** | `packages/auth` | Session/JWT, role resolution from `SchoolMembership` | api |
| **backend-shared** | `packages/backend-shared` | Error codes, event envelopes, config — mirrors `error-codes.yaml` / `events.yaml` | api, worker |
| **ui / design-tokens** | `packages/ui`, `packages/design-tokens` | Reusable components, tokens | web |

## Interaction rules

1. Every web↔api interaction goes through `docs/contracts/openapi.yaml` — types are **generated**, never hand-written (ADR-0001).
2. Authorization decisions follow `docs/contracts/permissions.yaml`; the api module is the only enforcement point (web hides UI affordances but never *is* the gate).
3. Errors returned to clients use the shape and codes of `docs/contracts/error-codes.yaml`.
4. Cross-module side effects (notify, project, audit-fan-out) ride on domain events per `docs/contracts/events.yaml` via a transactional outbox — no dual writes inside request handlers.
5. Evidence binaries live in object storage (OPEN-4 provider-agnostic); the relational DB (MySQL 8 per ADR-0008) stores metadata only (`EvidenceFile`).
6. The indicator taxonomy is read from framework seed data (ADR-0003); no module hard-codes indicator lists or weights.

## Deferred (explicit)

- **AI mapping engine** (suggest indicator mappings): Sprint 2, blocked on OPEN-3 (provider + PDPA residency). Contract placeholder only — see `openapi.yaml` §Deferred.
- **Report generation (PA1/PA2/PA3)**: contract v0.2 after UX + official-form field inventory (M-4 in data-model README).
- **Notification channels**: worker → notification service; contract after channel choice.
