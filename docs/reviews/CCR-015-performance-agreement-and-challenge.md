# CCR-015: ประเด็นท้าทาย is scored blind, and no score can be submitted at all

Status: **DRAFT — awaiting user approval**
Blocker: `SEIP-BLOCK-002` · Depends on: CCR-014 (`listPersonnel`) · Blocks: `SEIP-BLOCK-003`

## Request

Two problems, one root cause: `PerformanceAgreement` and `AgreementChallenge`
have **zero references** in `apps/` and `packages/`. They are schema-only.

### Problem 1 — scoring is unreachable

`submitMyScores` refuses without a workload declaration
([scoring.ts:227](../../apps/api/src/routes/scoring.ts)), the declaration needs
`assignment.agreementId` ([scoring.ts:220-222](../../apps/api/src/routes/scoring.ts)),
and **no operation creates a `PerformanceAgreement`**. Every path ends in VAL-002
or SCORE-004. The committee-scoring feature, the round state machine, the rollup,
the 70% threshold, the PA report — all of it is downstream of a row nothing can
create.

The suites pass only because `apps/api/test/scoring-flow.test.mjs:114` and
`tests/e2e/global-setup.mjs` insert that row straight through Prisma.

### Problem 2 — the committee scores ส่วนที่ 2 blind

This is the part the 2026-07-19 audit stated imprecisely, and the correction
matters. The audit said ประเด็นท้าทาย "has no code". In fact **the 40% is
computed correctly today**: `submitMyScores` requires every `is_scored`
indicator, which includes the three seeded challenge rows, and weights them by
`maxPoints` before applying `part2_total`:

| indicator | | max |
|---|---|---|
| `T-C.1` | วิธีดำเนินการ | 20 |
| `T-C.2.1` | ผลลัพธ์เชิงปริมาณ | 10 |
| `T-C.2.2` | ผลลัพธ์เชิงคุณภาพ | 10 |

What is missing is the thing being rated. `AgreementChallenge` holds
`methodPlan`, `quantitativeTarget` and `qualitativeTarget` — a one-to-one match
for those three indicators — and nothing writes or reads it. So an evaluator
opens the scoring screen and rates "วิธีดำเนินการ" 1–4 **without being shown the
method the teacher committed to**, and rates "ผลลัพธ์เชิงปริมาณ" against a target
that exists nowhere in the system.

That is worse than a missing feature. It is a scoring surface that looks
complete, produces a number, and is 40% of a teacher's วPA result — with the
evidence for it structurally absent. Same shape as the filename "virus scanner"
CCR-012 deleted: a verdict with nothing behind it.

## Decision 1 — cardinality of `AgreementChallenge`

The schema is genuinely ambiguous here and the CCR has to resolve it.

`AgreementChallenge` carries all three text fields in **one row**
(`methodPlan` + `quantitativeTarget` + `qualitativeTarget`), but is keyed
`@@unique([agreementId, indicatorId])` — which reads as though there could be one
row per challenge indicator.

**Recommendation: one row per agreement**, anchored on the framework's
`T-C.1` / `A-C.1` (วิธีดำเนินการ) indicator.

- The PA1 form has exactly one ประเด็นท้าทาย per agreement. Three rows would
  model a form that does not exist.
- A single row already holds all three fields, which only makes sense if the row
  *is* the challenge statement.
- The unique constraint then does useful work: it enforces one challenge per
  agreement rather than merely de-duplicating indicators.
- Anchoring on `C.1` keeps `indicatorId` meaningful — it points at the indicator
  the free-text plan is primarily scored under — while `C.2.1` / `C.2.2` read the
  target fields from the same row.

The alternative (three rows, one field used per row) leaves two columns NULL in
every row and makes "the teacher's challenge" a join instead of a record.

## Decision 2 — `AgreementChallenge` has no title

The PA1 form names the challenge ("ประเด็นท้าทาย เรื่อง …"). The model has no
field for it, so the plan would be stored as a method with no subject.

