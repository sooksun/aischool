# Contract drafts — NOT IN FORCE

Files here are proposals under review. No gate, codegen step or route reads them;
the binding contracts are the four files one directory up.

| Draft | CCR | Status |
|---|---|---|
| ~~`openapi-4.0.0.yaml`~~ | [CCR-017](../../reviews/CCR-017-contract-4.0.0.md) | APPLIED — now `../openapi.yaml` 4.0.0 (SEIP-P1-001) |
| `internal-ai-0.1.0.yaml` | CCR-017 | PROPOSED — private GPU-node contract (ADR-0010), never in client bundles |

When a CCR is approved the draft replaces the live file in the same change that
bumps `info.version`, so the contract-compatibility gate sees the major bump.
