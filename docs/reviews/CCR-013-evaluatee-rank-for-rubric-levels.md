# CCR-013: `AssignmentDetail.evaluatee_rank_level_code` — make the seeded rubric text usable

## Request
ADR-0003 requires indicator level descriptions to be versioned seed data, never
hard-coded. The seed delivers on that — 792 `IndicatorLevelDescription` rows
across ว9 + ว10, keyed by `(indicator, rank_level_code, rubric_level)` — and
`getFramework?include=levels` already serves them.

The scoring UI read none of it. `AssignmentScorePage` fetched the framework
*without* `include=levels` and rendered four hardcoded phrases from
`validateScoreForm.RUBRIC_OPTIONS`:

```
1 — ต่ำกว่าที่คาดหวังมาก
2 — ต่ำกว่าที่คาดหวัง
3 — ตามที่คาดหวัง
4 — สูงกว่าที่คาดหวัง
```

Every committee member scored all 18 ว9 indicators against the same four
sentences. The framework's own expected-practice text — the thing they are
supposed to judge against, with its ว9/ว10 legal citation — was never shown.
Found by the 2026-07-18 audit, which called it the largest product defect in
`apps/web`.

## Why a contract change was required
Fixing the client alone was impossible. Level rows are keyed by rank, and the
evaluatee's วิทยฐานะ appeared nowhere in the API surface: `Assignment` carries
only `evaluatee_personnel_id`, and there is no personnel-lookup operation to
resolve it (the same missing `listPersonnel` the audit flagged elsewhere).

So the UI could not have selected the right rows even with `include=levels`, and
inventing generic labels was the only option left open to it. The hardcoding was
a symptom; the missing field was the cause.

## Changes
| Surface | Change |
|---|---|
| openapi.yaml | **2.7.0 → 2.8.0** additive: `AssignmentDetail.evaluatee_rank_level_code` (required) |
| packages/database | `getAssignmentDetail` includes `evaluatee: { rankLevelCode }` |
| apps/api | `getAssignment` serializes the new field |
| apps/web | fetch framework with `include=levels`; render `expected_practice_th` per option; new `lib/rubricLevels.ts` selects rows by (rank, level) |
| apps/web | `RUBRIC_OPTIONS` demoted to band name + fallback, with a comment saying so |

## Breaking?
**Additive, minor bump.** New response property only; no request shape changes,
nothing removed, no existing field retyped. Adding a required property to a
response is a server-side promise, not a client obligation — an existing client
ignores it.

`rank_level_code` is non-nullable on `PersonnelProfile` and every assignment has
exactly one evaluatee, so the server can always supply it; `required` is honest
rather than optimistic.

## Fallback behaviour
`levelTextFor` returns null when a row is absent and the UI falls back to the
generic band name plus a visible "ยังไม่มีคำอธิบายระดับสำหรับวิทยฐานะนี้ — ใช้เกณฑ์กลาง"
notice. This matters for ครูผู้ช่วย (`execute_learn`), whose 72 rows are
`buildPlaceholderTh` structural placeholders rather than transcribed anchors — an
evaluator should be able to tell framework criteria from a stand-in.

## Verified
Director opened a real assignment in the browser: 18 scorable indicators, **18
distinct level-3 texts** (previously one phrase repeated 18 times), each carrying
the evaluatee's actual rank `[Apply & Adapt (ครู)]`, the indicator's own criteria,
and the ว9 citation `ศธ 0206.3/ว 9 ลว. 20 พ.ค. 2564`.

## Related
- ADR-0003 — taxonomy is data
- `prisma/data/README.md` — which level rows are transcribed anchors vs derived framing
- Audit finding "3.1 ADR-0003 violation: rubric level descriptions are hardcoded"
