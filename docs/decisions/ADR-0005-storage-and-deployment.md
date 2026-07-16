# ADR-0005: Object Storage (MinIO / S3-compatible) and On-Premise Deployment

## Status
Accepted

## Context

Two questions were carried open through all of Sprint 0 and now block SEIP-DB-001's evidence storage columns and Sprint 1's infra:

- **OPEN-4** — which object storage? Recorded risk: "video storage can grow quickly". DPA evidence includes mp4 teaching videos (ว9), so this is not hypothetical.
- Deployment target was never decided, yet it determines the PDPA story for `sensitive`-class data (learner images, voices, work).

`PROJECT_STATE.md` records "uploaded evidence contains personal data"; `SECURITY-BASELINE.md` SEC-PDPA-6 requires an ADR before data leaves Thailand-resident storage.

## Decision

Per the user's direction on 2026-07-17:

1. **Object storage: MinIO**, self-hosted, accessed strictly through its **S3-compatible API**.
2. **Deployment: on-premise** at the school / education service area.
3. The application codes against the **S3 API surface only** (presigned PUT/GET, object key, bucket). No MinIO-proprietary feature may be used. Consequence: migrating to AWS S3, Cloudflare R2, or any S3-compatible service later is a configuration change, not a code change.
4. Evidence bytes **never** enter PostgreSQL and never pass through the API process (SEC-UPL-1). The database stores `storageProvider` + `storageUri` metadata only, exactly as designed in `entity-dictionary.md` §5.2.
5. Local development runs the same components via `docker-compose` (PostgreSQL + MinIO) so dev and on-prem production differ in configuration, not architecture.

## Options Considered

1. **MinIO self-hosted (chosen)** — learner data never leaves hardware the school controls, which is the cleanest possible PDPA position; S3 API keeps the exit door open; runs under Laragon/docker for dev at no cost. Cost: the school must operate and back up the server.
2. AWS S3 / Cloudflare R2 — managed and effortless to scale, but places personal data of minors with a foreign processor, requiring a PDPA cross-border assessment (SEC-PDPA-6) and incurring per-GB egress for video review traffic. Rejected for now; reachable later without code changes precisely because of decision #3.
3. Local filesystem — simplest, but has no presigned-URL equivalent, so files would have to stream through the API process. That directly violates SEC-UPL-1 and would not survive video-sized objects. Rejected.

## Consequences

- **DB-001 is unblocked**: `EvidenceFile.storageProvider` / `storageUri` columns are confirmed as designed; no schema change needed for this decision.
- **Sprint 1 infra**: `docker-compose.yml` provides PostgreSQL + MinIO for dev; the storage adapter is written against the S3 API.
- **New operational obligations for on-prem** (must be planned before go-live, not at go-live):
  - Backup and restore of *both* PostgreSQL and the MinIO object store — the release gate "backup/restore test" in `QUALITY-GATES.md` now has a concrete subject, and evidence is irreplaceable (a teacher cannot re-record last term's class).
  - Disk growth monitoring for video; retention enforcement per `entity-dictionary.md` (`evidence+N`, default N=5) becomes a real cost control, not just a privacy rule.
  - TLS on the internal endpoint; MinIO credentials handled as secrets (never in git — SEC-REPO-1).
- **PDPA**: SEC-PDPA-6 is satisfied by construction while this ADR holds — data stays on Thai soil, on school-controlled hardware. Any move to option 2 requires superseding this ADR.
- **OPEN-4 is closed.** OPEN-3 (AI provider + PDPA residency for the Sprint 2 mapping engine) remains open and is *not* resolved by this ADR — sending evidence text/images to a foreign AI provider would cross the same border this decision avoids, and needs its own ADR.

## Approved By
User (2026-07-17), recorded by Claude

## Date
2026-07-17
