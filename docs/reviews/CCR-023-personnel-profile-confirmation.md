# CCR-023: the person confirms their personnel profile; the admin edits it (additive)

Status: **APPLIED 2026-10-13.** The change is additive, so it takes a minor bump.
Task: `SEIP-P1-014` · Requirement: FR-099a (PRD §7), US-19 / US-27 · Shipped: openapi **4.6.0**, permissions **2.5.0**

## Why

The school admin enters a person's position and วิทยฐานะ (by invite or CSV). These select the rubric (ว9 or ว10) and the level descriptions the person is assessed against. FR-099a requires the person to confirm these on first use, or to ask for a correction. Until now nobody could edit a profile after it was created.

## What changed

- `PersonnelSummary` and `CurrentUser.personnel` gain three nullable response fields:
  - `rank_since` (date)
  - `confirmed_at`
  - `correction_note`

  `CurrentUser.personnel` also gains `full_name`.
- New operations:
  - `POST /me/personnel/confirm` (confirmMyPersonnel): self-scoped to the current school; RES-001 when there is no profile.
  - `POST /me/personnel/correction` `{ note }` (requestPersonnelCorrection): unconfirms the profile and leaves the note for the admin.
  - `PATCH /personnel/{personnelId}` (updatePersonnel):
    - school_admin only, `min_acr: 2`
    - a rank outside the position's family is VAL-003
    - any edit clears the note; a change of position or rank also clears the confirmation, so the person checks it again
    - audited, with before and after
- Web:
  - a "ตรวจข้อมูลของคุณ" banner on the home page until the person confirms
  - correction notes shown to the admin in the members page, with an edit form

## Not done (rest of FR-099a)

- Classroom type, main subjects and grades.
- Values per cycle (a snapshot per cycle). Agreements and cycles already keep the framework they were made with, so a mid-cycle change only affects new ones (FR-089).
- Phone as an alternative CSV contact column.

## Verified

- `apps/api/test/personnel-profile.test.mjs` (3 tests).
- The permission-matrix sweep and the step-up test cover updatePersonnel.
