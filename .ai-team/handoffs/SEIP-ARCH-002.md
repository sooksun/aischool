# Close-out: SEIP-ARCH-002 — Contract Lock v1.0.0 (Sprint 0 Exit)

Owner: claude (solo per ADR-0004) · Date: 2026-07-17 · **Ratification: user (pending PR approval)**

## Delivered
| Artifact | Change |
|---|---|
| `docs/contracts/{openapi,permissions,events,error-codes}.yaml` | `0.1.0-draft` → **`1.0.0` locked**; lock headers state the versioning rule (additive → 1.x, breaking → CCR + 2.0) |
| `docs/contracts/contract-policy.md` | Approval flow rewritten for single-agent mode; CCR history table; protected-contract inventory with versions |
| `docs/reviews/SEIP-ARCH-002-security-pass.md` | Security baseline §2 (tenancy) + §3 (upload) full pass against final contracts |
| `scripts/security/validate-contracts.mjs` | **New authz-coverage check** — every operationId must have a matrix rule or an explicit exemption |
| `docs/contracts/permissions.yaml` | `unauthenticated:` / `any_authenticated:` sections — explicit disposition for `login` and `getCurrentUser` |
| `.ai-team/handoffs/SEIP-ARCH-001.md` | Written retroactively — exit-gate item 10 caught it missing |

## Findings raised and closed in this task
**QA-001 (S4)** — `login` and `getCurrentUser` had no documented authz rule. Not defects, but undocumented intent is indistinguishable from oversight. Fixed by explicit exemptions carrying their own conditions (login: throttle + no user enumeration; getCurrentUser: must never accept a user id). The gate now fails any future endpoint without a rule. Verified: 27 operations · 25 matrix rules · 2 exemptions · exit 0.

## Sprint 0 Exit Gate — honest evaluation

`SPRINT-0.md` defines 10 items, written pre-ADR-0004 for a four-agent team. Reinterpreted per the ADR-0004 banner on that document:

| # | Item (as written) | Verdict |
|---|---|---|
| 1 | main & develop exist; **no agent committed directly to either** | ⚠️ **DEVIATION — stated, not hidden.** `main`: 1 commit (genesis, predates the branch model), untouched since. `develop`: 8 direct commits by claude (ARCH-001, UI-000, QA-001). This rule existed to prevent *multi-agent collisions*; with one developer there is no collision, and `CLAUDE.md` (ADR-0004) explicitly sanctions "day-to-day work happens on develop or feat/ branches". ARCH-002 itself went through a branch + PR. **Accepted under ADR-0004; the rule as literally written no longer applies.** |
| 2 | Each of the four agents' instruction files loads from repo root | ↩️ **SUPERSEDED.** Only `CLAUDE.md` applies; it is at root and auto-loads. AGENTS/ANTIGRAVITY/GROK carry SUPERSEDED banners. |
| 3 | `.ai-team/*` resolve at named paths | ✅ (ADR-0002 canonicalization, OPS-001) |
| 4 | Exactly one owner per path, no double ownership | ✅ `gate:ownership` — 5 modules, 27 globs, 0 errors |
| 5 | 4 contracts exist, v1.0, locked | ✅ **this task** |
| 6 | Every gate has a runnable command + a CI job | ✅ QA-001 — 4 LIVE, 8 self-arming (arming conditions documented) |
| 7 | A branch has passed the full gate pipeline end to end | ⏳ **pending the ARCH-002 PR** — CI is green on develop 4× (`5b6c0cf` latest), but the PR-only path (oasdiff breaking-change vs base) has never executed. This PR is its first real run. |
| 8 | `SEIP-QA-002` verdict is APPROVE | ↩️ **CANCELLED by ADR-0004** — replaced by self-review (DB-000 review, UI-000 field trace, this security pass) + **user approval**, which is item 7's PR review. |
| 9 | ADR-0001 and ADR-0002 Accepted | ✅ (plus ADR-0003, ADR-0004) |
| 10 | Every Sprint 0 task has a handoff | ✅ **after this task** — ARCH-001's was missing and is now written (retroactively, marked as such) |

**Gate status: 7 pass, 1 accepted deviation (item 1), 2 superseded (items 2, 8), 1 pending the PR (item 7).**

Item 7 is the one the sprint plan called "the only evidence that the operating system works" — so **Sprint 1 opens when this PR goes green and the user approves the merge**, not before.

## Carried risk into Sprint 1 (from the security pass)
1. **Enforcement is unproven.** Contracts *permit* correct tenancy/upload behavior; no code implements it yet. The permission-tests gate stays unarmed until `tests/security/*` land — this is the largest carried risk, and SEC-TEN-5 (permissions.yaml as test fixture) is the mitigation.
2. SEC-UPL-5 (safe serving headers) + rate limiting are infra-level, verifiable only against a deployment.
3. **OPEN-4 (object storage) still open** — blocks the first storage adapter; presigned semantics vary by provider.
4. **OPEN-3 (AI provider + PDPA residency) still open** — blocks Sprint 2 AI mapping, not Sprint 1.

## Next
On merge: Sprint 1 opens — `SEIP-DB-001` (Prisma schema + migrations + constraint tests from the entity dictionary), then `SEIP-UI-001` (evidence flow from the UX design). OPEN-4 should close before DB-001 finalizes storage columns.
