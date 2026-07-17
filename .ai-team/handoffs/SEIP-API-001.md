# Close-out: SEIP-API-001 — Backend evidence-workflow API (new task, created and completed this session)

Owner: claude (solo per ADR-0004) · Date: 2026-07-17 · Branch: `feat/SEIP-API-001-evidence-workflow`

## Why this task exists
Not on the original Sprint 1 board. Discovered while auditing the plan against the
actual repo: `apps/` and `packages/` were still `.gitkeep`-only after ARCH-002 locked
the contracts and DB-001 built the schema — the contract and the data existed with
**nothing implementing the API between them**. This task closes that gap for the
evidence-submission slice (the one Sprint 1's UI-001 needs to build against).

## Delivered
| Package/App | Content |
|---|---|
| `packages/backend-shared` | Error codes + event types **generated** from `error-codes.yaml`/`events.yaml` (codegen script + CI drift check, not hand-typed); `ApiError`; `permissions.yaml` runtime loader |
| `packages/auth` | Argon2id password hashing, access/refresh JWT (jose), opaque refresh tokens, pure tenancy-resolution functions — 13 unit tests |
| `packages/database` | Prisma client singleton + tenancy-safe repositories (every query takes `schoolId`, folds it into the WHERE clause) + PDPA-allowlisted audit writer — 6 integration tests against real Postgres |
| `apps/api` | Fastify server implementing **15 of 27** `openapi.yaml` operations (auth, taxonomy, evidence CRUD + two-phase MinIO upload, governed mappings) — 6 end-to-end integration tests against real Postgres + real MinIO |
| `docs/decisions/ADR-0006` | Framework choices: Fastify, Zod, Vite+React, npm workspaces, AWS S3 SDK against MinIO |

## Gaps found and resolved during implementation (each is a real, load-bearing decision — not hidden)
| Gap | Resolution |
|---|---|
| `TokenPair.refresh_token` had no backing table | Additive migration: `RefreshToken` (hash-only storage, rotation chain) |
| `UserAccount` had no password field at all | Additive migration: `passwordHash` (nullable) |
| No rule for "which school" when a user holds multiple memberships | **CCR-003**: single membership → implicit; multiple → `X-School-Id` header, validated against real memberships |
| `FileUploadComplete` schema too thin to rebuild the storage key / re-validate | **CCR-004**: request body widened (additive); documented limitation — server doesn't re-read the object from MinIO to verify what was actually uploaded (needs a future worker) |
| `login`/`getCurrentUser` had no `permissions.yaml` disposition | Fixed in ARCH-002 already (QA-001 finding) — reused here |

## Bugs found by actually running the server (not just typecheck/unit tests)
1. `0.0.0.0` binding → `EACCES` in this sandboxed environment → bind `127.0.0.1` instead (also the more correct choice behind an on-prem reverse proxy, ADR-0005).
2. Fastify's default request-id format (`req-1`) isn't a UUID, but `AuditEvent.requestId` is `@db.Uuid` → every audited mutation 500'd. Fixed with `genReqId: () => randomUUID()`.
3. `npm run build --workspaces` does **not** topologically sort — `packages/auth` was built before its dependency `packages/backend-shared`, and (worse) TypeScript's default `noEmitOnError: false` let the broken build silently emit `dist/` output anyway, masking the failure. Fixed: explicit `build:libs` ordering script + `noEmitOnError: true` on every package, verified by deliberately breaking a build and confirming (a) the chain stops and (b) no `dist/` is written.
4. A teacher confirming their own mapping correctly returned 403 — this was **not** a bug (permissions.yaml gives teachers `own-revoke`, not `confirm`); the first version of the manual smoke test had the wrong expectation and was fixed instead.

## Deliberately deferred (honest scope, not silently dropped)
- **12 of 27 contract operations**: cycles/rounds CRUD, committee assignments, per-evaluator scoring. These need their own data-shape decisions (e.g. how `submitMyScores`' bulk upsert interacts with `IndicatorScore`) substantial enough to be a separate task, not a shortcut inside this one.
- `evaluator: committee` grants on the 15 implemented operations **fail closed** (PERM-003) since no assignment data exists yet — this is correct, not a placeholder bug.
- Video duration / byte-size **server-side** verification (worker that HEADs the MinIO object) — CCR-004 residual.
- `apps/worker` itself doesn't exist yet — virus scanning, the duration probe, and outbox event dispatch are unimplemented; `scan_status` stays `pending` forever without it.

## Verification (actual, run locally against real Postgres 17 + MinIO)
- `npm run build` — clean from a fully deleted `dist/` tree, explicit dependency order
- `npm run typecheck` — 0 errors across all 4 packages
- `npm run test:unit` (packages/auth) — 13/13 pass
- `npm run test:integration --workspace packages/database` — 6/6 pass (tenancy isolation proven, not just asserted in comments)
- `npm run test:integration --workspace apps/api` — 6/6 pass (full HTTP flow: login → create evidence → presigned MinIO PUT → complete → promote to active → map → cross-role confirm/revoke governance → cross-school RES-001 isolation)
- All 4 root LIVE gates (`ownership`, `contracts`, `dep-audit`, `secret-scan`) — pass
- CI (`.github/workflows/ci.yml`): `migration-validation` unchanged; `integration` job extended with a MinIO service + explicit build-order + both new test suites — **not yet proven on GitHub's runners**, only locally; this PR/merge will be the first real run, per the same "item 7" discipline from ARCH-002

## Next
`SEIP-UI-001` (apps/web, this session continues into it) now has a real API to call instead of a contract alone. A future `SEIP-API-002` should cover cycles/rounds/committee scoring; `SEIP-WORKER-001` should cover virus scan + duration probe + outbox dispatch.

## Close verification 2026-07-17

Independent re-run before marking **done** (Postgres 17 + MinIO healthy locally):

| Check | Result |
|---|---|
| `npm run typecheck` (all workspaces) | pass |
| `npm run test:unit` (auth 13 + web 12) | pass |
| `packages/database` integration | 6/6 pass |
| `apps/api` integration | 6/6 pass |
| `npm run test:security` | 3/3 pass (matrix + area_admin + X-School-Id) |
| `npm run test:backend` | 18/18 pass |
| `gate:ownership` / `gate:contracts` / `gate:dep-audit` | pass |

**Code review notes (spot-check, no blocking defects):**
- Tenancy: repository queries require `schoolId` first; cross-school → null/RES-001 (proven by tests).
- Authz: `resolveGrant` loads `permissions.yaml` at runtime (no hand-copied matrix).
- Own-scope list/create forces owner filter; mapping self-confirm correctly denied for teacher.
- Audit writer allowlists fields (SEC-PDPA-2); DB trigger blocks update/delete.
- Upload path is metadata + MinIO presign (no bytes through API); worker verification still deferred (CCR-004).

**Status: DONE** on branch `feat/SEIP-API-001-evidence-workflow`. Merge to `develop` is the remaining shipping step (user approves).

## Merge

Merged to `develop` as `3db868d` (with UI-001). CI break on first post-merge run fixed in `556958c` (MinIO service startup + contract gate `npm ci`).
