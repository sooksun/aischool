# CCR-019: bulk member import (additive)

Status: **APPLIED 2026-10-13**. The change is additive, so it takes a minor bump (contract-policy.md) and does not need owner approval.
Task: `SEIP-P1-008` · Requirement: FR-091 (PRD §7) · Depends on: CCR-014 (inviteMember)
Shipped: openapi **4.2.0** · permissions **2.2.0** · error-codes and events unchanged

## Why

FR-091 asks for bulk onboarding from a staff list, with a report of the rows that are wrong. A school has 20–80 staff. Inviting them one at a time is the onboarding cost that the pilot schools would actually feel.

## What changed

| Contract | Change |
|---|---|
| openapi | `POST /members/import` (importMembers). The body is `MemberImport`: `rows` (1–500 `MemberInvite`) and `dry_run`. The response is `MemberImportResult`, with one `MemberImportRowResult` per row in request order: `invited` / `would_invite` / `rejected`, plus the member, the one-time invite token, or an `Error`. |
| permissions | `importMembers: { school_admin: school }` and `min_acr: importMembers: 2`. Both are the same as inviteMember. |

oasdiff reports no breaking changes from 4.1.0 to 4.2.0.

## Rules

- Each row is exactly an inviteMember: same validation, same transaction and same audit. Rows pass or fail independently.
- An email already in a current membership gets RES-003. An email repeated within one request gets VAL-002. An area_admin role gets VAL-002. A rank from the wrong framework family gets VAL-003. A malformed row gets VAL-001, with the field named.
- `dry_run` runs every check and writes nothing.
- The CSV is parsed in the browser (`apps/web/src/lib/memberCsv.ts`), so the API stays typed JSON. The server re-checks every row regardless.
- Invite tokens appear once, in this response, exactly as from inviteMember.
