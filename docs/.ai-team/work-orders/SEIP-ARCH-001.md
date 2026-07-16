# Work Order: SEIP-ARCH-001

## Objective
Draft the architecture boundaries and the four protected contracts at **v0.1 (DRAFT)** so Wave 2 (Codex, Antigravity) has something concrete to validate against. Contracts are deliberately drafts — they are locked only in SEIP-ARCH-002 after the full approval loop (Codex feasibility → Antigravity usability → Grok adversarial review). Do not gold-plate: v0.1 covers the evidence workflow and PA evaluation core, and explicitly defers the AI-mapping contract to Sprint 2.

## Owner
claude

## Reviewer
grok

## Dependencies
- SEIP-OPS-001 (repo bootstrapped; operating-system paths resolve)
- ADR-0001 (Node/TS), ADR-0002 (canonical paths), ADR-0003 (วPA framework)
- `docs/architecture/evaluation-framework.md` (indicator taxonomy)

## Allowed Paths
- `docs/architecture/**`
- `docs/contracts/**`
- `docs/decisions/**`

## Blocked Paths
- `apps/**`, `packages/**`, `prisma/**` (no implementation)
- `.github/workflows/**` (already owned by SEIP-OPS-001 output)

## Acceptance Criteria
1. **Module boundary map**: modules, their responsibilities, and which agent owns each — consistent with `module-ownership.yaml`; every inter-module interaction goes through a named contract.
2. **`docs/contracts/openapi.yaml` v0.1**: evidence upload/list/detail, PA cycle + round configuration, indicator taxonomy read (framework/ด้าน/ตัวชี้วัด per ADR-0003), evidence↔indicator mapping CRUD (human-confirmed), committee scoring endpoints (per-evaluator records, ≥70% rule as a documented business rule).
3. **`docs/contracts/permissions.yaml` v0.1**: roles Teacher / Director-Deputy / Evaluator / School Admin / Area Admin (from `system-context.md`), school-scoped tenancy rule stated explicitly (a user sees only their school's data unless area-scoped), per-endpoint role matrix.
4. **`docs/contracts/error-codes.yaml` v0.1**: error namespace, shape (code/message/details), and the initial set covering auth, validation, upload constraints (file type/size/duration per evaluation-framework.md §6), and permission denials.
5. **`docs/contracts/events.yaml` v0.1**: domain events for the evidence lifecycle (uploaded, mapped, mapping-confirmed, scored, round-closed) with payload schemas.
6. Every contract file carries `version: 0.1.0-draft` and a header stating it is unlocked until SEIP-ARCH-002.
7. AI-mapping endpoints/events are **explicitly marked deferred** (placeholder section naming Sprint 2), per SPRINT-0.md risk mitigation.
8. OpenAPI lints clean and type generation runs (proves the codegen path Antigravity depends on).

## Required Tests
- Contract lint + codegen smoke only (no feature tests exist yet).

## Verification Commands
```bash
npx @redocly/cli lint docs/contracts/openapi.yaml          # exit 0
npx openapi-typescript docs/contracts/openapi.yaml -o /tmp/api-types.d.ts   # exit 0
node -e "require('js-yaml').load(require('fs').readFileSync('docs/contracts/permissions.yaml','utf8'))"  # parses
node -e "require('js-yaml').load(require('fs').readFileSync('docs/contracts/events.yaml','utf8'))"       # parses
node -e "require('js-yaml').load(require('fs').readFileSync('docs/contracts/error-codes.yaml','utf8'))"  # parses
```

## Expected Handoff
`.ai-team/handoffs/SEIP-ARCH-001.md`: the boundary map, contract file list with versions, decisions taken inside the contracts (tenancy rule, error shape, event naming), what was deliberately deferred, and open questions routed to SEIP-DB-000 / SEIP-UI-000. Recommended next tasks: SEIP-DB-000 (codex) + SEIP-UI-000 (antigravity) in parallel.
