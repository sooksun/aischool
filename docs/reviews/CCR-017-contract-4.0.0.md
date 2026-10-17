# CCR-017: contract 4.0.0, built around the purpose: capture once, AI suggests in the background, the owner confirms

Status: **APPROVED 2026-10-12 by the owner** (BREAKING). Application is SEIP-P1-001.
Decisions: ADR-0010 (in-country AI), ADR-0015 (portfolio ownership), ADR-0016 (clients + contract 4.0), ADR-0017 (v1 scope), ADR-0018 (upload integrity)
Phase: P0 weeks 2–3 (plan.md §7). Implementation follows approval and spans P1–P5.
Applied as [`docs/contracts/openapi.yaml`](../contracts/openapi.yaml) (the 4.0.0 draft was removed on apply) · Draft: [`docs/contracts/drafts/internal-ai-0.1.0.yaml`](../contracts/drafts/internal-ai-0.1.0.yaml)

## Why this is one breaking release, not a series of minors

3.1.0 models a **school-owned evidence row** that the owner maps to indicators of a **cycle**, with an **AI call the client makes synchronously** (`suggestMappings`) and a single `confirmed` state that only the director can reach. The rethink (PRD v1.0, ADR-0015/0016) changes all four:

| 3.1.0 | 4.0.0 | Decision |
|---|---|---|
| Evidence belongs to the school (`school_id`, `owner_personnel_id`) | It belongs to the **person** (`owner_person_id`), under an ESA controller (`controller_area_id`); the school is only `origin_school_id` | ADR-0015 |
| Mapping per (evidence, indicator, **cycle**) | Per (evidence, indicator, **framework version**). A portfolio item outlives a cycle | ADR-0015 |
| `suggested → confirmed` by the director | `owner_confirmed → validated / returned` (two tiers). AI output is a separate `Suggestion` until the owner accepts it | ADR-0015, PRD FR-04x |
| `POST …/mappings/suggest`, synchronous, local heuristic | Async analysis pipeline (`requestEvidenceAnalysis` → `Suggestion` with server-validated locators) | ADR-0010 |
| One presigned PUT, non-resumable | Upload sessions: single PUT ≤16 MiB, S3 multipart above, resumable from server-side ListParts | ADR-0016 §5 |

Each of these changes the shape of `Evidence` or `Mapping`, so shipping them as minors would mean several breaking bumps in a row. One major bump, applied once, costs less.

## What changes

### Removed (3 operations, 5 schemas)

| Operation | Replaced by |
|---|---|
| `suggestMappings` | `requestEvidenceAnalysis` + `listEvidenceSuggestions` + `acceptSuggestion(s)` / `rejectSuggestion`. `local_heuristic` survives as a provider inside the pipeline (the degraded mode and the evaluation floor) |
| `initiateFileUpload`, `completeFileUpload` | `createUpload` → (`signUploadParts`) → `completeUpload`, plus `getUpload` / `abortUpload` |

Schemas `MappingSuggestRequest`, `MappingSuggestResult`, `FileUploadInitiate`, `FileUploadTarget` and `FileUploadComplete` are removed.

### Changed

- **`Evidence`:**
  - `school_id` and `owner_personnel_id` → `owner_person_id`, `controller_area_id` and `origin_school_id`.
  - New fields: `kind` (file | link | note), `link_url`, `note_text`, the work-performed dates (`performed_from` / `performed_to` and `performed_date_source`), `academic_year_be`, `semester`, `contains_learners`, `client_uuid`, `version` and `updated_at`.
- **`EvidenceCreate`** requires `kind` and `client_uuid`. **`createEvidence`** requires an `Idempotency-Key` header, and a replay returns `200` with the original body.
- **`updateEvidence` / `deleteEvidence`** require `If-Match`. A stale version returns `412 RES-004`; a missing header returns `428 RES-005`.
- **`EvidenceFile`:**
  - New fields: `role` (original plus nine server renditions), `parent_file_id`, `sha256_verified_at`, `duration_ms`, `page_count`, `width` / `height` and `media_state`.
  - `ScanStatus` gains `sanitised` (a CDR rendition is served; ADR-0018).
