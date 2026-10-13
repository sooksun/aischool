# CCR-025: who acknowledges a director's agreement, and what the old school keeps (policy change)

Status: **DECIDED BY THE OWNER 2026-10-13 (AskUserQuestion), APPLIED.** There is no openapi change. permissions **2.7.0** changes policy.
Task: `SEIP-P1-016` · Requirements: FR-097 (OQ-31), FR-051 (OQ-12)

## Decisions

1. **OQ-31 — who acknowledges a school administrator's agreement (ว10).** The area admin of the school's สพท., for now, until a สพท. supervisor role exists (FR-096). Nobody inside the school may acknowledge it, neither the school admin nor another director. The area admin acknowledges nothing else: teachers' agreements stay with the school, and the area admin is PERM-004 there.
2. **CCR-022 reset of a director's password.** It stays as built: the school admin may issue it.
3. **OQ-12 — what the old school keeps after a teacher moves.** The origin school keeps an item while the owner still works there. After they leave, it keeps only items its own evaluation used, meaning items with a live mapping at that school. Everything else is RES-001 for the school. The owner keeps everything.

## What changed

- permissions 2.7.0:
  - `acknowledgeAgreement` gains `area_admin: area` and joins `area_admin_writes`.
  - The route rule (`routes/agreements.ts`) splits it by the agreement's position role: an administrator's agreement → area_admin only; a teacher's → school roles only.
- `retainedBySchool` (`packages/database/src/repositories/evidence.ts`) narrows the school-scoped evidence list. `authorizeEvidence` applies the same rule to a single item, through the school's `school` / `area-r` grant.

## Verified

- `apps/api/test/agreement-approver.test.mjs` (2 tests).
- `apps/api/test/transfer.test.mjs` (+1, OQ-12).
- The permission-matrix sweep still covers acknowledgeAgreement.
