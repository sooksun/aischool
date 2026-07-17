# Contract Change Request: CCR-004

## Requested By
claude (SEIP-API-001 implementation; contract actually applied during SEIP-UI-001 when apps/web's typecheck required the generated types to match reality)

## Contract Affected
`docs/contracts/openapi.yaml` — `FileUploadComplete` schema.

**Correction (2026-07-17, same day):** this CCR originally shipped only as a
code comment in `apps/api` — the YAML file itself was never edited to match, so
`openapi.yaml` silently described a narrower contract than the API actually
required. It also *claimed* "widening, not breaking" without running it through
`oasdiff`. When the schema was finally edited to match reality (while wiring
`apps/web`'s generated types), `oasdiff breaking` correctly flagged it: adding
new **required** request properties breaks any client that conformed to the old,
narrower requirement. Self-corrected rather than silencing the gate — see
Breaking Change below. This is exactly the class of drift contract-first
development exists to prevent, caught by actually running the tool instead of
asserting the outcome.

## Reason
`completeFileUpload`'s request body (`FileUploadComplete`) has one field:
`checksum_sha256`. But the handler needs `content_type`, `byte_size`,
`original_filename`, and `duration_seconds` too — to build the same object key the
presigned URL was issued for, and to re-validate against the evidence category's
mime/size/duration rules a second time (`initiateFileUpload` validates once,
client-side-declared, before bytes move; `completeFileUpload` is meant to be the
point where the server can no longer be lied to about what actually got uploaded —
except this API doesn't yet call `HeadObject` on MinIO to read the real values back,
so "no longer be lied to" isn't fully true yet either — see Known Limitations below).

The contract implicitly assumed a server-side upload session (initiate's metadata
remembered server-side, complete just confirms) — but nothing in the data model or
this task's scope provisioned that session store, and adding one (Redis, or a
DB table with a TTL) is disproportionate for a 15-operation MVP slice.

## Resolution
`completeFileUpload`'s request body is **widened**: the client resends
`content_type`, `byte_size`, `original_filename` (all now **required**) and
`duration_seconds` (nullable) alongside `checksum_sha256`. `openapi.yaml` is
edited to match — the schema is the source of truth apps/web's generated types
are built from, so it cannot describe a narrower contract than the API enforces.

## Known Limitations (carried forward honestly, not hidden)
1. **The server does not re-read the uploaded object from MinIO** to verify
   `byte_size`/`content_type` match what was actually stored — it trusts the second
   client declaration exactly as much as it trusted the first. A malicious or buggy
   client could declare different values at complete than what it actually PUT.
   Mitigated partially by checksum (if the client lies about size/type but the
   checksum is of the REAL bytes, a scan/probe step could still catch a mismatch),
   but this is not full server-side verification.
2. **Video duration probing is not implemented** (no worker yet — `x-deferred`
   scope was contracts, not this task). `duration_seconds` is accepted from the
   client only; UPL-003 enforcement is therefore client-reported, not
   server-verified, until a worker exists to probe the real file.
3. Follow-up task (not created yet, noted for the next planning pass): implement
   an `apps/worker` job that HEADs/probes the object after upload and corrects
   `byteSize`/`durationSeconds`/rejects on mismatch — this closes both gaps above
   and is also what `evidence.file.registered` (events.yaml) exists to trigger.

## Breaking Change
**Yes — corrected from an initial "no" claim.** `oasdiff breaking` (run for real,
not asserted): 3 findings, all `new-required-request-property`. Accepted because
Sprint 1 has no real external consumer of this contract yet (apps/api and
apps/web are built in the same change) — a genuine external consumer at this
point would require a real migration plan, not just a version bump. Version
bumped `1.0.0 -> 2.0.0` per `contract-policy.md`'s stated rule for breaking
changes. `scripts/security/check-contract-compatibility.mjs` (new, this CCR)
makes that rule an automated CI check instead of a purely human-trusted one —
the original `contract-compatibility` gate had no mechanism to accept ANY
breaking change, even a deliberate, disclosed, correctly-versioned one, which
meant the policy's own documented process was unimplementable through the gate
as it stood.

## Affected Modules
apps/api (this task), apps/web (must send the widened body — implemented in the
same branch), a future apps/worker (closes the verification gap noted above),
`.github/workflows/ci.yml` (contract-compatibility gate logic).

## Approval Status
**APPLIED 2026-07-17** — self-review under ADR-0004. Flagged for the user as a
carried limitation (§Known Limitations), not silently shipped as if it were
complete verification. Version bump ratified by the same merge that ratifies
the rest of this branch.