- **`Mapping`:**
  - `cycle_id` is replaced by `framework_version_id`. `rationale` is replaced by `note`; `return_note` is separate, so a return can never overwrite the owner's text.
  - `mapped_by` / `confirmed_by` are replaced by `owner_confirmed_*` and `validated_*`, plus `validator_role`.
  - New fields: `ai_suggestion_id`, `locator_snapshot` and `version`.
- **`MappingStatus`** = owner_confirmed | validated | returned | revoked. **`MappingSource`** = ai_accepted | manual.
- **`MappingAction.action`** = revoke (owner) | validate | return (director or an assigned committee member, **acr ≥ 2**). `confirm` and `reject` are gone: the owner confirms by accepting or adding, and a validator returns. `actOnMapping` requires `If-Match`.
- **`createMapping`** (manual add by the owner) creates the mapping directly as `owner_confirmed` and requires `Idempotency-Key`.

### Added (28 operations — 49 → 74 in total)

| Area | Operations |
|---|---|
| Uploads | `createUpload`, `getUpload`, `signUploadParts`, `completeUpload`, `abortUpload` |
| AI | `requestEvidenceAnalysis`, `getEvidenceAnalysis`, `listEvidenceSegments`, `listEvidenceSuggestions`, `acceptSuggestion`, `acceptSuggestions` (accept all clear, gated per indicator), `rejectSuggestion` (6 reason codes) |
| Offline | `getChanges` (delta sync with tombstones; the server wins) |
| Notifications | `listNotifications`, `markNotificationsRead`, `getNotificationPreferences`, `updateNotificationPreferences` |
| Devices | `listDeviceSessions`, `registerPushToken`, `removePushToken`, `revokeDeviceSession` |
| Coverage | `getCoverage` (person / school / area; school and area are counts only) |
| Committee | `listAssignmentEvidence`: confirmed evidence per indicator, with **no AI confidence and no rationale** |
| Exports | `listDpaSlotProfiles`, `createExport` (dpa_pack / pa2_workbook / portfolio_portable, pre-flight first), `getExport`, `getExportDownloadUrl`, `listExports` |

### Tagged `x-seip-feature: v2` (kept, frozen, excluded from the v1 bundles)

`submitMyScores`, `getAssignmentResults` and all seven report operations (`list/create/getReport`, `listReportApprovals`, `approveReport`, `returnReport`, `getReportPdf`). ADR-0017: scoring is v2, and its code stays compiled behind `FEATURE_SCORING=false` with its tests in a `frozen` CI job.

### Kept as they are

Members, taxonomy, cycles/rounds, agreements (PA1 and ประเด็นท้าทาย, which are in v1 scope), `listAssignments` / `createAssignment` / `getAssignment` (committee set-up), and `getEvidenceFileDownloadUrl`. The auth operations stay but carry `x-seip-sunset: P1`, because Keycloak with a BFF session replaces them (ADR-0014). That removal will be a separate breaking change once the P1 Keycloak e2e passes, so it is not part of this CCR.

## Verification of the draft

