# ADR-0002: Repository Layout and Ownership Canonicalization

## Status
Accepted

## Context

The document review found the operating-system files contradict each other on where things live and who owns what. Left unresolved, these are exactly the seams where two agents collide. The specific findings (F2–F8 in `SPRINT-0.md`):

- Agent instruction files reference `.ai-team/**` and `contracts/**` at the repo root; the files actually sit under `docs/`.
- `AGENTS.md`/`ANTIGRAVITY.md` say `contracts/**`; ownership + board say `docs/contracts/**`.
- Grok is told to write to `docs/reviews/**`; only `docs/reports/` exists.
- `SEIP-DB-001` reviewer is `claude` on the board but `grok` in `module-ownership.yaml`.
- `.ai-team/**`, `infra/docker/**`, `tests/frontend/**`, `scripts/security/**`, `scripts/orchestration/**`, `.github/**` are referenced but have no declared owner.

## Decision

### 1. Canonical location of the operating system
The `.ai-team/` directory and the four agent instruction files are the operating system and must be loadable by the tools that consume them. Therefore:

- `CLAUDE.md` and `AGENTS.md` are placed at the **repository root** (where Claude Code and Codex auto-load them). The copies under `docs/` become thin pointers to the root, or are removed by `SEIP-OPS-001`.
- `.ai-team/` is placed at the **repository root**. All agent instruction files reference `.ai-team/...` (root-relative).
- `docs/` remains the home for human-readable architecture, contracts, decisions, QA, and project narrative.

### 2. Canonical contract location
Contracts live at **`docs/contracts/**`**. `AGENTS.md` and `ANTIGRAVITY.md` are corrected from `contracts/**` to `docs/contracts/**` by `SEIP-OPS-001`. There is no root-level `contracts/` directory.

### 3. Canonical review-output location
Grok's review output location is **`docs/reviews/**`**. `SEIP-OPS-001` creates `docs/reviews/` (with `.gitkeep`) and either repurposes or removes the empty `docs/reports/`. `GROK.md` and `module-ownership.yaml` are aligned to `docs/reviews/**`.

### 4. Reviewer authority
`module-ownership.yaml` is the single source of truth for module reviewers. The board's per-task `reviewer` must not contradict it. Corrections:
- `SEIP-DB-001` reviewer → **grok** (backend module reviewer), with claude as integrator. The board is updated to match.

Rationale: Grok is the independent reviewer by charter (rule 8). Making Claude both drafter and reviewer of the backend contract removes the independent check.

### 5. Ownership completeness
`module-ownership.yaml` gains these entries so every referenced path has exactly one owner:

| Path | Owner | Reviewer | Note |
|---|---|---|---|
| `.ai-team/**` | claude | grok | Orchestration state |
| `.github/**` | claude | grok | CI + CODEOWNERS |
| `scripts/orchestration/**` | claude | grok | Already in CLAUDE.md owned paths |
| `infra/docker/**` | codex | grok | Already in AGENTS.md owned paths |
| `scripts/security/**` | grok | claude | Already in GROK.md owned paths |
| `tests/frontend/**` | antigravity | claude | Already in ANTIGRAVITY.md owned paths |
| `tests/backend/**` | codex | grok | Already in AGENTS.md owned paths |
| `public/**` | antigravity | claude | Already in ANTIGRAVITY.md owned paths |

### 6. Precedence rule
When documents conflict, precedence is: **ADR > `module-ownership.yaml` > `task-board.yaml` > agent instruction files > narrative docs.** The lower document is corrected to match the higher, never the reverse.

## Consequences

- `SEIP-OPS-001` carries the mechanical edits (moving files, correcting path strings, updating the board and ownership file). No behaviour is invented; this ADR only makes the existing intent consistent.
- After this ADR, "read `.ai-team/task-board.yaml`" resolves correctly for every agent.
- The precedence rule gives future conflicts a deterministic resolution instead of a discussion.

## Approved By
User direction (hold features until the division-of-work system is ready), recorded by Claude

## Date
2026-07-16
