# AI School (SEIP) — Documentation

เอกสารของ School Evidence Intelligence Platform พัฒนาโดยทีม Multi-AI: Claude Code (architect/integrator), Codex (backend), Antigravity (frontend), Grok CLI (QA/security)

## Layout (canonical per ADR-0002)

| Location | Content |
|---|---|
| `/CLAUDE.md` `/AGENTS.md` `/ANTIGRAVITY.md` `/GROK.md` | Agent instructions — repo root so each tool auto-loads its own |
| `/.ai-team/` | Operating system: task board, ownership, locks, work orders, handoffs, templates |
| `docs/project/` | Project state, Sprint plans, development plan |
| `docs/decisions/` | ADRs (ADR-0001 stack, ADR-0002 layout/ownership, ADR-0003 evaluation framework) |
| `docs/architecture/` | System context, evaluation framework (วPA ว9/ว10-2564), data model, UX designs |
| `docs/contracts/` | Protected contracts: openapi / events / permissions / error-codes (from SEIP-ARCH-001) |
| `docs/qa/` | Quality gates and QA baselines |
| `docs/reviews/` | Review findings, CCRs, verdicts (Grok's output) |

## Start here
1. `docs/project/PROJECT_STATE.md` — current phase and objectives
2. `.ai-team/task-board.yaml` — who is doing what right now
3. `docs/project/SPRINT-0.md` — the plan and the Definition of Ready to Build

## Ground rule
No production feature code until the Sprint 0 exit gate passes. Design, contracts, gates, and scaffolding only.
