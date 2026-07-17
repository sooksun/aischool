# CCR-009: List scan_status + AssignmentDetail.framework_version_id (cleanup B1–B2)

## Request
Eliminate client-side workarounds that caused N+1 list detail fetches and
O(cycles×rounds) framework discovery for scoring.

## Changes
| Surface | Change |
|---|---|
| openapi.yaml | **2.3.0 → 2.4.0** additive: `Evidence.scan_status` (nullable aggregate); `AssignmentDetail.framework_version_id` (required on detail) |
| Implementation | listEvidence includes file scan statuses; getAssignment returns cycle's framework_version_id |

## Breaking?
No — additive response fields only (oasdiff should be clean).

## Related
B3 (authorized download helper) is client-only — no contract change.
