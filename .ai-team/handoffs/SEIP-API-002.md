# Close-out: SEIP-API-002 — Cycles + committee scoring (remaining 11 of 27 contract operations)

Owner: claude (solo per ADR-0004) · Date: 2026-07-17 · Branch: `feat/SEIP-API-002-cycles-scoring`

## Why this task exists

SEIP-API-001 explicitly deferred cycles/rounds/committee-scoring as a separate task
("substantial enough...not a shortcut inside this one"). The DB-001 schema already
modeled the full shape (`EvaluationCycle`, `EvaluationRound`, `EvaluationAssignment`,
`CommitteeMember`, `IndicatorScore`, `RoundResult`, `WorkloadDeclaration`) and 6 of
its own constraint tests already proved the DB-level rules bite — this task is the
API layer over data that was already correct and tested, not new data modeling.

## Delivered

| File | Content |
|---|---|
| `packages/database/src/repositories/cycles.ts` | `EvaluationCycle`/`EvaluationRound` — tenancy-safe (schoolId folded in directly for cycles; resolved through the parent cycle for rounds, which carry no schoolId of their own) |
| `packages/database/src/repositories/scoring.ts` | `EvaluationAssignment`/`CommitteeMember`/`IndicatorScore`/`RoundResult`/`WorkloadDeclaration`, plus `listEvaluateePersonnelIdsForCommitteeMember` (the join evidence.ts/mappings.ts needed to un-stub their `committee` grant) |
| `apps/api/src/routes/cycles.ts` | 6 operations: listCycles, createCycle, getCycle, updateCycle, createRound, updateRound |
| `apps/api/src/routes/scoring.ts` | 5 operations: listAssignments, createAssignment, getAssignment, submitMyScores, getAssignmentResults |
| `apps/api/src/lib/permission-guard.ts` | `requireCommitteeAccessToPersonnel` — the `committee`-grant equivalent of the existing `requireOwnership` |
| `apps/api/src/routes/evidence.ts`, `mappings.ts` | 4 previously-stubbed `committee` grants (getEvidence, listEvidence, listEvidenceMappings, listMappings) now do the real CommitteeMember join instead of unconditionally throwing PERM-003 |
| `apps/api/test/scoring-flow.test.mjs` | 12 end-to-end tests: full 3-evaluator scoring flow, round state machine, workload gate, committee-grant widening on evidence, assignment validation |
| `tests/security/permission-matrix.test.mjs` | Extended from 13 to 23 operations × 6 roles (all 27 operations now have SOME sweep coverage; `getAssignmentResults` is the one deliberate exception — see below) |

**All 27 `openapi.yaml` operations are now implemented.**

## The scoring formula, derived not assumed

`evaluation-framework.md` states the 4-level→percent rule (`4=100%, 3=75%, 2=50%,
1=25%`) explicitly only for ส่วนที่ 2 (challenge). Standard indicators (ส่วนที่ 1) carry
no individual `maxPoints` in the seed data (deliberately `null`) — there's no
per-indicator point allocation to derive a formula from directly. Resolved by reading
the actual seeded `ScoreWeight`/`Indicator` rows (`prisma/seed.mjs`): challenge items
DO carry explicit `maxPoints` (20/10/10, summing to `part2_total`=40), so one weighted-
average formula naturally covers both parts — standard indicators default to weight=1
each (equal-weight average) when `maxPoints` is `null`, challenge indicators weight by
their real point value:

```
part_percent = Σ(maxPoints_i × rubric_i/4) / Σ(maxPoints_i) × 100   // maxPoints_i defaults to 1
total_percent = part1_percent × (part1_weight/100) + part2_percent × (part2_weight/100)
```

`part1_weight`/`part2_weight` (60/40) come from `ScoreWeight`, not a hardcoded
constant — a future framework revision that reweights the parts is a data change.
Verified with hand-computable fixture values in `scoring-flow.test.mjs` (2 standard
indicators at level 4, 1 challenge indicator worth 40pts at level 3 → expected
part1=100, part2=75, total=90 — asserted exactly, not just "success").

