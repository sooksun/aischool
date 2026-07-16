# Finding Severity Model — SEIP (SEIP-QA-001)

Status: v1 (2026-07-17) · Applies to every QA/security/review finding regardless of who files it (AI self-review, tooling, user).

## Levels

| Severity | Definition (SEIP-specific) | Examples | Response SLA | Merge impact |
|---|---|---|---|---|
| **S1 Critical** | Cross-school data exposure, auth bypass, learner-PII leak, score/audit tampering, RCE, leaked secret | Teacher A reads school B's evidence; evidence URL works without token; AuditEvent updatable; committed credential | Fix before anything else; hotfix same day; if leaked secret → rotate immediately | **Blocks merge and release**; if already merged → revert or hotfix now |
| **S2 High** | Privilege escalation within a school, integrity break in evaluation logic, missing tenancy test on a new endpoint | Teacher confirms own mappings without authority; ≥70%-each rule computed as average; round close doesn't freeze scores | Fix within 72h; task at top of board | Blocks merge of the introducing PR |
| **S3 Medium** | Weakness with mitigating layer, non-PII info disclosure, missing rate limit, a11y blocker on core flow | Verbose error internals; no login throttle (pre-launch); upload progress unusable by screen reader | Scheduled inside current sprint | Merge allowed with a board task + noted in close-out |
| **S4 Low** | Hardening gap, minor a11y/UX-safety, style-level security smell | Missing security header on non-sensitive route; contrast 4.3:1 on secondary text | Backlog, batched | Merge allowed |
| **S5 Info** | Observation, no action required now | Design note for Sprint 2 review | Recorded only | — |

**Severity picks the HIGHER of impact vs likelihood-adjusted class when in doubt.** Personal-data involvement bumps any finding one level up (PDPA weight).

## Finding format (retained from GROK.md)

```
Finding ID:    QA-<seq>            (QA-001, QA-002, …)
Severity:      S1..S5
Affected:      module / file / endpoint
Steps to reproduce
Expected result
Actual result
Suggested fix
Filed by:      claude-selfreview | gate:<name> | user
```

## Board mapping

- S1/S2 → new board task immediately, `status: ready`, titled `FIX <Finding ID>`, linked in the finding; current task cannot close while an S1/S2 it caused stays open.
- S3 → task in current sprint backlog.
- S4/S5 → line item in `docs/reviews/BACKLOG-hardening.md` (created on first S4).
- Every finding file lives in `docs/reviews/` and is referenced from the close-out of the task that resolved it.

## Sources of findings

1. **Gates** (automatic): a red LIVE gate is at least S2 until triaged.
2. **Self-review** (per close-out): checklist against SECURITY-BASELINE relevant sections.
3. **User review**: anything the user flags gets triaged into this model within one working session.
