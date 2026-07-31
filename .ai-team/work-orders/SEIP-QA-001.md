# Work Order: SEIP-QA-001

## Objective
Turn the checklists in `docs/qa/QUALITY-GATES.md` into an **operational, runnable gate system**: every gate gets a concrete command, a pass/fail definition, and a mapping to a CI job; plus a security baseline and a finding-severity model. This makes the SEIP-OPS-001 CI skeleton executable rather than a list of stubs. **No production code and no tests against features that do not exist** — this task defines *how quality is judged*, not feature tests.

## Owner
grok

## Reviewer
claude

## Dependencies
- SEIP-OPS-001 (CI skeleton with job stubs to fill in)
- OPEN-1 **closed 2026-07-16: GitHub.** Gates are enforced as required status checks on GitHub PRs; define commands as GitHub Actions job steps.

## Allowed Paths
- `docs/qa/**`
- `docs/reviews/**`
- `tests/security/**` (baseline scaffolding: config for secret scan, dependency audit, SAST — not feature tests)
- `scripts/security/**`
- `.ai-team/handoffs/SEIP-QA-001.md`

## Blocked Paths
- `apps/**`, `packages/**`, `prisma/**` (read-only)
- `docs/contracts/**` (read-only; validate, request changes via CCR)
- `.github/workflows/**` (owned by claude/SEIP-OPS-001; Grok specifies the command, Claude wires the job — coordinate, do not edit)

## Acceptance Criteria
1. Every PR gate in QUALITY-GATES.md (format, lint, type check, unit, integration, build, migration validation, secret scan, dependency audit, permission tests, contract compatibility, code-owner review) has: a runnable command, a pass/fail threshold, and the name of the CI job that runs it.
2. Every Release gate (e2e, security, backup/restore, report accuracy, accessibility, performance, UAT) has an owner and a defined trigger point.
3. A **security baseline** covering the GROK.md review scope: authn/authz, tenant/school data isolation, file-upload security, OWASP Top 10, privacy/auditability. Stated as checkable requirements.
4. A **finding-severity model** (per GROK.md finding format): severity levels, definitions, SLA/response expectation, and how a finding maps to a task on the board.
5. Gate enforcement documented as GitHub required status checks on `develop`/`main` PRs.
6. Handoff to SEIP-OPS-001 lists the exact commands so the CI job stubs can be replaced with real steps.

## Required Tests
- The security-baseline tooling (secret scan, dependency audit) runs green on the current skeleton repo to prove the commands work — not feature tests, tooling smoke only.

## Verification Commands
```bash
ls docs/qa/ docs/reviews/                             # gate defs + severity model present
# Baseline tooling actually runs:
npm run gate:secret-scan                              # exit 0 (command defined by this task)
npm run gate:dep-audit                                # exit 0
```

## Expected Handoff
`.ai-team/handoffs/SEIP-QA-001.md`: gate-to-command-to-CI-job table, the security baseline, the severity model, the enforcement mechanism, and the command list handed to SEIP-OPS-001. Recommended next task: SEIP-QA-002 (adversarial review of the DB-000 + UI-000 designs).
