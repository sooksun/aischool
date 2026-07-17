# Contract-First Development Policy

Updated 2026-07-17 (SEIP-ARCH-002) — approval flow rewritten for single-agent mode (ADR-0004).

## Protected Contracts

| File | Version | Surface |
|---|---|---|
| `openapi.yaml` | **2.1.0** (CCR-005 additive reports + AI suggest; CCR-004 was 2.0.0 breaking) | HTTP API — the only web↔api interface |
| `events.yaml` | 1.1.0 | Domain events (outbox-delivered) |
| `permissions.yaml` | 1.1.0 | Roles, tenancy rule, per-operation matrix |
| `error-codes.yaml` | 1.1.0 | Stable error codes + response shape |

Reports ship as **structured JSON payload + section refs** (CCR-005). Official PA PDF layout remains deferred (openapi `x-deferred.report-pdf-layout`).

## Rule

No implementation may invent fields outside an approved contract. Types are generated from `openapi.yaml`, never hand-written (ADR-0001).

## Versioning

- **Additive** (new endpoint, new optional field, new error code, new event) → minor bump `1.x`, no CCR ceremony required, but the change is called out in the task's close-out.
- **Breaking** (remove/retype a field, change an error code's meaning, rename an event, tighten a required constraint) → **CCR required** + major bump `2.0` + migration plan for affected modules.
- The CI gate `Gate: contract compatibility` runs `scripts/security/check-contract-compatibility.mjs` (`oasdiff breaking` under the hood) on every push and PR: a breaking change fails the build **unless** `info.version`'s major component was actually bumped in the same change — that's the automated form of "version bump and CCR land in the same PR". A breaking change with no major bump fails regardless of intent.

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
| CCR-003 | Current-school resolution for multi-membership users (`X-School-Id` header) — clarification, no schema change | APPLIED 2026-07-17 |
| CCR-004 | `FileUploadComplete` gains required `content_type`/`byte_size`/`original_filename` | **BREAKING**, v1.0.0→2.0.0, APPLIED 2026-07-17 — see CCR doc for the self-correction (first shipped as an uncommitted code comment claiming "additive", caught by actually running `oasdiff`, not by inspection |
