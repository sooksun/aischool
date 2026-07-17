# Close-out: SEIP-QA-003 — Permission matrix tests (arms the `permission-tests` gate)

Owner: claude (solo per ADR-0004) · Date: 2026-07-17 · Branch: `feat/SEIP-API-001-evidence-workflow`

## Why this task exists
`tests/security/` has been an empty, unarmed CI gate since SEIP-QA-001. With
`apps/api` now implementing 15 real operations against `permissions.yaml`, this
closes the loop SEC-TEN-5 promised: prove enforcement matches the matrix, by
**reading the matrix at test time** rather than hand-encoding expected outcomes.

## Delivered
`tests/security/permission-matrix.test.mjs` — three tests:
1. **Generated sweep**: for 13 of the 15 implemented operations × all 6 roles (78
   assertions), loads the grant from `permissions.yaml` via `@seip/backend-shared`
   (the same loader `apps/api` enforces with — no second copy to drift) and asserts
   the live HTTP response matches: no grant → `403 PERM-001`; grant held for a
   resource the role doesn't own (`own`/`own-revoke`) → still denied (ownership
   boundary); grant held and applicable → never a role-based denial.
2. `area_admin` is read-only across every write operation (static matrix check +
   one live-request confirmation).
3. `X-School-Id` header semantics (CCR-003): single-membership callers have it
   ignored safely (no leak to an arbitrary header value); multi-membership callers
   get it validated, with a non-matching value rejected as `PERM-002`.

## A real bug this found (not a test artifact)
`resolveCurrentSchool` (in `apps/api/src/plugins/auth.ts`) rejected **every**
`X-School-Id` header from a caller with **zero** direct school memberships — i.e.
every pure `area_admin`, since their only schools come via area membership, not
direct `SchoolMembership` rows. The original check only validated the header
against `tenancy.schoolRoles` (direct memberships), so `[].includes(anything)` was
always `false`. Every area-scoped write correctly ended up denied, but for the
**wrong reason** (`PERM-002` "no such membership" instead of resolving the school
and then correctly hitting `PERM-001` "no write grant"). Fixed: `resolveCurrentSchool`
now also accepts a school whose `areaId` the caller administers.

## Test-design mistakes found and fixed along the way (documented, not hidden)
- First sweep attempt asserted "has a grant → must never be denied" without
  accounting for **which** resource — director/deputy correctly got denied acting
  on evidence *owned by teacher* even though they too hold an `own` grant. Fixed by
  tracking `OWNER_ROLE` and only asserting non-denial when the acting role actually
  owns the fixture.
- `actOnMapping`'s test payload used `action: 'reject'`, which only director/
  school_admin may do — teacher's real grant (`own-revoke`) only covers `revoke`.
  Teacher was correctly rejected; the test's expectation was wrong. Fixed to use
  `revoke`, the one action every granted role can legally perform.
- `deleteEvidence` originally targeted a random (nonexistent) id to avoid deleting
  the shared fixture — but that means it always 404s before any ownership check
  runs, which isn't what the check needs. Fixed: a fresh, real, teacher-owned
  throwaway resource is created per role tested.
- The original PERM-002 test used a **single**-membership user, for whom the
  header is (correctly, per CCR-003) *ignored* rather than validated — so it never
  exercised the rejection path at all. Fixed with a genuinely multi-membership user.
- `res.json()` on a legitimate `204 No Content` (teacher deleting their own
  evidence) throws on the empty body. Guarded on status code.

## Verification
`npm run test:security` — 3/3 pass, 78+ systematic assertions, against real
Postgres. Re-ran the full suite (`test:unit` 13/13, `apps/api` integration 6/6,
`packages/database` integration 6/6, root backend 18/18 — 46 tests total) after
the `auth.ts` fix to confirm no regression.

## Known limitation
Covers the 13 non-exempt of 15 implemented operations (login/getCurrentUser are
exempt by design, not swept). The 12 deferred contract operations (cycles/rounds/
scoring) have no sweep coverage yet — arrives with whatever task implements them.

## Close verification 2026-07-17

`npm run test:security` → **3/3 pass** on the same environment as API-001 close.

**Status: DONE** (ships with API-001 branch).
