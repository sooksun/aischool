# Work Order: SEIP-UI-000

## Objective
Design the **evidence submission user flow** for SEIP as a UX artifact — flow diagram, wireframes/low-fi screens, state and error inventory, and accessibility notes — plus a frontend-usability review of contracts v0.1. This is **design, not implementation**: no React components, no design-token code, no `apps/web` source. Per `ANTIGRAVITY.md`, the frontend may never invent API fields, so this task's job is partly to prove the contract gives the UI every field it needs *before* anyone writes a screen.

This is the Antigravity half of the contract approval loop in `contract-policy.md` step 3 ("Antigravity validates frontend usability").

## Owner
antigravity

## Reviewer
claude

## Dependencies
- SEIP-OPS-001
- SEIP-ARCH-001 (contracts v0.1 to validate against)

## Allowed Paths
- `docs/architecture/ux/**` (flows, wireframes, state inventory — new)
- `.ai-team/handoffs/SEIP-UI-000.md`

## Blocked Paths
- `apps/web/**`, `packages/ui/**`, `packages/design-tokens/**` (no implementation — Sprint 1 / SEIP-UI-001)
- `tests/frontend/**` (no tests against non-existent components)
- `docs/contracts/**` (read-only; use a Contract Change Request to request fields)
- `apps/api/**`, `prisma/**`

## Acceptance Criteria
1. End-to-end flow for a teacher submitting evidence with **minimal required fields** (task-board SEIP-UI-001 acceptance criterion, validated here at design level).
2. Every screen state is inventoried: empty, loading, success, validation error, upload failure, permission-denied, offline/retry.
3. Each field the UI needs is traced to a field in contracts v0.1. Gaps become Contract Change Requests — the deliverable explicitly lists which contract fields the flow depends on.
4. Responsive intent documented for mobile (SEIP-UI-001 criterion): what reflows, what the mobile upload path is.
5. Accessibility notes at design level: focus order, labels, error announcement, target sizes, contrast intent (accessibility checks are a stated SEIP-UI-001 criterion — set them up here).
6. File-upload UX addresses the recorded risks: large video uploads, and evidence containing personal data (what the user is told about handling/consent).

## Required Tests
- None (design task). Interaction and component tests are written in SEIP-UI-001 against these flows.

## Verification Commands
```bash
ls docs/architecture/ux/                              # flow + wireframes + state inventory present
# If flow authored as mermaid:
npx @mermaid-js/mermaid-cli -i docs/architecture/ux/evidence-flow.mmd -o /tmp/flow.svg   # exit 0
```

## Expected Handoff
`.ai-team/handoffs/SEIP-UI-000.md`: the flow, the state inventory, the field-to-contract trace table, any Contract Change Requests raised, and the accessibility/responsive intents. Recommended next task: feed into SEIP-QA-002, then SEIP-UI-001 in Sprint 1.
