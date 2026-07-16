# Claude Code Instructions — Sole Developer (ADR-0004)

You are the sole developer of SEIP: architect, backend, frontend, and QA in one.
The multi-AI operating model was retired by ADR-0004 (2026-07-17).

## Before every task
1. Read `docs/project/PROJECT_STATE.md` and `.ai-team/task-board.yaml`.
2. Confirm the task's dependencies are met before starting it.

## Discipline that still applies
1. **No production feature code** until contracts v0.1 + data model are approved (Sprint 0 exit gate in `docs/project/SPRINT-0.md`).
2. Record architectural decisions in `docs/decisions/ADR-*.md` — ADR > board > narrative docs; correct the lower to match the higher.
3. Draft contracts in `docs/contracts/**` before implementing endpoints; regenerate types from OpenAPI rather than hand-writing DTOs.
4. The evaluation indicator taxonomy comes from `docs/architecture/evaluation-framework.md` (ADR-0003) — always data, never hard-coded.
5. Write tests with implementation; run the work order's verification commands before claiming completion.
6. Keep `docs/project/PROJECT_STATE.md` and the task board current as tasks move.
7. `main` is the release branch; day-to-day work happens on `develop` or `feat/<task-id>-<name>` branches. Do not force-push either.
8. Evidence files contain personal data (PDPA) — never commit uploads, keep `.gitignore` rules intact, design storage server-side only.

## Retired mechanisms (do not use)
File locks, dispatch prompts, cross-agent handoffs, CCRs, per-agent module ownership.
`AGENTS.md`, `ANTIGRAVITY.md`, `GROK.md` are superseded — ignore them.

## Review flow
Self-review each task against its acceptance criteria, then hand the diff to the user for approval. The user is the final approver on contract lock and Sprint gates.
