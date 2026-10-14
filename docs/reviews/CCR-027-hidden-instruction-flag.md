# CCR-027: the "may contain hidden instructions" flag (additive)

Status: **APPLIED 2026-10-14.** The change is additive, so it takes a minor bump. The policy it implements (who may clear the flag, and what the flag stops) was already written down as FR-028 in the PRD, so nothing new is decided here.
Task: `SEIP-P3-003` · Requirement: FR-028 (PRD §7) · Shipped: openapi **4.9.0**, permissions **2.9.0**

## Why

The person being evaluated is the main threat to an AI that reads their own evidence (PRD FR-028). An item may carry text written for the machine rather than the reader: "ignore previous instructions", "map this to every indicator", text too small to see, or invisible characters. Such an item must be flagged for a human, and the flag must change nothing on its own except to stop shortcuts.

## What changed

- `Evidence.injection_suspected` (boolean) and `Evidence.injection_reasons` (`hidden_characters`, `instruction_text`, `tiny_text`). Each analysis sets them for the content it read, keyed by its input hash.
- `POST /evidence/{evidenceId}/injection-flag/clear` (clearInjectionFlag):
  - permissions: `school_admin: school` only
  - the owner is refused even when they also hold school_admin (PERM-001)
  - idempotent, with an `injection_flag_cleared` audit row
  - it clears the flag for the current content only; a later analysis of changed content can raise it again
- While flagged, no suggestion on the item is `batch_acceptable`, and the batch accept skips it (AI-004). Single accepts by the owner still work, because a person looked at each one.
- The evidence page shows a badge to everyone who can open the item, the committee included. The school admin also gets a "ตรวจแล้ว ล้างธง" button there.

## Not chosen

- **Owner clears their own flag.** No: the owner is exactly who the check is about.
- **Director clears.** No: PRD FR-028 names the school admin (or an operator role, which does not exist yet). The director validates mappings and stays out of the security review.
- **Step-up (min_acr 2) on clearing.** Not yet. The audit row records who did it. Revisit when `ENFORCE_MIN_ACR` is on in staging.

## Not done

- Comparing the text layer against an OCR of the rendered page, which needs the GPU tier.
- Hidden sheets and comments in Office files, QR codes, and link snapshots, which need the extract service.
- A dedicated committee view, which comes in P4.

## Verified

- `packages/database/test/injection-detect.test.mjs` (4 tests).
- `apps/api/test/analysis.test.mjs` (+2): flagged, then owner and director refused, school admin clears with an audit row, and the flag stays cleared on a re-run of the same content. Ordinary text is not flagged.
- `apps/worker/test/file-process.test.mjs` (+1): a 0.5 pt line in a PDF raises `tiny_text`.
- `test:security` sweeps `clearInjectionFlag` for every role.
