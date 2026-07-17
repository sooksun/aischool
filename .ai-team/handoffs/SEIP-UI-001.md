# Close-out: SEIP-UI-001 — Evidence Submission Flow Implementation

Owner: claude (solo per ADR-0004) · Date: 2026-07-17 · Branch: `feat/SEIP-API-001-evidence-workflow`

## Delivered
`apps/web` — Vite + React + TypeScript SPA implementing the full S1–S7 flow from
`docs/architecture/ux/evidence-submission-flow.md`, wired to the real `apps/api`
(SEIP-API-001) via generated OpenAPI types.

| Piece | Content |
|---|---|
| `src/api/schema.generated.ts` | Generated from `openapi.yaml` (codegen + CI drift check, same discipline as `packages/backend-shared`) |
| `src/api/client.ts` | `openapi-fetch`-based client + `unwrap()` (throw `ApiError` on error) |
| `src/hooks/useAuth.tsx` | Token storage, current-user resolution, CCR-003-matching school-context resolution |
| `src/pages/LoginPage.tsx` | S0 — accessible Thai form, error mapped through `thaiMessageFor` |
| `src/pages/EvidenceListPage.tsx` | S1 — empty/loading/list states, status badges |
| `src/pages/EvidenceSubmitPage.tsx` | S2–S6 stepper — file pick, category+title (client-side UPL-001/002/003 mirror), optional indicator chips (real ว9/ว10 taxonomy), PDPA review, two-phase MinIO upload with progress |
| `src/pages/EvidenceDetailPage.tsx` | S7 — file scan status, mapping status |
| `src/lib/fileValidation.ts`, `uploadWithProgress.ts` | Client-side validation mirror, XHR progress-tracked upload |

## Acceptance criteria
| AC | Result |
|---|---|
| Teacher submits evidence with minimal fields | **DONE, verified live** — 3 required fields, indicators skippable |
| Responsive mobile support | **DONE, verified live** — 375×812 viewport: 56×56 FAB, zero horizontal overflow |
| Accessibility checks pass | **DONE at design level** — semantic labels, `role="alert"`/`role="status"`, `aria-pressed`/`aria-checked` on selection controls, `progressbar` with `aria-valuenow`, verified via the accessibility tree (`read_page`), not just visual inspection |

## Verification — this is the one that matters most: a real browser, not just tests
Per session guidance ("start the dev server and use the feature in a browser
before reporting the task as complete"), the full flow was driven end-to-end
through the Browser tool against the real API + real Postgres + real MinIO:

1. Seeded a real teacher account, logged in through the actual login form.
2. `/auth/me` resolved identity + personnel + school context correctly.
3. Dispatched a real `File` object to the file input (native pickers aren't
   automatable; used `DataTransfer` + a `change` event — a standard technique,
   not a mock).
4. Category step showed the real 6 seeded `EvidenceCategory` rows correctly
   labeled (amid stale test-pollution categories from earlier test suites
   sharing the dev DB — a data-hygiene note, not a code defect).
5. Indicator step showed the **real ว9 taxonomy** — T-1.1 through T-3.3,
   the exact 15 indicators extracted from the actual ก.ค.ศ. PDF at the start
   of this project (ADR-0003) — confirming the full chain (PDF → seed → API →
   generated types → UI) is wired correctly end to end.
6. PDPA review step rendered the exact notice text, correct `role="note"`.
7. Confirming send ran the REAL pipeline: `createEvidence` → `initiate` →
   **actual PUT to MinIO** (no mock) → `complete` → mapping create.
8. Done screen showed a real evidence UUID; zero console errors at any step.
9. **Server-side verification**, not just "the UI said success": queried
   Postgres directly — `status: "active"` (CCR-002 lifecycle), file byteSize/
   checksum matched exactly what was sent, mapping was `T-1.2` (exactly the
   indicator clicked) at `status: "suggested"` (not auto-confirmed — the
   governance rule from SEIP-API-001 holds through the UI too). Queried MinIO
   directly via `mc ls` — the object physically exists at the expected key.
10. Revisited the list page (S1) and detail page (revisited S7) — both
    correctly render the persisted evidence and its real status.

## Automated tests
`apps/web/src/lib/fileValidation.test.ts` (9 tests) — client-side UPL-001/002/003
mirror logic, checksum determinism. `apps/web/src/pages/LoginPage.test.tsx` (3
tests) — accessible labels, Thai error mapping (never leaks the raw server
message), submit-button disabled state during a request. **12/12 pass.**
Arms the `test:unit` CI gate for `apps/web` (aggregated into the root
`npm run test:unit --workspaces`).

## Known limitations (carried forward honestly)
1. **No offline/resume persistence across a closed tab** — screen-states.md's
   full design describes localStorage/IndexedDB-backed resume; this
   implementation retries within the page session only (documented in the
   page's own header comment, not silently shipped as complete).
2. **`X-School-Id` picker UI doesn't exist** — CCR-003's multi-membership path
   is implemented in `useAuth` (same "exactly one → implicit" rule as the
   server) but there's no UI for a multi-school user to switch schools; not
   needed for the MVP single-school-teacher persona the UX design targets.
3. Director/evaluator/school_admin screens (confirm mapping, scoring) are not
   built — consistent with `apps/api` only implementing the evidence-workflow
   slice; a future task alongside `SEIP-API-002`.
4. `EvidenceFile.download_url` always renders `null` in the UI (matches the
   API's current behavior — presigned GET issuance wasn't implemented since
   the MVP flow never needs to re-download during submission).

## Next
A future task should build director/school_admin mapping-confirmation and
committee-scoring screens once `SEIP-API-002` (cycles/rounds/scoring) exists.
