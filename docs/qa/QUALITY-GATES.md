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
| Code owner review | — (not a CI job) | branch protection + CODEOWNERS | policy | requires branch protection (below) |

**Pass thresholds:** every gate is binary (exit 0). `dep-audit` fails on **high+** advisories. oasdiff fails on **breaking** changes only (additive contract changes pass). Secret scan fails on any leak — a confirmed false positive gets an inline `// gitleaks:allow` comment on the exact flagged line (gitleaks' native line-level suppression), with a code comment explaining why it isn't a real secret, reviewed in the same PR. Never skip the gate to work around one. (A repo-wide `.gitleaks.toml` allowlist was tried first for SEIP-API-001's one false positive — `credentials: { ..., secretAccessKey: env.S3_SECRET_KEY }`, gitleaks' `generic-api-key` rule matching the *identifier* `secretAccessKey:` regardless of the RHS being a literal or a variable reference — but its regex/fingerprint matching didn't reliably suppress findings already baked into git history when run through the pinned docker image; the inline comment is simpler, guaranteed to work per-line, and keeps the justification next to the code it excuses.)

**Why the contract check runs on push, not just PRs:** ADR-0004 sanctions committing straight to `develop`, so a PR-only breaking-change check would almost never execute in the real workflow. On `push` it diffs against `github.event.before`; on `pull_request`, against the target branch. Both paths fail the build on a breaking change without an accompanying version bump.

**Authz coverage (SEC-TEN-5):** `gate:contracts` fails if any `operationId` in `openapi.yaml` lacks either a rule in the `permissions.yaml` matrix or an explicit entry under `unauthenticated:` / `any_authenticated:`. An endpoint cannot ship with undocumented authorization.

## Release gates (run before tagging a release from main — not CI jobs yet)

| Gate | Owner (ADR-0004: claude executes, user approves) | Trigger | Command status |
|---|---|---|---|
| End-to-end tests | claude | before merge develop→main | defined in Sprint 1 with first UI (`tests/e2e`) |
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
```

Add the self-arming gate names to the required list **when they arm** (a required check that always no-ops gives false confidence; a required check that's armed is real). Protection setup itself still needs `gh auth login` or the web UI — steps recorded in `.ai-team/handoffs/SEIP-OPS-001.md`.

## Verified runs (2026-07-17, local)

| Command | Result |
|---|---|
| `npm run gate:ownership` | exit 0 — 5 modules, 27 globs, 0 errors |
| `npm run gate:contracts` | exit 0 — lint OK, typegen OK, 3× yaml parse OK |
| `npm run gate:dep-audit` | exit 0 — 0 vulnerabilities |
| `npm run gate:secret-scan` | exit 0 — 7 commits scanned, no leaks (docker image, pinned v8.18.4) |
| oasdiff breaking (develop v0.1-draft → ARCH-002 v1.0.0) | exit 0 — "No breaking changes to report" (docker, digest-pinned) |
