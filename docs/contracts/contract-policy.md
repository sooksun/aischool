# Contract-First Development Policy

## Protected Contracts
- `openapi.yaml`
- `events.yaml`
- `permissions.yaml`
- `error-codes.yaml`
- Report data contracts

## Approval Flow
1. Claude drafts or changes a contract.
2. Codex validates backend feasibility.
3. Antigravity validates frontend usability.
4. Grok validates errors, permissions, and edge cases.
5. Claude approves and locks the version.
6. Generated types are refreshed.

No implementation may invent fields outside an approved contract.
