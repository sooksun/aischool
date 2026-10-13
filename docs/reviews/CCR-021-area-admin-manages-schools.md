# CCR-021: area admin manages the schools of their area (policy change)

Status: **AWAITING OWNER APPROVAL BEFORE MERGE.** The openapi diff is additive (4.3.0 → 4.4.0, oasdiff: no breaking changes), but it changes a locked policy. Until now `permissions.yaml` said `writes_by_area_admin: forbidden`, and this CCR gives area_admin its first writes.
Task: `SEIP-P1-010` · Requirement: FR-090 (PRD §7), US-14 · Shipped: openapi **4.4.0**, permissions **2.3.0**

## Why

Today a school can only be added by an operator running `scripts/ops/provision-school.mjs`, and the first school_admin by `scripts/ops/bootstrap-admin.mjs`. FR-090 requires the สพท. admin to do both through the web for the schools of their own area.

## What changed

- New operations:
  - `GET /areas/{areaId}/schools` (listAreaSchools)
  - `POST /areas/{areaId}/schools` (createSchool; a duplicate code is RES-002)
  - `PATCH /schools/{schoolId}` (updateSchool: rename, close or reopen)
  - `POST /schools/{schoolId}/admins` (appointSchoolAdmin: the same invite as inviteMember, with role school_admin)
- In permissions 2.3.0, `writes_by_area_admin: forbidden` stays, plus a closed exception list `area_admin_writes: [createSchool, updateSchool, appointSchoolAdmin]`. Everything else area_admin does is still read-only (PERM-004).
- Each of the three writes needs `min_acr: 2` (step-up).
- Scope:
  - An area or school outside the caller's own area_admin areas is RES-001 (it does not exist for them).
  - A caller who administers no area is PERM-001.
- A closed school (`status: inactive`) ends its members' access. `isActiveNow` is false for a membership at an inactive school, so `/auth/me` stops listing it and the API refuses it. Data is kept. Reopening restores access. The area admin still sees the school.
- Every create, rename, close and reopen is audited (`School`: created / updated / closed / reopened).

## Owner decisions needed

1. Accept the exception to "area_admin is read-only" for these three writes only.
2. Closing a school cuts its members off at once, with no grace period.

## Verified

- `apps/api/test/area-schools.test.mjs` covers:
  - own area works, while another area and a school role are refused
  - a duplicate code is RES-002
  - an appointed school_admin accepts the invite and manages members
  - close and reopen
- `tests/security/permission-matrix.test.mjs` sweeps all four operations against every role.
- `apps/api/test/step-up.test.mjs` checks each of the three writes at acr 1 and acr 2.
- The web `manageAreaSchools` capability has unit tests.
