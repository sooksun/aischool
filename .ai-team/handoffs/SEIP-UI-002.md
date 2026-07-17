# Close-out: SEIP-UI-002 — Director/admin UI for cycles, rounds, committee assignment

Owner: claude (per ADR-0004) · Date: 2026-07-18 · Branch: `feat/SEIP-UI-002-director-cycles`

## Delivered

| File | Content |
|---|---|
| `apps/web/src/pages/director/CycleListPage.tsx` | `GET /cycles` list + inline create form (framework picked via `GET /frameworks?status=active`, not a raw id) |
| `apps/web/src/pages/director/CycleDetailPage.tsx` | Cycle detail, cycle status control, rounds shown inline (see below for why), inline create-round form, round status-transition buttons |
| `apps/web/src/pages/director/RoundAssignmentsPage.tsx` | Assignment list for a round + create-assignment form (evaluatee + 3-member committee) |
| `apps/web/src/pages/director/RoundAssignmentsPage.test.tsx` | 4 component tests for the committee form's client-side validation |
| `apps/web/src/App.tsx` | `RequireRole` (the app's first role gate — none existed before this task) + `AppNav`, a thin role-aware shell so director/school_admin can reach `/director/cycles` without editing `EvidenceListPage.tsx` |
| `apps/web/src/hooks/useAuth.tsx` | `hasRole(user, roles)` — pure export, no context changes |
| `apps/web/src/styles.css` | `.app-nav` (additive, appended at the end) |

## Design decisions forced by the real contract shape

**Rounds have no route of their own.** `openapi.yaml` has no `GET /rounds/{roundId}` — a round's data only ever arrives embedded in `CycleDetail.rounds[]`. A standalone `/director/rounds/:id` route would 404 on every page refresh. Rounds are shown inline on `CycleDetailPage` instead; only assignment management (which has a real `GET /rounds/{roundId}/assignments`) gets its own route, and it accepts optional round context via router `state` (present when reached by clicking through from the cycle page, absent — gracefully — on a direct URL/refresh, per `RoundAssignmentsPage`'s header comment).

**Round status transitions mirror the server's state machine client-side.** `ROUND_TRANSITIONS` only ever offers the ONE legal next status (planned→open→scoring→closed), so the UI can never even attempt a CYCLE-001 violation — matches `scoring.ts`'s own transition table exactly.

## Known limitation (documented, not hidden — same discipline as the CCRs)

**No personnel/user-listing endpoint exists anywhere in the contract.** Picking an evaluatee or a committee member is a raw-UUID text input, not a name picker — a director would need those ids from elsewhere (direct DB access) until a `listPersonnel`/`listStaff`-style endpoint exists. This is explicitly flagged in `RoundAssignmentsPage.tsx`'s header comment and shown to the user in-form (`ระบบยังไม่มีหน้าค้นหารายชื่อบุคลากร...`). Out of scope here — it touches `apps/api/**`, which this task's `primary_paths` deliberately excludes. Flagged as a follow-up.

**No PerformanceAgreement CRUD exists either** — `agreement_id` is always sent as absent/null from this UI (the field is optional in `AssignmentCreate`). This means the workload gate (`SCORE-004`) can never be satisfied for any assignment created here, since `WorkloadDeclaration` requires a real `agreement_id`. Pre-existing gap (predates this task, not introduced by it) — scoring itself is `SEIP-UI-003`'s concern, not this one's, but worth knowing before that task starts.

**`api/errors.ts` was not touched** (outside this task's `primary_paths`) — `CYCLE-*`/most `SCORE-*`/`VAL-003` error codes fall through to the generic `เกิดข้อผิดพลาด (CODE)` fallback rather than a polished Thai message. Confirmed non-broken (verified live: a duplicate-assignment conflict correctly showed `RES-002`'s existing mapped message, not a crash), just less polished than a dedicated message would be.

## A real accessibility bug the tests caught

Writing `RoundAssignmentsPage.test.tsx` found that the committee-role `<select>` had **no accessible name at all** — only the adjacent UUID `<input>` was labeled (`<label htmlFor="committee-N">` pointed at the input; the select next to it had nothing). `getByLabelText` couldn't target it, which is the same thing a screen reader user would hit. Fixed with `aria-label={"บทบาทที่นั่ง N"}` rather than working around it in the test.

## An unrelated infrastructure hazard discovered mid-task

Partway through this task, another concurrent session (working `SEIP-WORKER-001`) checked out its own branch in the **same shared working directory** (`D:\laragon\www\aischool`), silently discarding this task's then-uncommitted edits to `App.tsx` and `useAuth.tsx` (untracked new files and non-conflicting modified files survived; files that differed between branches did not — git carries forward uncommitted changes across a checkout only when there's no conflict). Recovered by re-authoring both files from scratch (their content was small and fresh in-context, so nothing of substance was actually lost) — but from that point on, all further work moved into an isolated `git worktree` (`D:\laragon\www\aischool-wt-ui002`, on a temporary branch, later pushed to origin under this task's real branch name) specifically so a repeat can't happen. Worth this project formally adopting worktrees (or otherwise never sharing one working directory across concurrently-running sessions) now that Sprint 2+ genuinely runs multiple sessions against the same repo — the anti-collision `primary_paths` rules in `task-board.yaml` protect against two tasks editing the same FILE; they don't protect against two sessions checking out different BRANCHES in the same DIRECTORY, which is a distinct hazard the board doesn't currently address.

## Verification (actual, run against a real dev stack — Postgres 17 + MinIO already running, real browser)

- `npm run typecheck` / `npm run build` (apps/web) — clean, 0 errors
- `npm run test:unit` (apps/web) — 16/16 pass (12 pre-existing + 4 new)
- **Live browser walkthrough** (Claude Browser tool, desktop viewport, real API + Postgres, not mocked):
  1. Logged in as a real director account → role-aware nav appeared with both links
  2. Created a cycle via the framework picker (real `GET /frameworks` data, not a stub) → appeared in the list with correct labels
  3. Opened cycle detail → created a round, bounded correctly to the cycle's date range
  4. Transitioned the round `planned → open` → button correctly updated to offer only the next legal transition (`เข้าสู่ช่วงให้คะแนน`)
  5. Created a 3-member committee assignment (real personnel/user ids from a seeded fixture) → appeared with all 3 seats, correct roles
  6. Attempted a duplicate assignment for the same evaluatee in the same round → server's `RES-002` conflict surfaced correctly as a Thai alert, no crash
  7. Logged in as a **teacher** account and navigated directly to `/director/cycles` by URL → redirected to `/`, confirming `RequireRole` blocks non-director/school_admin roles (server-side enforcement for the same boundary is already proven by SEIP-API-002's permission-matrix tests)
  8. Zero browser console errors throughout

## Deliberately deferred / explicitly out of scope

- Evaluator scoring UI (submit scores, view results) — `SEIP-UI-003`, next in the wave, depends on this task's shared nav/shell patterns per the board.
- Personnel/staff listing endpoint + a real name-picker UI — flagged above, needs an `apps/api` change first (outside this task's `avoid_paths`).
- `apps/web/src/pages/admin/**` — the board lists this as an alternate primary_path; not used. `director`/`school_admin` share the exact same screens (identical `permissions.yaml` grants for every operation this task touches), so there was nothing distinct to put there.

## Next

Merge to `develop` is the remaining shipping step (user approves). After that: `SEIP-UI-003` (evaluator scoring UI) is next in Wave C per the board, and can now build on `RequireRole`/`hasRole()`/`AppNav` rather than re-inventing role gating.
