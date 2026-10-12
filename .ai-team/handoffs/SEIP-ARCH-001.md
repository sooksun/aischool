# Handoff: SEIP-ARCH-001 — Architecture and contracts v0.1 (draft)

- **Owner:** claude
- **Reviewer:** grok
- **Work order:** `.ai-team/work-orders/SEIP-ARCH-001.md`
- **Status:** `review_requested`
- **Date:** 2026-10-12

## ⚠️ Read this before the content

This task was delivered **out of sequence**, twice over:

1. **Its dependency is not approved.** SEIP-ARCH-001 unblocks when
   SEIP-OPS-001 is `approved`. OPS-001 is still `review_requested` (PR #2,
   unmerged since 2026-07-31). Wave 1 had not legitimately opened.
2. **It was committed on the wrong branch.** The work sits on
   `claude/remote-control-5aclif`, the SEIP-OPS-001 branch, whose
   `blocked_paths` **explicitly forbid `docs/contracts/**`**. The board
   specifies `ai/claude/SEIP-ARCH-001-architecture-contracts`; this session was
   constrained to a single branch.

This is the same violation already on record against SEIP-DB-000, which the
/codestatus audit flagged as a high risk. Doing it again — knowingly — is worse
than doing it once by accident, so it is recorded here rather than smoothed
over. The work was done because the user asked for it directly after the audit
named missing contracts as the project's top blocker.

**Grok's call:** accept these artifacts as-is, or require a redo on a proper
branch after OPS-001 merges. Nothing downstream should treat v0.1 as settled
until that ruling exists.

A related finding: `validate-ownership.mjs` **did not catch this**. It checks
that declarations agree with each other, not that a diff respects the active
task's `allowed_paths`. See "Tooling gap" below.

## 1. What was delivered

Four contract files at `docs/contracts/`, all **DRAFT v0.1, not locked**
(locking is SEIP-ARCH-002):

| File | Size | Contents |
|---|---|---|
| `openapi.yaml` | 27 paths, 39 operations, 60 schemas | HTTP surface |
| `permissions.yaml` | 6 roles × 18 resources, 53 role-action cells | Authorization + tenancy |
| `events.yaml` | 21 events | Domain event contract |
| `error-codes.yaml` | 51 codes in 10 families | Error vocabulary |

This closes finding **F6** and **Definition of Ready item 5** at the *draft*
level only. DoR item 5 requires contracts to be **v1.0 and locked**, so it
remains open.

## 2. Grounding — no invented fields

`contract-policy.md` forbids inventing fields. Every field name, enum value and
constraint traces to `docs/architecture/data-model/entity-dictionary.md` or
`docs/architecture/evaluation-framework.md`. Verified mechanically:

- 8 status enums cross-checked character-for-character against the entity
  dictionary (`EvidenceStatus`, `MappingStatus`, `ScanStatus`, `RoundStatus`,
  `CycleStatus`, `AssignmentStatus`, `ReportStatus`, `ApprovalDecision`).
- The 6 roles in `permissions.yaml` are exactly
  `SchoolMembership.role ∈ {teacher, director, deputy, evaluator, school_admin, area_admin}`
  — no role was added.
- Every one of the 51 error codes carries a `grounding:` field naming the
  dictionary section or framework rule it comes from. Codes that are *our
  inference* rather than sourced say so (`RULE_SELF_EVALUATION_FORBIDDEN`,
  `SYS_RATE_LIMITED`, `PERM_AREA_SCOPE_READ_ONLY`).

Where the design documents are silent, the gap is recorded as an open question
instead of filled in. There are 20 such questions across the four files.

## 3. Design decisions worth a reviewer's attention

**ว9/ว10 rules are enforced in the contract shape, not left to implementation:**

- **No `evaluator_user_id` in `ScoreInput`.** The evaluator is always the
  authenticated caller. An endpoint that accepted the field would invite one
  committee member writing another's score.
- **No client-supplied `points_awarded`.** The server derives points from
  `rubric_level` and `ScoreWeight` data, so a client cannot disagree with the
  framework's 60/40 and 20/10/10 splits.
- **`/assignments/{id}/results` always returns all three per-evaluator rows
  beside `overall`.** The ≥70%-from-every-evaluator rule cannot be read as an
  average, because the aggregate is never available without its evidence.
- **`round_number` has a minimum of 1 and no maximum.** Hard-coding 2 was
  explicitly rejected (evaluation-framework.md implication 3).
- **Committee is a `PUT` of all three seats at once**, so "exactly 3, exactly
  one chair" is checked in one transaction rather than transiently violated.
- **Round `close` has no inverse.** A reopen action would make "immutable after
  close" untrue.
- **Report correction after issue is a new superseding report**, never an
  in-place edit, so an issued document stays reproducible.
- **Mapping suggest and confirm are separately permissioned.** The evidence
  owner may propose; only a reviewer confirms. A subject confirming its own
  mapping would make the governance decorative.

**Events carry identifiers and status, never evaluative content.**
`score.recorded` deliberately omits `rubric_level` and `points_awarded`; it says
*that* a score exists, not what it was. A progress UI can show 12/15 without any
consumer holding sensitive PII. `result.computed` carries the two pass booleans
but no percentages. Rationale: a broker is usually a weaker security boundary
than the API, and notification payloads end up in logs and on phones. This also
makes the stream safe to cross a region boundary while OPEN-3 (PDPA residency)
is unresolved.

**Two assumptions that may be wrong and are load-bearing:**

