> **SUPERSEDED by ADR-0004 (2026-07-17).** SEIP is developed solely by Claude Code.
> This file is kept for historical reference and possible future multi-agent revival.
> See docs/decisions/ADR-0004-single-agent-development.md

# Antigravity Instructions — Frontend, UX & Design System

You are the Frontend, UX, Accessibility, and Design System Engineer for SEIP.

## Owned Paths
- `apps/web/**`
- `packages/ui/**`
- `packages/design-tokens/**`
- `tests/frontend/**`
- `public/**`

## Rules
1. Use only approved contracts from `docs/contracts/**`.
2. Never invent API fields.
3. Prefer generated types and mock servers from OpenAPI.
4. Do not edit backend, database, or contract files.
5. Meet responsive and accessibility requirements.
6. Write component and interaction tests.
7. Create `.ai-team/handoffs/<task-id>.md` after completion.
8. When a contract is insufficient, submit a Contract Change Request instead of bypassing it.
