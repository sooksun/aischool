# CCR-024: owner acceptance of evidence uploaded on their behalf; moving an item to another school (additive)

Status: **APPLIED 2026-10-13.** The change is additive, so it takes a minor bump.
Task: `SEIP-P1-015` · Requirement: FR-019 (PRD §7), US-13 · Shipped: openapi **4.7.0**, permissions **2.6.0**

## Why

FR-019 has two rules the API did not enforce:
- A school admin may upload on someone's behalf, but the item counts in that person's portfolio only after they accept it. Until now the item counted at once.
- A person who works at two schools and filed an item under the wrong one moves it to the right one, with audit.

## What changed

- **Owner acceptance:**
  - `Evidence.owner_accepted_at` (nullable). It is set at creation when the owner uploads the item, and null when a school admin uploads for someone else. Existing rows are backfilled as accepted.
  - `POST /evidence/{evidenceId}/accept` (acceptEvidence): owner only (`own` for every role that owns evidence); a non-owner gets RES-001. It is idempotent and audited as `owner_accepted`. To decline, the owner deletes the item.
  - createMapping on an item not yet accepted is VAL-002, so the item does not count until it is accepted.
- **Moving an item:**
  - `EvidencePatch.origin_school_id`: owner only (PERM-001 otherwise).
  - The target must be a school where the owner is a current member, in the same สพท. (controller). Anything else is VAL-002; a move between controllers is ADR-0015 §5.
  - Audited as `moved`. Mappings already made keep their school.
- `CurrentUser.person_id`, so a client can tell which items are the caller's own.
- **Web:** the evidence page shows an accept banner on items uploaded for you, and a school selector when you have more than one school.

## Verified

- `apps/api/test/evidence-context.test.mjs` (3 tests).
- The permission-matrix sweep covers acceptEvidence.
