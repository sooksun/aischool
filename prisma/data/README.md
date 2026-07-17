# Taxonomy seed data (SEIP-DB-003 structure + SEIP-DB-004 real content)

| File | Role |
|---|---|
| `level-descriptions.mjs` | Builds `IndicatorLevelDescription` rows for every scored indicator × rank tier × rubric 1..4 |
| `level-description-anchors.mjs` | Real expected-practice text transcribed from the official PDFs, keyed by (rankCode, indicatorCode) |

## Provenance (honest)

- **Indicator codes/names** and **rank tier names** come from `docs/architecture/evaluation-framework.md` (extracted from ว9/ว10 2564 PDFs).
- **Rubric level labels** (1–4) come from the same file §Scoring model — not invented.
- **Per-indicator×rank expected-practice text** (the `rubricLevel=3` reference standard) is **verbatim-transcribed** from the official PA 2/ส (teacher) / PA 2/บส (administrator) "แบบประเมินผลการพัฒนางานตามข้อตกลง (PA)" forms — one real paragraph per (indicator, rank), sourced by direct PDF extraction, not invented. See `level-description-anchors.mjs`'s module header for the extraction/verification method and the two narrow, source-evidenced corrections applied.
- **Rubric levels 1, 2, and 4** have no separate source paragraph — the official form only states one expected-practice standard per (indicator, rank), used here as the `rubricLevel=3` ("ตามที่คาดหวัง") anchor. Levels 1/2/4 are built by framing that same real anchor with comparison language (below/above the standard) — honest derivation, not additional verbatim PDF text. See `buildExpectedPracticeTh`/`LEVEL_FRAMING` in `level-descriptions.mjs`.
- **execute_learn (ครูผู้ช่วย)** has no PA 2/ส form of its own in the source document — confirmed by direct inspection, not assumed. That rank uses a separate "เตรียมความพร้อมและพัฒนาอย่างเข้ม" (readiness/intensive-development) track, not this PA cycle. Its rows keep a structural placeholder that says so explicitly, rather than either fabricating content or silently dropping the rows.

Do **not** invent detailed behavioural descriptors that claim to quote the PDF when they do not.

## Counts (after seed)

- Teacher (ว9): 18 scored indicators × 6 ranks × 4 levels = **432** (5 ranks real PA 2/ส text; `execute_learn` structural placeholder)
- Administrator (ว10): 18 scored × 5 ranks × 4 levels = **360** (all 5 ranks real PA 2/บส text)
- Workload-gate indicators: **0** level rows (not scored)