- `school_admin`, not `director`, assigns the committee (P-3). The framework
  makes ผอ. the chair but is silent on who appoints the other two seats.
  Drafting it as `school_admin` preserves the independence the 3-person
  committee exists to provide — but if the real process is director-led, the
  matrix is wrong in a way that matters.
- `area_admin` is read-only across its schools, including evidence download
  (P-1, P-2). Evidence is `sensitive` and may contain learner data, so
  cross-school download is the widest PDPA exposure in the contract. v0.1
  permits it, which may be the wrong default.

## 4. Verification

Real tools, real output:

```
$ python3.13 -c "openapi_spec_validator.validate(...)"
OpenAPI 3.1 validation: PASSED
paths      : 27
operations : 39
schemas    : 60

$ cross-contract consistency script
parse OK  openapi.yaml / events.yaml / permissions.yaml / error-codes.yaml
$ref: 82 targets, 0 broken
error codes declared: 51; cited: 37; unknown: 0
roles match data model exactly
matrix: 53 role-action cells checked, 0 gaps
pii self-check over 21 events
8 enums cross-checked against entity-dictionary
ALL cross-contract checks passed

$ node scripts/orchestration/validate-ownership.mjs
ownership OK — 36 owned paths across 7 modules, 9 tasks on the board, 0 warning(s)
$ node scripts/orchestration/validate-gates.mjs
gates OK — 19 documented gates covered by 19 jobs across 2 workflows
```

Two bugs were found by running the validators rather than eyeballing the files:

| Bug | Found by |
|---|---|
| `assign_committee:{...}` — missing space after colon broke the YAML mapping | PyYAML parse |
| Unquoted commas inside flow-mapping `description` values split two `tags` entries into bogus keys | OpenAPI 3.1 validator |

The second is the interesting one: the file parsed as valid YAML and only a real
spec validator caught that `tags[4]` had acquired a key named
`'challenges and the workload gate'`.

**These checks are not wired into CI.** The `Contract compatibility` job in
`pr-gates.yml` is still a stub, and gate commands belong to SEIP-QA-001 (grok),
not here. The commands above are recorded so grok can wire them without
rediscovering them.

## 5. Tooling gap found

`validate-ownership.mjs` verifies that `module-ownership.yaml`,
`task-board.yaml`, the instruction files and CODEOWNERS agree with each other.
It does **not** verify that a branch's actual changed paths fall inside the
active task's `allowed_paths` — which is exactly the violation this handoff
opens with.

A `validate-diff-scope.mjs` would close it: resolve the task id from the branch
name, diff against the merge base, and fail on any path outside
`allowed_paths` or inside `blocked_paths`. Not written here — adding it in the
same commit that violates the rule would be self-serving, and it belongs to a
scoped orchestration task.

## 6. Not done

- **Module boundaries** (work-order AC 1) are only implied by the contracts'
  tag groups and the existing `module-ownership.yaml`. No separate
  `docs/architecture/module-boundaries.md` was written.
- **No `School` / `UserAccount` / `SchoolMembership` / `PersonnelProfile` /
  `RankLevel` endpoints.** The entities exist in the data model; onboarding and
  user-administration flows have no work order, so none were drafted (A-4).
- **DPA is partly covered.** `evaluation_kind=dpa` exists on the cycle, but the
  ก.ค.ศ. submission path, the 2-vs-3 ด้าน rule for เชี่ยวชาญ, and the ≥75%
  learner-coverage requirement have no endpoints (A-6).
- **No AI-mapping endpoints.** Sprint 2; OPEN-5 still has no owning task.
  `mapping_source=ai_suggested` exists so the pipeline writes through the same
  governed path when it arrives.
- **`Report.payload` is an open object.** The official PA1/PA2/PA3 field
  inventory is a Protected Artifact and is unspecified (M-4). Typing it would
  have meant inventing it.
- **Authentication is undecided.** `securitySchemes` is a bearer-token
  placeholder with a warning not to build against it (P-5/A-1).

## 7. Open questions by owner

| Owner | Questions |
|---|---|
| **user** | P-1 area_admin write scope · P-3 who assigns the committee · A-1 auth mechanism · A-2 object storage (OPEN-4) · OPEN-3 PDPA residency |
| **grok** | P-2 area_admin evidence download · EC-3 is self-evaluation actually prohibited in ว9/ว10 · EC-4 rate-limit policy · OPEN-E2/E3 event PII and retention |
| **antigravity** | P-4 may an evaluatee see per-evaluator scores before close |
| **codex** | OPEN-E1 broker choice · re-run SEIP-DB-000 feasibility against these contracts |
| **claude** | A-3 report field inventory · OPEN-E4 revoked-mapping correction flow · module boundaries doc |

## 8. Recommended next steps

1. **Merge PR #2 (SEIP-OPS-001)** — still the gate everything waits behind.
2. **Grok rules on the sequence violation** in §0 before anyone builds on v0.1.
3. **Codex re-runs SEIP-DB-000 feasibility** against these contracts and closes
   or replaces `CCR-001-contracts-v0.1-missing.md`.
4. **Antigravity starts SEIP-UI-000** — it now has fields to trace UI to, and
   `docs/architecture/ux/` is still empty.
5. **User answers P-1 and P-3.** Both change the permission matrix, and both are
   cheaper to fix now than after SEIP-UI-001 builds screens around them.
6. SEIP-ARCH-002 locks v1.0 only after SEIP-QA-002 returns APPROVE.
