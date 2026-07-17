# Close-out: SEIP-UI-003 — Evaluator scoring UI

Owner: Grok · Date: 2026-07-18 · Branch: `feat/SEIP-UI-003-evaluator-scoring`  
Base: `origin/develop` (includes OPS-003 + REPORTS-AI)

## Delivered

| Path | Role |
|---|---|
| `apps/web/src/pages/evaluator/EvaluatorHomePage.tsx` | List cycles |
| `EvaluatorCyclePage.tsx` | List rounds (read-only) |
| `EvaluatorRoundPage.tsx` | Assignments visible to committee member |
| `AssignmentScorePage.tsx` | Full score form + ≥70% rollup + overall results |
| `components/scoring/validateScoreForm.ts` + test | Client SCORE-005 / 1..4 mirror |
| `App.tsx` | Nav «งานกรรมการ» + `/evaluator/*` routes |
| `api/errors.ts` | Thai maps for SCORE-001..005, CYCLE-*, VAL-003 |

## Flow

```
/evaluator → cycle → round → assignment
  → score all is_scored indicators (1–4)
  → chair may set workload_met
  → PUT my-scores → show rollup ≥70%
  → GET results when permitted (evaluatee only after round closed — API)
```

## Acceptance

| Criterion | Result |
|---|---|
| Committee member submits full indicator set | DONE |
| SCORE-002 / SCORE-005 as Thai errors | DONE (`thaiMessageFor` + client validate) |
| Evaluatee results only after round closed | DONE (API enforces; UI shows empty/hint) |
| Unit tests for score form validation | DONE (4 tests) |

## Verification

```
npm run typecheck --workspace apps/web
npm run test:unit --workspace apps/web
```

## Known limitations

- No personnel name directory (UUIDs shown) — same as UI-002.
- Framework id rediscovered via cycle scan on hard refresh (not on AssignmentDetail DTO).
