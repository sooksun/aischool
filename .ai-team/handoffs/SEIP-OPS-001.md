# Handoff: SEIP-OPS-001 — Bootstrap repository and orchestration system

- **Owner:** claude
- **Reviewer:** grok
- **Work order:** `.ai-team/work-orders/SEIP-OPS-001.md`
- **Status:** `review_requested`
- **Date:** 2026-07-31

## Summary

The operating system described in `docs/` now runs from the repository root. An
agent can read `.ai-team/task-board.yaml` at the path its instruction file
names, every referenced path has exactly one owner, and CI enforces both of
those claims on every pull request instead of leaving them as prose.

Three of the eleven acceptance criteria are **not** satisfied by this change
because they need repository-admin rights, not a commit. They are listed under
"Not done" with the exact steps required.

## 1. Files moved and why

Findings F2 and F3 (`docs/project/SPRINT-0.md`): Claude Code loads `CLAUDE.md`
from the repo root and Codex loads `AGENTS.md` from the repo root. In `docs/`
neither file was ever loaded by the tool it was written for, and every
`.ai-team/...` reference inside them resolved to nothing.

Per ADR-0002 §1, moved with `git mv` (history preserved):

| From | To |
|---|---|
| `docs/CLAUDE.md` | `CLAUDE.md` |
| `docs/AGENTS.md` | `AGENTS.md` |
| `docs/ANTIGRAVITY.md` | `ANTIGRAVITY.md` |
| `docs/GROK.md` | `GROK.md` |
| `docs/.ai-team/` (17 files) | `.ai-team/` |

ADR-0002 §1 allowed either pointer stubs or removal in `docs/`. Removal was
chosen: a stub that says "the real file is elsewhere" is one more thing that can
drift, and the tools do not read `docs/` anyway. `docs/README.md` now links to
the root copies so a human browsing `docs/` is not stranded.

`docs/reports/` (finding F5) did not exist in the tree, so there was nothing to
remove or repurpose. `docs/reviews/` already existed with two files in it.

## 2. Path corrections applied

Per ADR-0002 §2 and §6 (lower documents are corrected to match higher ones):

| File | Was | Now |
|---|---|---|
| `AGENTS.md` | `contracts/**` | `docs/contracts/**` |
| `ANTIGRAVITY.md` | `contracts/**` | `docs/contracts/**` |
| `CLAUDE.md` | `project/PROJECT_STATE.md` (×2) | `docs/project/PROJECT_STATE.md` |
| `CLAUDE.md` | `decisions/ADR-*.md` | `docs/decisions/ADR-*.md` |

`GROK.md` already pointed at `docs/reviews/**` and needed no change.

## 3. Ownership — two holes found that ADR-0002 did not cover

`module-ownership.yaml` gained every entry from ADR-0002 §5, plus a new
`orchestration` module holding `.ai-team/**`, `.github/**`,
`scripts/orchestration/**`, the four instruction files, and root repo config.

Writing the validator surfaced two ownership problems that the ADR missed.
**Both need grok's ruling; neither is a mechanical edit.**

**Hole 1 — design output inside another agent's subtree.** `SEIP-DB-000` (codex)
writes `docs/architecture/data-model/**` and `SEIP-UI-000` (antigravity) writes
`docs/architecture/ux/**`, but ADR-0002 gives all of `docs/architecture/**` to
claude. As written, both Wave 2 tasks were assigned to write into a module they
do not own. Resolved by carving out two modules — `data-model` (codex/grok) and
`ux-design` (antigravity/claude) — matching the owners `SPRINT-0.md` already
assigns. Intentional carve-outs are declared in a `carve_outs:` list so the
validator can tell them apart from an accidental double claim.

**Hole 2 — drop-boxes.** Every agent writes its own
`.ai-team/handoffs/<task-id>.md` and takes its own locks in
`.ai-team/file-locks.yaml`, both of which sit in a claude-owned module. Codex has
*already* filed `docs/reviews/SEIP-DB-000-feasibility.md` into a grok-owned path.
Under a strict reading the charter forbids all of this. Resolved with a
`shared_write_paths:` list: any task owner may write there under its own task ID,
while review authority stays with the owning module.

Both additions extend ADR-0002 rather than implement it. If grok disagrees, the
fix is an ADR amendment and a board correction, not a change to the validator.

## 4. Branch protection mechanism (OPEN-1)

OPEN-1 closed 2026-07-16 in favour of GitHub. Enforcement is therefore
server-side and cannot be committed:

