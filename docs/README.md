# AI School (SEIP) — Documentation

เอกสารของ School Evidence Intelligence Platform พัฒนาโดย **Claude Code ตัวเดียว** (ADR-0004) — user เป็นผู้อนุมัติสุดท้าย (โมเดล Multi-AI เดิมถูกยกเลิก ไฟล์ที่เกี่ยวข้องติด banner SUPERSEDED)

## Layout (canonical per ADR-0002)

| Location | Content |
|---|---|
| `/CLAUDE.md` | คู่มือทำงานของ Claude Code (sole developer) — `/AGENTS.md` `/ANTIGRAVITY.md` `/GROK.md` superseded |
| `/.ai-team/` | Task board (tracker เดียว), work orders (task specs), templates |
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
