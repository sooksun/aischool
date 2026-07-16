# Security Baseline Pass — Contract Lock (SEIP-ARCH-002)

Date: 2026-07-17 · Reviewer: claude (self-review per ADR-0004) · Subject: contracts v1.0.0
Trigger: `SECURITY-BASELINE.md` §Review cadence — "ARCH-002 (contract lock): full pass over §2 and §3 against final contracts"

## §2 Tenant / school data isolation

| ID | Requirement | Contract evidence | Verdict |
|---|---|---|---|
| SEC-TEN-1 | school-scoped by construction | **No endpoint takes `school_id` as a path/query parameter** — school is derived from the token's membership. A caller cannot address another school's scope even by URL manipulation; the repository filter (Sprint 1) becomes the only place it could go wrong. | ✅ contract supports |
| SEC-TEN-2 | cross-school → RES-001 not-found | `permissions.yaml` tenancy rule + openapi `NotFound` response: "not found or cross-tenant (indistinguishable by design)". PERM-002 reserved for same-school role denials only. | ✅ |
| SEC-TEN-3 | area_admin read-only | Verified line-by-line: `area_admin` appears with `area-r` only, and is **absent from all 11 write operations** (createCycle, updateCycle, createRound, updateRound, createEvidence, updateEvidence, deleteEvidence, initiate/completeFileUpload, createMapping, actOnMapping, createAssignment, submitMyScores). PERM-004 covers attempts. | ✅ |
| SEC-TEN-4 | evaluators only via CommitteeMember | `evaluator: committee` on every scoring/evidence-read operation; PERM-003 defined. | ✅ |
| SEC-TEN-5 | matrix is the test fixture | Stated in the `permissions.yaml` header as of this lock; **enforced today** by the new authz-coverage check in `gate:contracts` (27 operations = 25 matrix rules + 2 explicit exemptions). | ✅ upgraded from intent to gate |

**Finding QA-001 (S4, resolved in this task).** `login` and `getCurrentUser` had no matrix row. Neither is a defect — `login` is public by design and `getCurrentUser` is self-scoped — but the *intent was undocumented*, which is indistinguishable from an oversight. Fixed: both are now explicit exemptions in `permissions.yaml` with their own security conditions (login: throttle + no user enumeration; getCurrentUser: must never accept a user id parameter). The gate now fails if any future endpoint lacks a rule.

## §3 File-upload security

| ID | Requirement | Contract evidence | Verdict |
|---|---|---|---|
| SEC-UPL-1 | bytes never through the API | `FileUploadTarget` issues a presigned target; client PUTs directly to storage. **`storage_provider` / `storage_uri` are absent from every response schema** — the storage location never leaves the server, so a client cannot address the bucket directly. | ✅ |
| SEC-UPL-2 | server validates regardless of client | UPL-001..003 defined; CCR-002 made `duration_seconds` nullable **with the server-side probe as the authority** — so a client that lies or omits duration cannot bypass the ≤10-minute rule (ว9). | ✅ |
| SEC-UPL-3 | scan before servable | `EvidenceFile.download_url` documented null until `scan_status=clean`; UPL-006 + `evidence.file.scan_completed` event notify on block. | ✅ |
| SEC-UPL-4 | checksum verified | `FileUploadComplete.checksum_sha256` must equal the initiate value (UPL-005). | ✅ |
| SEC-UPL-5 | safe serving headers | **Not expressible in the contract** — deployment/header concern. Carried to Sprint 1 as an e2e header test (already listed in the baseline). | ⏭ deferred, tracked |
| SEC-UPL-6 | rate limit + unguessable keys | Keys: `file_id` is a server-issued uuid, client filename never becomes the key. Rate limiting is infra-level, not contract. | ✅ / ⏭ partial |

## Framework-fidelity check (evaluator attribution)

`getAssignmentResults` returns per-evaluator rows including `evaluator_user_id`, and `teacher: own` may read them. Question raised: does exposing *which evaluator gave which score* to the evaluatee violate privacy expectations?

**Verified against the source (ว9 manual, PA 2/ส form, p.78 of the PDF):** each committee member completes and signs their **own** PA2 form — "(ลงชื่อ)......... กรรมการผู้ประเมิน" appears once per form, per evaluator. Per-evaluator attribution is inherent to the paper process the system digitizes, and the ≥70%-from-each-evaluator rule is only auditable if the evaluatee can see the individual results. **No change required.** Recorded here so the decision is not re-litigated later.

## Residual risk accepted at lock

1. **Enforcement is unproven** — every ✅ above says the *contract permits* correct behavior; none says code does it. The permission-tests gate is self-arming and stays unarmed until `tests/security/*` land in Sprint 1. This is the single largest carried risk out of Sprint 0 and the reason SEC-TEN-5 (matrix-as-fixture) exists.
2. **SEC-UPL-5 / rate limiting** are infra-level and unverifiable until a deployment exists.
3. **OPEN-4 (object storage)** unresolved — presigned-URL semantics differ per provider (expiry, resumability); the contract is provider-agnostic but the first adapter may surface detail (would be additive, 1.x).

## Verdict

Contracts v1.0.0 are **consistent with the security baseline** for everything a contract can carry. One S4 finding raised and closed within this task. Approved for lock, subject to user ratification.
