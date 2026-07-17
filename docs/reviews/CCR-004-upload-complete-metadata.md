# Contract Change Request: CCR-004

## Requested By
claude (SEIP-API-001 implementation)

## Contract Affected
`docs/contracts/openapi.yaml` — `FileUploadComplete` schema. Widening, not breaking.

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
`content_type`, `byte_size`, `original_filename`, `duration_seconds` alongside
`checksum_sha256`. This is additive at the transport level — `openapi.yaml`'s
`FileUploadComplete` schema has no `additionalProperties: false`, so extra fields
don't violate it — but the *contract's implied behavior* (server remembers, client
only confirms) is not what's implemented. Recorded here rather than silently
diverging.

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
No — additive request fields.

## Affected Modules
apps/api (this task), apps/web (must send the widened body — implemented in the
same branch), a future apps/worker (closes the verification gap noted above).

## Approval Status
**APPLIED 2026-07-17** — self-review under ADR-0004. Flagged for the user as a
carried limitation, not silently shipped as if it were complete verification.
