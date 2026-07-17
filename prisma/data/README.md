# Taxonomy seed data (SEIP-DB-003+)

| File | Role |
|---|---|
| `level-descriptions.mjs` | Builds `IndicatorLevelDescription` rows for every scored indicator × rank tier × rubric 1..4 |

## Provenance (honest)

- **Indicator codes/names** and **rank tier names** come from `docs/architecture/evaluation-framework.md` (extracted from ว9/ว10 2564 PDFs).
- **Rubric level labels** (1–4) come from the same file §Scoring model — not invented.
- **Per-cell behavioural prose** in the official manuals is extensive and วิทยฐานะ-specific. This seed stores an **operational, structure-complete** text for each cell so the app can render expected-practice prompts without hard-coding in TypeScript. Operators may later replace `expected_practice_th` with verbatim PDF wording **without a schema change** (Protected Artifact update process).

Do **not** invent detailed behavioural descriptors that claim to quote the PDF when they do not. The template format records rank + indicator + rubric anchor so evaluators still see the correct axes.

## Counts (after seed)

- Teacher (ว9): 18 scored indicators × 6 ranks × 4 levels = **432**
- Administrator (ว10): 18 scored × 5 ranks × 4 levels = **360**
- Workload-gate indicators: **0** level rows (not scored)
