# CCR-016: every generated report is terminal at `pending_approval`

Status: **DRAFT — awaiting user approval**
Blocker: `SEIP-BLOCK-003` (the last one) · Depends on: CCR-015 · Blocks: nothing

## Request

`prisma.approval` has **zero references** in `apps/` and `packages/`. The worker
flips a report `draft → pending_approval` once its payload is ready
([reports.ts:241](../../packages/database/src/repositories/reports.ts)) with the
comment *"approval workflow is later"*, and nothing moves it again.

So of the five states `ReportStatus` declares, three are unreachable:

| status | reachable | by what |
|---|---|---|
| `draft` | ✅ | `createReport` |
| `pending_approval` | ✅ | worker, on successful generation |
| `approved` | ❌ | nothing |
| `issued` | ❌ | nothing |
| `superseded` | ❌ | nothing |

`ApprovalDecision` (`pending`/`approved`/`rejected`/`returned`) is likewise
declared and unused, and `report.approved` sits in `events.yaml`'s `deferred:`
block with the note *"approval workflow UI not yet shipped"*.

The practical effect: SEIP can evaluate a teacher end to end and produce the
document, but nobody can ever sign it. A PA result that no one has endorsed is not
a PA result — it is a draft with a score in it.

## The integrity problem this has to solve, not just the missing endpoint

Nothing checks round state when a report is created or generated
(`createReportDraft` takes `roundId` and stores it; no status check anywhere).
Scores only freeze when a round closes (SCORE-002).

So today a report can be generated from **still-mutable scores**. Add a naive
approve endpoint and you get the worst available outcome: an *approved* document
whose underlying scores can legally change afterwards, with the approval
timestamped before the change. The document would then contradict the data behind
it, silently, and the audit trail would show a signature that no longer describes
anything.

**Recommendation: approval requires the report's round to be `closed`** (RPT-003).
Cycle-level reports with `round_id = null` skip the check — there is no round to
freeze. This is the one rule in this CCR that is not obvious from the schema, and
it is the reason the CCR is not simply "add three endpoints".

## Decision 1 — one approval step, not a chain

`Approval.stepCode` implies a multi-step chain (committee chair → director →
area?). Nothing in ว9/ว10 as implemented needs one: the 3-person committee already
scored, and the ผอ. is the chair. A configurable approval chain would be a
workflow engine built for a workflow that has one step.

**Recommendation: a single step, with `stepCode` written as the constant
`'director'`.** The column stays meaningful and truthful, the `Approval` table
already supports many rows per report, and adding a second step later is additive
— a new `stepCode` value and a rule about ordering, no migration.

## Decision 2 — implement `approved` and `returned`; do NOT implement `rejected`

- **`approved`** → `Report.status = approved`. The endorsement.
- **`returned`** → `Report.status = draft`, so the report can be regenerated after
  whatever was wrong is fixed. This is ส่งกลับให้แก้ไข and it is a real thing a
  director does.
- **`rejected`** → **not implemented, deliberately.**

`rejected` has no coherent downstream meaning here. A report is a *rendering of
scores that already exist*; rejecting it without changing those scores would
produce a document formally marked "not approved" while the data it renders stands
unchanged and every other view of that data continues to show the same result.
That is a contradiction, not a workflow state.

If the intent is "the committee's result is wrong", the fix is to reopen the round
and rescore — a different operation with different authority, out of scope here.
Leaving the enum value unused and saying so beats inventing semantics for it. The
same reasoning CCR-012 used when it deleted a scan verdict rather than keep a
value nothing had earned.

## Decision 3 — the PDF must say whether it has been approved

`getReportPdf` already serves `pending_approval` reports as a draft/review copy,
and the PDF already carries a Thai disclaimer that it is not the official ก.ค.ศ.
plate (CCR-007 / cleanup L1). Approval adds a second thing a reader can get wrong:
a printed, plausible-looking PA report that nobody has signed.

**Recommendation: stamp the approval state on the PDF** — approved (with approver
and date) or "ยังไม่ผ่านการอนุมัติ". Download stays available at
`pending_approval`: gating it would break the review workflow the draft copy exists
for, and hiding the document is a worse answer than labelling it.

## Changes

| Surface | Change |
|---|---|
| `openapi.yaml` | **3.0.0 → 3.1.0** additive: 3 operations, `ReportDetail.approvals`, `Approval` schema |
| `permissions.yaml` | 1.6.0 → 1.7.0 — 3 matrix rows |
| `error-codes.yaml` | 1.5.0 → 1.6.0 — `RPT-003` |
| `events.yaml` | 1.1.0 → 1.2.0 — `report.approved` moves **out of `deferred:`** and gains a producer |
| `prisma/schema.prisma` | none — `Approval` is already adequate |
| migration | none |
| `packages/database` | `repositories/approvals.ts`; `AUDIT_ALLOWLIST` gains `Approval` |
| `apps/api` | `routes/reports.ts` — approve / return / list; `lib/pa-report-pdf.ts` — approval stamp |
| `apps/web` | approve + return actions on the report detail page; approval state and trail shown |

