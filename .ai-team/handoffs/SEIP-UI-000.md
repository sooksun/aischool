# Close-out: SEIP-UI-000 — Evidence Submission UX

Owner: claude (solo per ADR-0004) · Completed: 2026-07-17 · Reviewer: user (at ARCH-002)

## Delivered (docs/architecture/ux/)
| File | Content |
|---|---|
| `evidence-flow.mmd` (+ rendered `.svg`) | Mobile-first flow S1–S7 + error/resume/auth branches |
| `evidence-submission-flow.md` | Steps↔API table, low-fi wireframes, responsive intent, large-file/resume UX, PDPA notice, accessibility intent |
| `screen-states.md` | 8 screens × 7 states matrix + cross-cutting rules (auth expiry, retry policy, error-code mapping) |
| `field-contract-trace.md` | 37 UI fields traced to openapi.yaml — 34 clean, 3 gaps |

## Acceptance criteria
| AC | Result |
|---|---|
| 1 Minimal-field teacher flow | ✅ 3 fields (file, category, auto-filled title); indicators optional/deferrable |
| 2 Screen states inventoried | ✅ full matrix incl. offline/resume |
| 3 Fields traced to contract | ✅ 37/37 after CCR-002 (3 gaps found → contract patched) |
| 4 Responsive intent | ✅ mobile-first + tablet/desktop reflow documented |
| 5 Accessibility notes | ✅ 7 areas, phrased as future automated checks for UI-001 |
| 6 Large files + personal data | ✅ background/resume upload design + PDPA notice pattern |

## CCR-002 (raised by this task, applied to draft contract)
GAP-1 `CurrentUser.personnel` object (role_family + rank for framework selection & expected-level text) ·
GAP-2 evidence lifecycle draft→active explicit ·
GAP-3 `duration_seconds` nullable with server probe as authority.
Ratification at ARCH-002 (contract still 0.1.0-draft).

## Verification (actual)
- `ls docs/architecture/ux/` → 4 design files present ✅
- `mmdc -i evidence-flow.mmd -o evidence-flow.svg` → exit 0, svg created ✅
- Post-CCR-002: `redocly lint` valid, 0 warnings ✅ · `openapi-typescript` generates ✅

## Notes for Sprint 1 (SEIP-UI-001)
- Scan-status badge on S1 list may need denormalized field on Evidence list payload — decide with perf data, would be CCR at implementation.
- Committee/scoring UX intentionally not designed here — do alongside SEIP-DB-001 once contracts locked.