**Recommendation: add `title` (required).** `agreement_challenge` currently has
**zero rows in every environment** (nothing can create one), so a NOT NULL column
needs no backfill and no default — this is the one moment where adding it is free.

Also proposed, both nullable: `targetGroup` (กลุ่มเป้าหมาย — which class/level)
and `periodNote`. Both appear on the form; neither is scored.

## Decision 3 — `agreement_id` should stop being a client input

`createAssignment` accepts `agreement_id` from the body
([scoring.ts:97](../../apps/api/src/routes/scoring.ts)) and passes it through
**completely unvalidated** — the audit flagged this as a MEDIUM finding. It is not
checked for existence, school, cycle, or evaluatee. Attaching person B's agreement
to person A's assignment makes A's ภาระงาน gate read and write B's declaration row
(`@@unique([agreementId, roundId])`).

The server does not need the client to tell it: `PerformanceAgreement` is
`@@unique([cycleId, personnelId])`, and an assignment already knows its cycle and
its evaluatee. **The correct value is derivable, therefore it should be derived.**

**Recommendation: remove `agreement_id` from `AssignmentCreate` entirely** and
look it up server-side. This is the same reasoning CCR-014 used for `school_id` on
`MemberInvite`: a field that cannot be supplied cannot be supplied wrongly.

**This makes CCR-015 a breaking change → openapi 3.0.0.** That is the honest
price. The alternative — keep accepting the field and validate it against the
derived value — leaves a body parameter whose only legal value is the one the
server already computed, which is API surface that exists solely to be rejected.

## Changes

| Surface | Change |
|---|---|
| `openapi.yaml` | **2.9.0 → 3.0.0** — 6 new operations; **breaking:** `AssignmentCreate.agreement_id` removed |
| `permissions.yaml` | 1.5.0 → 1.6.0 — 6 matrix rows |
| `error-codes.yaml` | 1.4.0 → 1.5.0 — `AGR-001`, `AGR-002` |
| `prisma/schema.prisma` | `AgreementChallenge.title` (required), `.targetGroup`, `.periodNote` (nullable) |
| migration | one additive migration; `agreement_challenge` has zero rows so NOT NULL is safe |
| `apps/api` | `routes/agreements.ts`; `createAssignment` derives `agreementId`; `getAssignment` exposes the challenge |
| `packages/database` | `repositories/agreements.ts` |
| `apps/web` | teacher agreement page (write ประเด็นท้าทาย); challenge shown on the scoring screen |
| `prisma/seed.mjs` | unchanged |

### New operations

| operationId | Route | Grant | Notes |
|---|---|---|---|
| `listAgreements` | `GET /agreements` | `teacher/deputy: own`, `director/school_admin: school`, `evaluator: committee`, `area_admin: area-r` | |
| `getAgreement` | `GET /agreements/{id}` | same | Includes the challenge |
| `createAgreement` | `POST /agreements` | `teacher/deputy/director: own`, `school_admin: school` | One per (cycle, personnel) → AGR-001 on duplicate |
| `updateAgreement` | `PATCH /agreements/{id}` | `own` + `school_admin: school` | Draft only; AGR-002 once submitted |
| `submitAgreement` | `POST /agreements/{id}/submit` | `own` | draft → submitted. Requires a challenge to exist |
| `acknowledgeAgreement` | `POST /agreements/{id}/acknowledge` | `director/school_admin: school` | submitted → acknowledged (ผอ. เห็นชอบ) |

The challenge is written through `createAgreement` / `updateAgreement` as a nested
object rather than its own endpoints — it has no independent lifecycle, and a
half-written agreement with an orphan challenge is not a state worth modelling.

### The governance fix

`AssignmentDetail` gains a read-only `challenge` block (title, method plan,
quantitative and qualitative targets), so the scoring screen can render the
teacher's actual commitments beside the three indicators that rate them. Without
this the rest of the CCR just unblocks blind scoring rather than fixing it.

## Breaking? — **Yes. Major bump to 3.0.0.**

One removal: `AssignmentCreate.agreement_id`. Per `contract-policy.md` that is
breaking, needs a major bump and a migration plan, and the compatibility gate will
fail the build without one.

