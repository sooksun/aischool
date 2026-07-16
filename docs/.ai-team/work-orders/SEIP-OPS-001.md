# Work Order: SEIP-OPS-001

## Objective
Turn `D:\laragon\www\aischool` into a working repository that can actually run the operating system described in `docs/`. This is scaffolding only — **no production feature code**. When this task is done, any of the four agents can pick up a task ID and physically start work on an isolated branch with locked paths, and every agent instruction file is loaded by its own tool from the correct path.

This task exists because of findings F1, F2, F3, F9 in `docs/project/SPRINT-0.md`: the repo is not a git repo, the instruction files are not where their tools load them, and the path references in the operating system do not resolve.

## Owner
claude

## Reviewer
grok

## Dependencies
- ADR-0001 (Accepted)
- ADR-0002 (Accepted)
- OPEN-1 **closed 2026-07-16: GitHub remote.** Gate enforcement is server-side: GitHub branch protection on `main`/`develop`, CODEOWNERS review enforcement, GitHub Actions as the CI runner. No pre-push-hook fallback needed. Creating the GitHub repository and connecting the remote is in scope for this task (private repo; confirm org/account and repo name with the user before creating).

## Allowed Paths
- `/` repo initialization (`git init`, `.gitignore`, `.gitattributes`)
- `/.ai-team/**` (moved from `docs/.ai-team/**` per ADR-0002)
- `/CLAUDE.md`, `/AGENTS.md`, `/ANTIGRAVITY.md`, `/GROK.md` (root copies/pointers per ADR-0002)
- `/.github/**` (CI skeleton, CODEOWNERS, PR template)
- `/scripts/orchestration/**`
- `docs/reviews/**` (create with `.gitkeep`)
- Directory scaffolding with `.gitkeep` only: `apps/`, `packages/`, `prisma/`, `tests/`, `infra/`
- Path-string corrections inside `AGENTS.md`, `ANTIGRAVITY.md`, `GROK.md`, `module-ownership.yaml`, `task-board.yaml`

## Blocked Paths
- Any real source file under `apps/**`, `packages/**` (`.gitkeep` only)
- `prisma/schema.prisma` (no entities — Sprint 1)
- `docs/contracts/*.yaml` (owned by SEIP-ARCH-001)
- Deleting `aischool-docs.zip` without explicit user confirmation (see risk in SPRINT-0.md)

## Acceptance Criteria
1. `git init` complete; `main` and `develop` branches exist; `develop` is the default working base.
2. GitHub remote connected; branch protection active on `main` and `develop` (require PR, require CODEOWNERS review, require status checks); direct pushes rejected by the server.
3. `CLAUDE.md` loads from repo root for Claude Code; `AGENTS.md` loads from repo root for Codex. `ANTIGRAVITY.md` and `GROK.md` present at root. `docs/` copies are pointers or removed.
4. `.ai-team/task-board.yaml`, `.ai-team/module-ownership.yaml`, `.ai-team/file-locks.yaml` resolve at the root-relative paths the instruction files name.
5. `module-ownership.yaml` reflects ADR-0002 §5: every referenced path has exactly one owner; no double ownership.
6. `task-board.yaml` reflects ADR-0002 §4 (SEIP-DB-001 reviewer = grok) and lists the Sprint 0 tasks (OPS-001, ARCH-001, DB-000, UI-000, QA-001, QA-002, ARCH-002).
7. `.gitignore` excludes `node_modules`, build output, `.env*`, uploaded evidence, and `aischool-docs.zip`.
8. `.github/CODEOWNERS` maps each module path glob to its owner per `module-ownership.yaml`.
9. `.github/workflows/` contains a CI skeleton with a **job stub for every gate** in `docs/qa/QUALITY-GATES.md` (jobs may be no-ops that echo "pending SEIP-QA-001", but they must exist and be wired to run on PR).
10. A throwaway branch pushed through the pipeline runs the skeleton green end to end (proves the pipeline, per Definition of Ready item 7).
11. A decision on `aischool-docs.zip` (track / delete / ignore) is recorded; not deleted without user confirmation.

## Required Tests
- No unit tests (no feature code). Verification is structural.
- CI skeleton must execute on the throwaway branch and report success.

## Verification Commands
```bash
git -C "D:/laragon/www/aischool" rev-parse --is-inside-work-tree      # -> true
git -C "D:/laragon/www/aischool" branch --format='%(refname:short)'   # -> develop, main
ls CLAUDE.md AGENTS.md ANTIGRAVITY.md GROK.md                         # all present at root
ls .ai-team/task-board.yaml .ai-team/module-ownership.yaml            # resolve at root
ls .github/CODEOWNERS .github/workflows/                              # present
# CODEOWNERS covers every module path; no path owned twice:
node scripts/orchestration/validate-ownership.mjs                     # -> exit 0 (write this validator)
```

## Expected Handoff
`.ai-team/handoffs/SEIP-OPS-001.md` documenting: files moved and why, path corrections applied, the branch-protection mechanism chosen (and OPEN-1's answer), the CI skeleton job list mapped to gates, the throwaway-branch CI run link/output, and the `aischool-docs.zip` decision. Recommended next task: SEIP-ARCH-001.