### New operations

| operationId | Route | Grant | Notes |
|---|---|---|---|
| `approveReport` | `POST /reports/{reportId}/approve` | `director: school`, `school_admin: school` | `pending_approval` → `approved`. Requires the round closed (RPT-003) |
| `returnReport` | `POST /reports/{reportId}/return` | `director: school`, `school_admin: school` | `pending_approval` → `draft`. Comment required — "fix it" with no reason is not a review |
| `listReportApprovals` | `GET /reports/{reportId}/approvals` | same as `getReport` | The decision trail. The subject can see who signed their own report and when |

`listReportApprovals` deliberately matches `getReport`'s grants rather than the
narrower write grants: a teacher being able to read their own score but not who
approved it would be a strange kind of transparency.

## Breaking? — **No. Additive, minor bump.**

Three new operations, one new response property, one new error code, one event
moved out of `deferred:`. Nothing removed, nothing retyped. `Report.status` gains
no new values — `approved` was already in the enum and already in the generated
types; this change only makes it reachable.

Worth stating because it is counterintuitive: a client switching exhaustively on
`ReportStatus` already had to handle `approved`, so no client breaks.

## Security review (contract-policy step 2)

- **Self-approval is forbidden.** A director is an evaluatee under ว10, so
  `director: school` alone would let them approve their own PA report. Same rule
  and same reasoning as CCR-015's `acknowledgeAgreement`, enforced in the route
  because the matrix cannot express "any grant except over yourself" (RPT-003).
- **The state machine is a compare-and-swap**, not read-then-write. Two directors
  clicking approve must not both write an `Approval` row against one transition;
  the loser sees RPT-003. Same shape as `transitionAgreement`.
- **`Approval` rows are append-only in spirit** — there is no update or delete
  operation, and the trail is what makes the signature meaningful.
- **`AUDIT_ALLOWLIST` needs an `Approval` entry** or the audit write silently logs
  nothing (it fails closed on unknown entity types). `comment` must be excluded:
  it is free text about a named person's performance, the same PDPA reasoning that
  keeps evidence titles and challenge text out of the audit log.
- **`area_admin` read-only** on the trail, absent from both writes (SEC-TEN-3).
- **Evaluators do not approve.** They score; the chair endorses. No matrix row
  grants `evaluator` either write.

## Explicitly deferred

- **`issued` and `superseded`.** `issued` means an official copy was released,
  which is only meaningful once the official ก.ค.ศ. plate exists (a Protected
  Artifact, deferred since Sprint 0). `superseded` needs a regeneration-versioning
  decision. Both stay unreachable, and after this CCR the project should stop
  describing `ReportStatus` as fully implemented.
- **Multi-step approval chains** (Decision 1).
- **`rejected`** (Decision 2) — the enum value stays unused on purpose.
- **Notification on approval.** `report.approved` will be emitted to the outbox,
  but `outbox.dispatch` is still an acknowledged no-op, so nobody is told. That is
  a separate, known gap (audit finding: 5 of 13 active events have a producer, and
  nothing consumes any of them).

## Verification plan

```
# through the HTTP API alone:
#   score -> close round -> generate report -> approve
#   and: approve before the round closes -> RPT-003
```

- Integration tests: the happy path; approval blocked while the round is open;
  self-approval refused; return sends it to `draft` and it can be regenerated and
  approved after; double-approve loses the CAS with RPT-003; comment required on
  return; the trail lists decisions in order.
- e2e: a director approves in the UI and the subject sees the approved state.
- PDF: assert the approved stamp appears, and that an unapproved report's PDF says
  so.
- Permission sweep extended to all 3 operations (floor rises from 40).
- After this lands, `PROJECT_STATE.md` loses its "not releasable" banner — this is
  the last of the three blockers the 2026-07-19 audit opened.

## Related

- `SEIP-BLOCK-003` · CCR-014 (onboarding) · CCR-015 (agreements)
- CCR-007 / cleanup L1 — the PDF is a draft/review layout, not the official plate
- `docs/architecture/evaluation-framework.md` §8 — PA3 (สรุปผล) is a Protected Artifact
- Audit finding: "`Approval` is schema-only; reports reach `pending_approval` and stall permanently"
