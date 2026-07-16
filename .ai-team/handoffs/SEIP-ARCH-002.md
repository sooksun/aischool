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

**QA-002 (S2)** — *The contract breaking-change gate would almost never have run.* QA-001 wired oasdiff behind `if: github.event_name == 'pull_request'`, but ADR-0004 sanctions committing straight to `develop` — which is how every Sprint 0 task after OPS-001 actually landed. A PR-only check on a workflow that rarely sees PRs protected nearly nothing, while reading as a green "contract compatibility" gate. Severity S2: the integrity control for a Protected Artifact was effectively inert, and its greenness was misleading.
Fixed in this task: the check runs on **both** events (PR → target branch; push → `github.event.before`). Also pinned the oasdiff image **by digest** — it was implicitly `:latest`, violating SEC-REPO-2 of the very baseline written one task earlier.
Verified locally before merge: `oasdiff breaking` develop(v0.1.0-draft) → branch(v1.0.0) = **"No breaking changes to report"**, exit 0 — the tool runs and the lock is non-breaking.

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
| 7 | A branch has passed the full gate pipeline end to end | ✅ **via the push path, not a PR.** The user approved by instructing "merge" without opening a PR, so the pull_request path never ran. Rather than declare the item passed on a technicality, the gate was **fixed** (finding QA-002): oasdiff now runs on push too, so merging this branch to develop executes the *complete* pipeline — all 4 LIVE gates including breaking-change detection — on real content. **The pull_request event path itself remains unexercised** until the first PR is opened; recorded as residual risk #5, not silently claimed. |
| 8 | `SEIP-QA-002` verdict is APPROVE | ↩️ **CANCELLED by ADR-0004** — replaced by self-review (DB-000 review, UI-000 field trace, this security pass) + **user approval**, which is item 7's PR review. |
| 9 | ADR-0001 and ADR-0002 Accepted | ✅ (plus ADR-0003, ADR-0004) |
| 10 | Every Sprint 0 task has a handoff | ✅ **after this task** — ARCH-001's was missing and is now written (retroactively, marked as such) |

**Gate status: 8 pass, 1 accepted deviation (item 1), 2 superseded (items 2, 8).**

Item 7 — "the only evidence that the operating system works" — passes via the push path after the fix in QA-002. User approval: given as the instruction to merge (2026-07-17). **Sprint 1 opens on the green CI run for the merge commit on develop.**

## Carried risk into Sprint 1 (from the security pass)
1. **Enforcement is unproven.** Contracts *permit* correct tenancy/upload behavior; no code implements it yet. The permission-tests gate stays unarmed until `tests/security/*` land — this is the largest carried risk, and SEC-TEN-5 (permissions.yaml as test fixture) is the mitigation.
2. SEC-UPL-5 (safe serving headers) + rate limiting are infra-level, verifiable only against a deployment.
3. **OPEN-4 (object storage) still open** — blocks the first storage adapter; presigned semantics vary by provider.
4. **OPEN-3 (AI provider + PDPA residency) still open** — blocks Sprint 2 AI mapping, not Sprint 1.
5. **The `pull_request` CI path has never executed.** No PR has been opened on this repo; every run so far was a `push` event. If Sprint 1 adopts PRs (or branch protection is enabled, which forces them), the PR-event wiring — `github.base_ref` resolution, required-check names, CODEOWNERS review — meets reality for the first time then. Expect to debug the pipeline, not the code, on that first PR.
6. **Branch protection is still not enabled** (needs `gh auth login` or the web UI). Until then, `main`/`develop` are protected by convention only — a mistaken force-push has nothing stopping it. Recommended settings are in `.ai-team/handoffs/SEIP-OPS-001.md`.

## Next
On merge: Sprint 1 opens — `SEIP-DB-001` (Prisma schema + migrations + constraint tests from the entity dictionary), then `SEIP-UI-001` (evidence flow from the UX design). OPEN-4 should close before DB-001 finalizes storage columns.
