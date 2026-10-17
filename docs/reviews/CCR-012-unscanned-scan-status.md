# CCR-012: `unscanned` scan status — stop reporting an unearned `clean`

## Request
`evidence_file.scan_status` had three values and the platform could only ever
honestly produce two of them. The worker's "virus scan" was:

```ts
// apps/worker/src/jobs/file-process.ts (before)
export function stubScanStatus(originalFilename: string): 'clean' | 'blocked' {
  const lower = originalFilename.toLowerCase();
  if (lower.includes('eicar') || lower.includes('virus')) return 'blocked';
  return 'clean';
}
```

It matched on **filename**, never on content — no bytes were ever read. Every
file not literally named `eicar`/`virus` was recorded `clean`, and that value
drove the UI badge ("ปลอดภัย"), the `evidence.file.scan_completed` event, and the
UPL-006 download gate. The system asserted a clean bill of health it had never
earned, on a PDPA-scoped evidence store.

Found by the 2026-07-18 code audit.

## Decision
Add a fourth state, `unscanned`, meaning **the file was processed and no scanner
ran, so the platform makes no claim**. Remove the filename stub entirely rather
than keep a placeholder that produces a verdict.

`unscanned` is **served exactly like `clean`** — approved by the user
(2026-07-18). The change is disclosure, not restriction: blocking every download
on a deployment with no scanner would stop the product working, and quietly
labelling those files `clean` is what this CCR exists to end. `blocked` and
`pending` remain non-servable.

`blocked` is still reachable without a scanner: the worker marks it when the
stored object's size does not match the declared `byte_size` (see the upload
integrity fix in the same audit).

## Changes
| Surface | Change |
|---|---|
| openapi.yaml | **2.6.0 → 2.7.0** additive: `ScanStatus` enum gains `unscanned`; download + aggregate descriptions updated |
| events.yaml | **1.1.0 → 1.2.0** additive: `evidence.file.scan_completed.scan_status` gains `unscanned` |
| prisma | `ScanStatus` enum + `ALTER TABLE evidence_file MODIFY scan_status` migration |
| packages/database | `setFileScanStatus` accepts `unscanned`; `aggregateScanStatus` worst-of order becomes `pending > blocked > unscanned > clean` |
| apps/worker | `stubScanStatus` deleted; writes `unscanned` (or `blocked` on size mismatch) |
| apps/api | UPL-006 gate allows `clean` **or** `unscanned` |
| apps/web | badge + Thai label for `unscanned`; wording deliberately avoids "ปลอดภัย" |

## Breaking?
**Additive, minor bump.** No field or value is removed and no request shape
changes, so a client that treats `scan_status` as an opaque string is unaffected.

The honest caveat: a client `switch`ing exhaustively over the three old values
will fall through on `unscanned`. In practice `apps/web` is the only consumer and
it is updated in the same change, which is why this is a 2.7.0 rather than a 3.0.0
— the same reasoning recorded in CCR-004 for Sprint 1's lack of external
consumers. A genuine third-party consumer would need notifying, not just a bump.

If oasdiff classifies `response-property-enum-value-added` as ERR, this becomes a
major bump; the gate's verdict wins over this note.

## Consequence worth stating plainly
After this change, on any deployment without a scanner, **every uploaded file
reports `unscanned` and is still downloadable**. That is the pre-existing risk
made visible, not a new one — previously identical files reported `clean`. The
remaining work is wiring a real scanner (ClamAV via `clamd`), at which point
`unscanned` should become rare and its presence in production is a signal that
the scanner is down or unconfigured.

## Related
- Audit finding "HIGH-1 — Malware scanning is a stub that defaults to clean"
- `docs/contracts/contract-policy.md` (CCR + bump requirement)
- Upload-integrity fix (declared size verification) — same audit, commit `1906505`
