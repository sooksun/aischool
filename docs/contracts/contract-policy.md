# Contract-First Development Policy

Updated 2026-07-17 (SEIP-ARCH-002) — approval flow rewritten for single-agent mode (ADR-0004).

## Protected Contracts (all LOCKED at v1.0.0 since 2026-07-17)

| File | Version | Surface |
|---|---|---|
| `openapi.yaml` | 1.0.0 | HTTP API — the only web↔api interface |
| `events.yaml` | 1.0.0 | Domain events (outbox-delivered) |
| `permissions.yaml` | 1.0.0 | Roles, tenancy rule, per-operation matrix |
| `error-codes.yaml` | 1.0.0 | Stable error codes + response shape |

Report data contracts remain **deferred to v0.2** (needs the official PA1/PA2/PA3 field inventory).

## Rule

No implementation may invent fields outside an approved contract. Types are generated from `openapi.yaml`, never hand-written (ADR-0001).

## Versioning

- **Additive** (new endpoint, new optional field, new error code, new event) → minor bump `1.x`, no CCR ceremony required, but the change is called out in the task's close-out.
- **Breaking** (remove/retype a field, change an error code's meaning, rename an event, tighten a required constraint) → **CCR required** + major bump `2.0` + migration plan for affected modules.
- The CI gate `Gate: contract compatibility` runs `oasdiff breaking --fail-on ERR` on every PR: a breaking change fails the build unless the version bump and CCR land in the same PR.

## Change flow (single-agent, ADR-0004)

1. Claude drafts the change and records the reason in a CCR under `docs/reviews/CCR-NNN-*.md`.
2. Claude self-reviews against: backend feasibility (data model), frontend usability (UX field trace), security baseline §2/§3, and error/permission consistency — the four checks the old multi-agent loop distributed across Codex/Antigravity/Grok.
3. **User approves** any breaking change before it merges. Additive changes proceed and are reported.
4. Version bumped, generated types refreshed by the gate, CCR marked APPLIED with the date.

## History

| CCR | Change | Status |
|---|---|---|
| CCR-001 | Publish contracts v0.1 (they did not exist) | RESOLVED 2026-07-17 |
| CCR-002 | `CurrentUser.personnel` object; evidence draft→active lifecycle; `duration_seconds` nullable | APPLIED 2026-07-17 (pre-lock) |
