# CCR-020: current memberships with school names (additive)

Status: **APPLIED 2026-10-13**. The change is additive, so it takes a minor bump.
Task: `SEIP-P1-009` · Requirement: FR-019 (PRD §7) · Shipped: openapi **4.3.0** (other contract files unchanged)

## Why

A person who works at two schools must choose which one they are working for. The API refuses an ambiguous write (VAL-002 with no X-School-Id), but the web had no way to choose. `/auth/me` returned school ids without names, so the web could not show a picker.

Separately, `/auth/me` also listed memberships that had ended. The API already ignores those for access, but the web derived its menus from them. After a transfer, a teacher was still shown the old school's screens, which the API then refused.

## What changed

- `CurrentUser.memberships[].school_name` (nullable string), set whenever `school_id` is set.
- `CurrentUser.memberships` lists only memberships in effect now. The new description says so. `isActiveNow` in `packages/auth` is now the single rule used by both access and `/auth/me`.

oasdiff reports no breaking changes from 4.2.0 to 4.3.0. No field is removed, and the response simply lists fewer items for people who have ended memberships.

## Web

- One school: chosen automatically, as before.
- Several schools: a picker. The choice is remembered per account in this browser, so the default is the school used last. Until a school is picked, the page says plainly that one must be picked.
- Switching school remounts the routes, so every page reloads its data for the new school.

## Verified

- `apps/api/test/school-context.test.mjs`: `/auth/me` lists current memberships with names, and an ended school is refused (PERM-002).
- `tests/e2e/school-picker.spec.ts`.
- Web unit tests for `schoolContext.ts`.