| Check | Result |
|---|---|
| `redocly lint` (the gate's linter), openapi-4.0.0 | valid, 0 warnings |
| `redocly lint`, internal-ai-0.1.0 | valid |
| `openapi-typescript@7` codegen | generates |
| `oasdiff breaking` 3.1.0 → 4.0.0 (via `scripts/security/check-contract-compatibility.mjs`) | **87 breaking items**, accepted because the major version is bumped. Every one is on the evidence, mapping or upload surface: 30 enum additions, 25 + 13 removed response properties, 5 new required headers (`Idempotency-Key` / `If-Match`), 4 removed request properties, 3 removed paths, and 5 enum removals. **None** touches members, taxonomy, cycles, agreements or auth. |
| Dart client: swagger_parser 1.45.0 + retrofit_generator 10.2 + json_serializable 6.14 (SEIP-P0-004 spike) | **pass**: 16 clients, 74 requests and 170 models generate; `build_runner` builds; `dart analyze --fatal-infos` is clean; 4 decode tests pass. CI now runs this as `Gate: dart client`. The fallback (openapi-generator) is **not needed**. |

### What the S3 conformance suite established for the upload operations

The server opens multipart uploads **without** `ChecksumAlgorithm`. Each `signUploadParts` URL signs `x-amz-checksum-sha256` as a header, so the store verifies every part. Whole-object integrity is the worker's re-hash against `UploadCreate.checksum_sha256`. No contract field changes; this is a server-side implementation rule (ADR-0013 conformance results).

### What the Dart spike changed in the draft

1. **`SyncChange.data` (a `oneOf` with no discriminator) became one nullable property per entity.** swagger_parser compiled the oneOf, but as *try each type in order, take the first that parses*. That can bind a row to the wrong type when two schemas share their required fields. With `evidence` / `evidence_file` / `analysis` / `suggestion` / `mapping` / `notification` as separate fields, decoding is unambiguous in every generator, and a tombstone is simply all null.
2. **`MemberInvite.personnel` was extracted to `MemberInvitePersonnel`.** Two inline `personnel` objects collided and produced a type called `Personnel2`. The wire shape is unchanged.

### Found while doing this: the contract gate could pass without checking anything

`check-contract-compatibility.mjs` ran oasdiff through `docker run`, and parsed `result.stdout || '[]'`. When the image pull failed (Docker Hub 429, exit 125), stdout was empty, so the script compared nothing and reported **"no breaking changes"**. Exactly that happened on this draft's first run: 87 real breaks were reported as none. The same code runs in CI on every push.

Fixed in this change: a non-0/1 exit or empty output now fails the gate. oasdiff prints `[]` when there is nothing to report, so empty output is never a valid answer. Verified both ways: identical specs pass, and a docker that exits 125 fails.

## Permissions delta (permissions.yaml → 2.0.0 when applied)

| Operation | teacher / deputy | director | school_admin | committee | area_admin / dpo | min acr |
|---|---|---|---|---|---|---|
| upload ops, `requestEvidenceAnalysis` | own | own | school | — | — | 1 |
| `getEvidenceAnalysis`, `listEvidenceSuggestions` | own (full) | school (no `calibrated_p` / `rationale_th`) | school (same) | — | — | 1 |
| `listEvidenceSegments` | own | school | school | committee (redacted text) | — | 1 |
| `acceptSuggestion(s)`, `rejectSuggestion` | **own only** | own only | — | — | — | 1 |
| `actOnMapping` revoke | own | own | — | — | — | 1 |
| `actOnMapping` validate / return | — | school | — | committee | — | **2** |
| `getChanges`, notifications, devices, preferences | self (any authenticated) | self | self | self | self | 1 |
| `getCoverage` person | own | school | school | committee | area-r | 1 |
| `getCoverage` school / area | — | school | school | — | area-r (counts) | 1 |
| `listAssignmentEvidence` | — | school | school | committee | — | 1 |
| `listDpaSlotProfiles` | any authenticated | | | | | 1 |
| `createExport` (self) | own | own | own | — | — | 1 |
| `createExport` (another person) | — | school | school | — | — | **2** |
| `inviteMember`, `endMembership`, `createAssignment` | (unchanged roles) | | | | | **2** |

New mechanism: `min_acr` per operation (or per action). If the token's `acr` is lower, the response is `403 AUTH-006`, and the client re-authenticates with `acr_values` (ADR-0014). Until Keycloak lands in P1, every session counts as acr 1, so in P0 these operations are reachable only through the existing role checks. That is the same exposure as today, not a new one.

## Error codes delta (error-codes.yaml → 2.0.0)

| Code | HTTP | Meaning |
|---|---|---|
| AUTH-006 | 403 | Step-up authentication required (acr below `min_acr`) |
| RES-004 | 412 | If-Match is stale |
| RES-005 | 428 | If-Match is required |
| IDEMP-001 | 422 | Idempotency-Key reused with a different request body |
| UPL-007 | 409 | Upload session not open (completed, aborted or expired) |
| UPL-008 | 422 | Complete called with parts missing |
| AI-002 | 429 | Analysis re-run throttled (once per 10 min) |
| AI-003 | 409 | Suggestion is not open |
| AI-004 | 422 | Batch accept is not enabled for this indicator (gate not passed) |
| EXP-001 | 422 | Export pre-flight found blocking errors |
| EXP-002 | 409 | Export not ready |
| SYNC-001 | 410 | Sync cursor too old; resync from scratch |

Changed meanings:
- **MAP-001** is now keyed on the framework version, not the cycle.
- **MAP-002** now means that validate or return requires `owner_confirmed`.

Retired: **AI-001** (synchronous suggest no longer exists).

## Events delta (events.yaml → 2.0.0)

Added:
- `evidence.file.verified`
- `analysis.completed`
- `analysis.failed`
- `mapping.owner_confirmed`
- `mapping.validated`
- `mapping.returned`
- `export.ready`

Kept: `evidence.file.scan_completed`, `ai.suggestion.created`.

Retired, because the states they describe no longer exist:
- `evidence.mapping.suggested`
- `evidence.mapping.confirmed`
- `evidence.mapping.rejected`

`evidence.mapping.revoked` is renamed to `mapping.revoked`. The v2-tagged events (`assignment.*`, `round.closed`, `report.*`) stay, under the same feature tag.

## Migration plan (after approval)

This contract has one consumer: the web app in this repository. ADR-0004 says single deployment, and there are no external API clients. The pilot data does not exist yet: P2 is the first phase with real teachers. So the migration is a code change, not a data migration of production rows.

| Step | Phase | What |
|---|---|---|
| 1 | P0 wk 2 | **Done.** Dart client spike against the draft; two findings folded back (see above). |
| 2 | P1 | Apply: move the draft over `openapi.yaml`, bump the other three contracts, regenerate the TS types, and land the data-model delta. The data-model delta covers `person` and `evidence` ownership, `framework_version_id` on mappings, `upload_session`, `idempotency_key` and `version` columns. Rewrite the evidence, mapping and upload routes, and move the web pages to the new types. |
| 3 | P1 | `FEATURE_SCORING` flag. The v2 routes are registered only when it is true, and a `frozen` CI job runs their tests. |
| 4 | P2 | Upload sessions and multipart, plus sync and devices, used by Flutter. |
| 5 | P3 | Analysis, segments, suggestions, the internal AI contract and the GPU worker. |
| 6 | P4–P5 | Committee evidence view, validate and return, notifications, coverage, and exports. |

Operations are added as the phases need them. The 4.0.0 contract is applied in one step at P1, but routes the code does not implement yet return `501` from a single generated stub. The authz-coverage gate keeps every operation in `permissions.yaml` from day one.

## Self-review (contract-policy.md: the four checks)

1. **Backend feasibility.** Every new field maps to a column in the design brief's data-model delta (§Data model). The partial unique `(evidence, indicator, framework_version) WHERE status <> 'revoked'` replaces today's index on `cycle_id` and needs no trigger. Upload sessions need only `CreateMultipartUpload`, `UploadPart` presign, `ListParts` and `CompleteMultipartUpload`. SeaweedFS 4.48 and S3 support all four; the P0 conformance suite (ADR-0013 §4) checks this.
2. **Frontend usability.** Field trace: the suggestion inbox needs `band`, `batch_acceptable`, `locators` and the owner-only `rationale_th` and `calibrated_p`. The split view needs `Locator.page` / `t_start_ms`, `listEvidenceSegments` and `listAssignmentEvidence`. The DPA builder needs `DpaSlotProfile.slots[]` and `ExportPackage.preflight[]` with `rule_verified`. The offline outbox needs `client_uuid`, `Idempotency-Key`, `If-Match`, `getChanges` and `sha256_verified_at`.
3. **Security baseline.**
   - AI confidence and rationale are hidden from everyone but the owner.
   - The committee view carries no AI fields.
   - Every validate, return or cross-person export requires acr ≥ 2.
   - Push carries no content.
   - Notifications and devices are always self-scoped.
   - The internal AI contract is pull-only over mTLS, holds no database credentials, and gets redacted text.
4. **Error and permission consistency.** Every new operation has a row in the permissions delta, and every non-2xx in the draft maps to a code in the error delta. `401` is on every operation, `403` on every scoped one, and `404` wherever a path id is resolved.

## Owner decision (2026-10-12)

The owner approved CCR-017. Questions 2 and 3 below were not answered separately, so the drafted defaults stand. The owner can change either at any time; both are permission or grant rows, not contract shape.

- **Q2:** director or school_admin may build another person's export, with acr ≥ 2.
- **Q3:** the committee gets `view_derivative` by default, and the owner grants originals per item.

## Applied (SEIP-P1-001, 2026-10-12)

Steps 2 and 3 of the migration plan are done in one change on `claude/remote-control-5aclif`. `openapi.yaml` is 4.0.0 (74 operations), and permissions, error-codes and events are each 2.0.0. The TS types and the Dart client are regenerated from them.

### What changed between the approved draft and what was applied

None of these changes widens a grant or adds a breaking shape beyond the approved draft.

- **`Evidence.controller_area_id` is nullable.** A school without an ESA has no area to name. The draft had it required.
- **`UploadPartUrlsRequest.checksums_sha256` is new and optional.** It holds base64 SHA-256 values aligned with `part_numbers`. When present, each presigned part signs `x-amz-checksum-sha256`, and the store refuses a part whose bytes differ. The conformance suite and `evidence-flow.test.mjs` both prove this against SeaweedFS. Without it, the draft promised per-part integrity that a presign could not carry.
- **Query parameters fixed:** `listEvidence` takes `owner_person_id`, and `listMappings` takes `framework_version_id`. The draft still named the 3.x `owner_personnel_id` and `cycle_id`.
- **`createMapping` declares the 200 replay response,** like every other `Idempotency-Key` create.
- **The baseline migration is folded, not appended.** Nothing is deployed (pre-production, ADR-0012), so `20261013000000_init` and `…0100_constraints` were regenerated rather than adding a third migration on top.
- **`listAssignmentEvidence` is phase-gated (P4)** with the other 22 unbuilt operations. All 23 answer `501 SYS-003` after authentication. The permission sweep asserts every one of them.
- **Validate and return are served now (P1),** not at P4–P5 as step 6 said. The two-tier mapping is the core of "upload once, reuse across indicators", and reports already read only `validated` mappings. Leaving validation unbuilt would have left reports empty.
- **`min_acr` is declared but not enforced yet.** Step-up authentication (ADR-0014) lands with the Flutter login in P2. Until then a validate or return succeeds at acr 1. This is the one place where the served behaviour is weaker than the contract text, and it is recorded on the board.
- **No separate `frozen` CI job.** The integration, permission and e2e jobs run with `FEATURE_SCORING=true`, so the v2 code keeps its tests. `apps/api/test/feature-flags.test.mjs` proves that with the flag off, the v2 routes are not registered.

### Behaviour worth knowing

- **Ownership is the person** (ADR-0015), so a teacher's portfolio survives a transfer. A caller whose only route to an item is an `own` grant they do not hold for that item gets `RES-001`, not `PERM-001`, so the item's existence never leaks. `PERM-001` remains for "you can see this school, but your role may not do this". An area_admin over the school's area counts as being able to see it.
- **The worker re-hashes every stored original** against `checksum_sha256`. A match sets `sha256_verified_at` and `media_state=ready`. A mismatch blocks the file and sets `media_state=failed`.

## Open questions for the owner (as asked)

1. **Approve CCR-017 (breaking)?** If yes, the draft is applied in P1 (step 2), not now. PR #3 stays mergeable either way, because nothing in force changes.
2. **`createExport` for another person:** the director or school_admin can build a teacher's DPA pack (with acr 2). Is that wanted, or should packs always be teacher-built?
3. **Committee access to originals:** by default the committee sees review renditions (`view_derivative`). The owner can grant originals per item. Is that the right default?