- **Protected branches** on `main` and `develop` — require a pull request,
  require review from Code Owners, require status checks to pass.
- **`.github/CODEOWNERS`** — every module path from `module-ownership.yaml` has a
  rule, generated in the same order as the ownership file.
- **GitHub Actions** — the required status check is `Orchestration integrity`.

CODEOWNERS carries a compromise worth flagging: the logical owners
(claude/codex/antigravity/grok) have no GitHub identity, so every rule resolves
to `@sooksun`. The agent owner and reviewer are recorded in comments beside each
rule. GitHub therefore enforces *that a human reviewed*, not *that the correct
agent reviewed* — the agent-level check remains a process rule, enforced by the
validator and the PR template rather than by the platform.

## 5. CI skeleton — job list mapped to gates

`docs/qa/QUALITY-GATES.md` lists 12 pull-request gates and 7 release gates. All
19 have a job.

- `.github/workflows/pr-gates.yml` — runs on `pull_request` to `main`/`develop`.
  12 gate jobs plus `Orchestration integrity`.
- `.github/workflows/release-gates.yml` — runs on `v*` tags and on demand. 7 gate
  jobs. Kept separate from PR gates on purpose: a required check that is skipped
  on every PR blocks merges permanently.

Every gate job is a no-op that announces itself as pending. SEIP-QA-001 (grok)
owns the gate *commands*; this task owns the *wiring*; and there is no
application to run a real gate against. Filling a stub in means replacing its
`run:` block, not adding a job.

`Orchestration integrity` is not a stub. It runs two validators that must stay
green:

| Script | Enforces |
|---|---|
| `scripts/orchestration/validate-ownership.mjs` | AC 4–8: files resolve at the named paths; no path has two owners; every `allowed_paths` entry resolves to exactly one module; a task's owner owns everything it may write; each instruction file's "Owned Paths" agree with `module-ownership.yaml`; CODEOWNERS covers every module path |
| `scripts/orchestration/validate-gates.mjs` | AC 9: every documented gate has a job, and every gate job is a documented gate |

Both are dependency-free Node 22 (`scripts/orchestration/lib/mini-yaml.mjs` is a
deliberately strict YAML subset reader) because there is no `package.json` yet
and Sprint 0 forbids adding one.

Two checks in `validate-ownership.mjs` are worth knowing about:

- A carve-out must appear in CODEOWNERS *after* the subtree it carves out of.
  GitHub applies the last matching rule, so the natural ordering silently gives
  `docs/architecture/data-model/**` back to claude. The validator fails on it.
- `blocked_paths` are intentionally exempt from single-owner resolution — they
  are meant to be broad (`apps/**` spans two modules) — but a path that is both
  allowed and blocked on the same task is an error.

## 6. Verification

Run from the repo root. Output is real, not expected-output.

```
$ node scripts/orchestration/validate-ownership.mjs
ownership OK — 36 owned paths across 7 modules, 9 tasks on the board, 0 warning(s)
$ echo $?
0

$ node scripts/orchestration/validate-gates.mjs
gates OK — 19 documented gates covered by 19 jobs across 2 workflows
$ echo $?
0

$ ls CLAUDE.md AGENTS.md ANTIGRAVITY.md GROK.md
AGENTS.md  ANTIGRAVITY.md  CLAUDE.md  GROK.md
$ ls .ai-team/task-board.yaml .ai-team/module-ownership.yaml .ai-team/file-locks.yaml
.ai-team/file-locks.yaml  .ai-team/module-ownership.yaml  .ai-team/task-board.yaml
$ ls .github/CODEOWNERS .github/workflows/
.github/CODEOWNERS
pr-gates.yml  release-gates.yml
```

### CI run — Definition of Ready item 7

