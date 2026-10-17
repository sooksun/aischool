# CCR-026: the same bytes twice in one portfolio (additive)

Status: **APPLIED 2026-10-13.** The change is additive, so it takes a minor bump.
Task: `SEIP-P2-001` · Requirement: FR-012 (PRD §7) · Shipped: openapi **4.8.0**, permissions **2.8.0**

## Why

FR-012 says that when a person uploads a file their portfolio already holds, the system tells them and links to the earlier item. The check happens before the bytes are sent, so no data is spent, and the server's own hash confirms it afterwards. It is only a warning: the person decides whether to keep both.

## What changed

- `GET /me/files/duplicates?checksum_sha256=` (findMyDuplicateFiles):
  - self-scoped
  - returns the caller's live items whose files have this exact, **server-verified** SHA-256, newest first
  - returns an empty list when there is none
- `EvidenceFile.duplicate_of_evidence_id` (nullable). The worker sets it after its re-hash matches, when another of the owner's live items already has a verified file with the same bytes. The earliest copy is the original. Other people's identical files never count.
- The web hashes the file when it is picked (and reuses that hash for the upload). It warns, with links to the matching items, before any bytes move. The evidence page marks a file that duplicates another item.

## Not done

- Not running AI again on a duplicate: AI arrives in P3, and it will read `duplicate_of_file_id`.
- Near-duplicates such as the same PDF exported twice (FR-013).

## Verified

- `apps/api/test/duplicates.test.mjs` (2 tests).
- `apps/worker/test/file-process.test.mjs` (+1).