## A real bug the generated permission sweep caught before merge

Extending `permission-matrix.test.mjs` to cover the new operations required actually
seating the fixture's `evaluator` (and `director`) on a real committee — without that,
2 assertions failed immediately (`getEvidence`/`listEvidenceMappings` x evaluator:
"has grant 'committee' but was denied"), correctly proving the grants were still
wired to the old always-deny stub at that point in the work.

After fixing the stubs and adding `getAssignment` to the sweep, one more mismatch
surfaced: `deputy` (holds `own` for `getAssignment` but isn't the fixture's
evaluatee) got **404** instead of the expected **403**. My own `getAssignment`
handler had written an ad-hoc `RES-001` for this case instead of reusing the
existing `requireOwnership()` helper (which every other own-sensitive route already
uses, and which correctly throws `PERM-001` — same-school role denial, not
cross-tenant hiding). Fixed by reusing `requireOwnership()` in both `getAssignment`
and `getAssignmentResults`, restoring consistency with the established precedent.
This is exactly the kind of drift the generated-from-contract sweep exists to catch.

## Deliberately deferred / out of scope

- **`getAssignmentResults` is NOT in the permission-matrix sweep.** Its `own` grant
  carries an extra temporal rule (permissions.yaml note: evaluatee sees results only
  once the round is `closed`) that returns `PERM-001` even for the genuine evaluatee
  on a non-closed round — colliding with the sweep's generic "owner must never see
  PERM-001" assumption for a reason that has nothing to do with a matrix mismatch.
  That exact behavior (including the genuine-evaluatee-once-closed case) is instead
  covered directly by `scoring-flow.test.mjs`.
- Director/evaluator/school_admin **UI** for cycle management and committee scoring
  — apps/web still only has the teacher evidence-submission flow (SEIP-UI-001 scope).
  This task is API-only, matching how API-001 shipped before UI-001 built on it.
- `apps/worker` still doesn't exist — nothing computes `RoundResult` asynchronously
  or dispatches the `events.yaml`-defined events; scoring here is entirely synchronous
  (computed and stored inline within `submitMyScores`), which is correct for this
  scale and doesn't need the worker to function.
- Report generation (PA1/PA2/PA3) — unaffected by this task, still deferred to a
  future contract v0.2 per the existing plan.

## Bug fixed along the way (not part of the original task)

`apps/api/package.json`'s `test:integration` script hardcoded
`"test/evidence-flow.test.mjs"` instead of a glob — the new `scoring-flow.test.mjs`
silently never ran until this was caught (all 6 old tests passed, the new file was
just never invoked). Fixed to `"test/*.test.mjs"`, matching how `packages/database`
and the root `tests/security` scripts already glob.

## Verification (actual, run against disposable Postgres 17 + MinIO matching CI's exact image tags/credentials, not the persistent local dev stack)

| Check | Result |
|---|---|
| `npm run build:libs` + `apps/api` + `apps/web` build | clean, 0 errors |
| `npm run gate:contracts` (lint/typegen/yaml-parse/authz-coverage/codegen-drift) | pass — 27 operations, 25 matrix rules, 2 exemptions, unchanged |
| `npm run gate:ownership` | pass |
| root `test:integration` (DB constraint tests) | 18/18 pass, unaffected |
| `packages/database` `test:integration` | 6/6 pass, unaffected |
| `apps/api` `test:integration` (evidence-flow + scoring-flow) | 12/12 pass |
| `npm run test:security` (permission-matrix) | 3/3 pass — 23 ops × 6 roles, 0 mismatches |

## Next

Merge to `develop` is the remaining shipping step (user approves). After that, the
highest-value next increments per `PROJECT_STATE.md` are `SEIP-WORKER-001` (virus
scan / duration probe / outbox dispatch) and director/evaluator UI screens for cycle
management and committee scoring — apps/web's flow now has a real API to call for
the latter, same relationship API-001 had to UI-001.