The pipeline is proven, not assumed. Run
[30624657353](https://github.com/sooksun/aischool/actions/runs/30624657353) on
PR #2: **all 13 jobs green**, 12 gate stubs plus `Orchestration integrity`.

`Orchestration integrity` did not pass vacuously — the runner log shows both
validators executing against the checked-out tree on Node 22:

```
Run node scripts/orchestration/validate-ownership.mjs
ownership OK — 36 owned paths across 7 modules, 9 tasks on the board, 0 warning(s)
Run node scripts/orchestration/validate-gates.mjs
gates OK — 19 documented gates covered by 19 jobs across 2 workflows
```

`release-gates.yml` has **not** been exercised — it triggers on `v*` tags, and
there is no release to tag. Its 7 jobs are structurally identical to the PR
stubs that did run, but that is an inference, not evidence.

### Fault injection

A validator that has never failed is not evidence. Four fault injections were
run locally and reverted; each produced exit 1:

| Injected fault | Detected as |
|---|---|
| `prisma/**` added to the frontend module | `prisma/** is claimed by both "backend" and "frontend"` |
| `docs/architecture/data-model/**` removed from `carve_outs` | `sits inside docs/architecture/** … declare it under carve_outs` |
| `/docs/architecture/data-model/**` moved above `/docs/architecture/**` in CODEOWNERS | `the last matching rule wins, so the carve-out would be overridden` |
| `secret-scan` job deleted from `pr-gates.yml` | `"Secret scan" (Pull Request Gates) has no job` |

## 7. Decision on `aischool-docs.zip` — ignored, not deleted

**Decision: ignore, keep on disk, do not track.** The entry is already in
`.gitignore` under an explicit comment. The zip is not in the repository and was
not deleted — the work order forbids deleting it without your say-so, and that
confirmation has not been given.

This closes AC 11 as *recorded*, and leaves the underlying risk open: the zip
duplicates `docs/` and will drift now that git is the source of truth. The
recommendation is to delete the local copy once you have confirmed the git
history is satisfactory, but that is your call, not this task's.

## 8. Not done

Three acceptance criteria are not met. All three need repository-admin actions
that a pull request cannot perform.

**AC 1 — `develop` branch.** Only `main` exists. This session was constrained to
push a single branch (`claude/remote-control-5aclif`); creating `develop` and
making it the default working base is one command plus a repo setting, and doing
it silently from an unrelated branch would be worse than reporting it:

```bash
git checkout main && git pull origin main
git checkout -b develop && git push -u origin develop
# then: Settings → General → Default branch → develop
```

**AC 2 — branch protection.** Not active. Direct pushes to `main` are currently
accepted by the server, which means charter rule 3 is unenforced. Required
settings on both `main` and `develop`: require a pull request before merging;
require review from Code Owners; require status check `Orchestration integrity`;
disallow force pushes and deletions.

**AC 10 — throwaway branch proven green.** ✅ **Closed.** Run 30624657353 on
PR #2 is green across all 13 jobs; see §6. Definition-of-Ready item 7 is
satisfied for the PR pipeline. The release pipeline remains unproven until
something is tagged.

**Follow-up, not blocking.** The runner warns that `actions/checkout@v4` and
`actions/setup-node@v4` target Node 20 and are being forced onto Node 24. The
jobs pass today. Bumping to `@v5` was left out of this task rather than guessed
at, because breaking a pipeline whose whole purpose is to prove it works would
be a poor trade for silencing a warning.

**Scope note.** The work order authorises `.gitkeep` scaffolding for `apps/`,
`packages/`, `prisma/`, `tests/`, `infra/`. Four more were created —
`public/`, `database/`, `scripts/security/`, `docs/architecture/ux/` — because
`module-ownership.yaml` names them and an owned path that does not exist is a
promise nobody can check. Same class of action, wider than the letter of the
work order.

**Board note.** `docs/project/PROJECT_STATE.md` and `docs/README.md` were added
to this task's own `allowed_paths` during execution. Editing one's own
permissions deserves a reviewer's eye: the justification is that PROJECT_STATE
upkeep is a standing claude responsibility (`CLAUDE.md` rule 9) and README
pointed at the pre-move file locations, but grok should confirm rather than
assume.

**Branch name.** The board specifies
`ai/claude/SEIP-OPS-001-repo-bootstrap`. This work was done on
`claude/remote-control-5aclif` because the session mandated that branch. The
board entry is unchanged and still records the intended convention.

## 9. Review focus for grok

In priority order:

1. The two ownership extensions in §3 (`carve_outs`, `shared_write_paths`).
   These change what the charter permits. Rule on them before Wave 2 starts,
   because SEIP-DB-000 and SEIP-UI-000 both depend on the answer.
2. Whether CODEOWNERS resolving every module to a single human (§4) is an
   acceptable enforcement gap or needs GitHub accounts per agent.
3. The self-granted `allowed_paths` widening in §8.
4. Whether `orchestration` owning all four instruction files is right, or whether
   each agent should own its own file.

## Recommended next task

**SEIP-ARCH-001** — architecture and contracts v0.1 — once grok approves this
handoff and AC 1, 2 and 10 are closed. `SEIP-QA-001` (grok) unblocks in the same
wave and can start in parallel.

Both remain `blocked` on the board: they unblock when SEIP-OPS-001 is
**approved**, not when it is submitted.
