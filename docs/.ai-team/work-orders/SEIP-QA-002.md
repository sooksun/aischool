# Work Order: SEIP-QA-002

## Objective
Independent, adversarial review of the Sprint 0 design outputs — contracts v0.1 (SEIP-ARCH-001), the data model (SEIP-DB-000), and the evidence UX flow (SEIP-UI-000) — before any of it is locked. This is the Grok half of the contract approval loop in `contract-policy.md` step 4 ("Grok validates errors, permissions, and edge cases"). Output is a **verdict**: APPROVE or CHANGES_REQUESTED, with findings. Read-only for production paths per GROK.md.

## Owner
grok

## Reviewer
claude

## Dependencies
- SEIP-ARCH-001 (contracts v0.1)
- SEIP-DB-000 (data model + feasibility findings)
- SEIP-UI-000 (UX flow + field-trace findings)
- SEIP-QA-001 (severity model to classify findings against)

## Allowed Paths
- `docs/reviews/**` (the review + verdict)
- `.ai-team/handoffs/SEIP-QA-002.md`

## Blocked Paths
- Everything else is read-only. Grok does not modify production code, contracts, or designs (charter rule 8). Fixes are raised as findings/CCRs for the owning agent.

## Acceptance Criteria
1. Coverage of the full GROK.md review scope against the designs: authn/authz model, tenant/school data isolation, evidence-to-indicator mapping correctness, file-upload security, privacy/auditability, business rules (two cycles/year), negative and edge cases.
2. Each finding uses the GROK.md format (ID, severity, module, repro/scenario, expected, actual/risk, suggested fix, responsible AI) and the SEIP-QA-001 severity model.
3. Explicit check that contracts v0.1 + data model + UX flow are **mutually consistent** — no field the UI needs is missing from the contract; no contract field is unbacked by the data model.
4. Cross-check against the PROJECT_STATE.md known risks (criteria change by year, human-reviewable AI mapping, personal data in evidence, video storage growth) — each risk either addressed or flagged as carried.
5. A single clear verdict: **APPROVE** (Sprint 0 may proceed to SEIP-ARCH-002 lock) or **CHANGES_REQUESTED** (with the blocking findings enumerated).

## Required Tests
- None executed. This is a review; findings may recommend tests to be written in Sprint 1.

## Verification Commands
```bash
ls docs/reviews/SEIP-QA-002*.md                       # review + verdict present
grep -E "Verdict:\s*(APPROVE|CHANGES_REQUESTED)" docs/reviews/SEIP-QA-002*.md   # verdict is explicit
```

## Expected Handoff
`.ai-team/handoffs/SEIP-QA-002.md`: the verdict, the findings list by severity, the consistency-check result, and the risk cross-check. If APPROVE → SEIP-ARCH-002 locks contracts v1.0. If CHANGES_REQUESTED → findings route back to the owning agent before the gate reopens.
