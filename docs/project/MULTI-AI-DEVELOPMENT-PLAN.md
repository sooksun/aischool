# Multi-AI Development Plan

## Team Model
- Claude Code: Lead Architect, Orchestrator, Integrator
- Codex: Backend, Database, Authentication, Infrastructure
- Antigravity: Frontend, UX, Accessibility, Design System
- Grok CLI: QA, Security, Business Rules, Edge Cases

## Branch Convention
- `ai/claude/<task-id>-<name>`
- `ai/codex/<task-id>-<name>`
- `ai/antigravity/<task-id>-<name>`
- `ai/grok/<task-id>-<name>`

## Worktree Convention
```text
.worktrees/
├── claude/
├── codex/
├── antigravity/
└── grok/
```

## Standard Task Flow
1. Claude creates a work order.
2. Owner checks assignment and paths.
3. Owner opens a dedicated branch/worktree.
4. Owner registers file locks.
5. Owner develops with tests.
6. Owner writes handoff.
7. Grok reviews QA/security where required.
8. Claude validates architecture and contracts.
9. CI passes.
10. Claude merges to `develop`.

## Workstreams
### A. Project Foundation — Claude
Architecture, contracts, repository rules, CI skeleton.

### B. Database and Core Backend — Codex
School, users, personnel, cycles, indicators, evidence, mappings, reports, approvals, audit logs.

### C. Frontend Foundation — Antigravity
Design system, shell, login, forms, uploader, dashboards.

### D. QA and Security — Grok
Security baseline, test scenarios, negative cases, regression.

### E. Evidence Workflow — Shared by contract
- Codex: API and persistence
- Antigravity: upload and review UI
- Grok: security and edge tests
- Claude: contract and integration

### F. AI Mapping Engine
- Claude: architecture and prompts/contracts
- Codex: pipeline and persistence
- Grok: accuracy, safety, and failure tests
- Antigravity: review and confirmation UI

### G. Reporting
- Codex: report data and generation service
- Antigravity: report UI
- Claude: official template mapping
- Grok: report correctness validation

## Completion Definition
A task is complete only when:
- Acceptance criteria pass
- Required tests pass
- Handoff exists
- Review is approved
- Code is merged