**Migration plan:** the only caller is `apps/web`'s committee-assignment form,
which never sent the field, and `tests/security/permission-matrix.test.mjs`, which
does not either. No external consumer exists (ADR-0004, single deployment). The
practical blast radius is the two test fixtures that currently create agreements
by hand — which this CCR replaces with real operations anyway.

## Security review (contract-policy step 2)

- **Ownership is the whole game here.** A teacher writes their *own* agreement:
  `own` grants must go through `requireOwnership`, not just the role check —
  the pattern `evidence.ts` already uses. An agreement is the document a career
  decision rests on.
- **`cycle_id` and `personnel_id` must be validated** for existence *and* school
  on `createAgreement`. The audit found four FK fields already trusting client
  input; this one binds a person to an evaluation, so it gets checked.
- **`submitted` and `acknowledged` must freeze the content.** Editing a submitted
  agreement would let a teacher rewrite the targets they are about to be scored
  against; editing an acknowledged one would let them rewrite what the director
  signed. AGR-002.
- **Only the director/school_admin may acknowledge** — never the evaluatee, even
  though they hold `own` on the agreement.
- **Evaluators read, never write.** `committee` grant on read only; no matrix row
  gives `evaluator` any agreement write.
- **AuditEvent on submit and acknowledge.** These are the governance acts. Note
  `AUDIT_ALLOWLIST` needs a `PerformanceAgreement` entry or the write silently
  logs nothing (it fails closed on unknown entity types) — the same trap CCR-014
  hit with `PersonnelProfile`.
- **`area_admin` read-only**, per SEC-TEN-3.

## Explicitly deferred

- **Workload hours on PA1.** The form has the teacher declaring ชั่วโมง up front;
  the system only has the chair's pass/fail boolean at scoring time
  (`WorkloadDeclaration.workloadMet`). Real gap, separable, and the gate works
  without it.
- **Mid-cycle amendment of an acknowledged agreement.** Real (ประเด็นท้าทาย does
  get revised); needs a versioning decision, not just an endpoint.
- **PA1 PDF.** `formVariant` already records `PA1_s` / `PA1_bs`; rendering it is
  CCR-007's machinery pointed at a new template, and the official plate stays
  deferred regardless.
- **Challenge in the PA report payload.** `ReportPayloadV1` has no challenge
  section today. Adding one is additive and belongs with B-3 (CCR-016), where the
  report becomes approvable.

## Verification plan

The criterion that matters is the mirror of CCR-014's:

```
# through the HTTP API alone, no Prisma writes:
#   teacher creates agreement + challenge -> submits
#   -> director acknowledges
#   -> director creates assignment (agreement derived, not supplied)
#   -> chair declares workload -> 3 evaluators submit scores -> rollup
```

- Integration test walking exactly that, and **deleting the raw
  `performanceAgreement.create` from `scoring-flow.test.mjs:114` and
  `global-setup.mjs`** — that deletion is the acceptance criterion, not a
  side-effect. It is what closes the coverage caveat in `QUALITY-GATES.md`.
- e2e: teacher writes ประเด็นท้าทาย in the UI; an evaluator opening the scoring
  screen sees that exact text beside T-C.1.
- Negatives: editing a submitted agreement → AGR-002; second agreement for the
  same (cycle, personnel) → AGR-001; cross-school agreement → RES-001; evaluatee
  acknowledging their own agreement → PERM-001.
- Permission sweep extended to all 6 operations (raising the floor from 34).

## Related

- `SEIP-BLOCK-002` · CCR-014 (onboarding, must land first) · CCR-016 (approval)
- ADR-0003 — วPA taxonomy is data; the 20/10/10 split and 60/40 weights are
  seeded `ScoreWeight` rows, not constants, and stay that way
- `docs/architecture/evaluation-framework.md` §ส่วนที่ 2
- Audit findings: "PerformanceAgreement/AgreementChallenge have zero references",
  "`agreement_id` is completely unvalidated in `createAssignment`"
