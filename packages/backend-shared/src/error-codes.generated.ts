// GENERATED FILE — do not edit by hand.
// Source of truth: docs/contracts/error-codes.yaml (version pinned below).
// Regenerate: npm run codegen:contracts
// Drift check: npm run gate:contracts (fails CI if this file disagrees with the source)

export const ERROR_CODES_VERSION = '2.1.0';

export type ErrorCode =
  | 'AUTH-001'
  | 'AUTH-002'
  | 'AUTH-003'
  | 'AUTH-004'
  | 'AUTH-006'
  | 'AUTH-007'
  | 'AUTH-005'
  | 'PERM-001'
  | 'PERM-002'
  | 'PERM-003'
  | 'PERM-004'
  | 'VAL-001'
  | 'VAL-002'
  | 'VAL-003'
  | 'UPL-001'
  | 'UPL-002'
  | 'UPL-003'
  | 'UPL-004'
  | 'UPL-005'
  | 'UPL-006'
  | 'UPL-007'
  | 'UPL-008'
  | 'MAP-001'
  | 'MAP-002'
  | 'MAP-003'
  | 'MAP-004'
  | 'SCORE-001'
  | 'SCORE-002'
  | 'SCORE-003'
  | 'SCORE-004'
  | 'SCORE-005'
  | 'CYCLE-001'
  | 'CYCLE-002'
  | 'CYCLE-003'
  | 'RPT-001'
  | 'RPT-002'
  | 'RPT-003'
  | 'AI-002'
  | 'AI-003'
  | 'AI-004'
  | 'AGR-001'
  | 'AGR-002'
  | 'RES-001'
  | 'RES-002'
  | 'RES-004'
  | 'RES-005'
  | 'IDEMP-001'
  | 'EXP-001'
  | 'EXP-002'
  | 'SYNC-001'
  | 'RES-003'
  | 'SYS-001'
  | 'SYS-002'
  | 'SYS-003';

export const ERROR_CODE_TABLE: Record<ErrorCode, { http: number; meaning: string }> = {
  'AUTH-001': { http: 401, meaning: "Missing or malformed credentials/token" },
  'AUTH-002': { http: 401, meaning: "Token expired" },
  'AUTH-003': { http: 401, meaning: "Account disabled or not yet activated" },
  'AUTH-004': { http: 429, meaning: "Too many login attempts — throttled per IP and/or account (SEC-AUTH-5)" },
  'AUTH-006': { http: 403, meaning: "Step-up authentication required — token acr is below the operation's min_acr (ADR-0014)" },
  'AUTH-007': { http: 403, meaning: "Cookie session write without a matching X-CSRF-Token (CCR-018)" },
  'AUTH-005': { http: 401, meaning: "Invite token not usable — unknown" },
  'PERM-001': { http: 403, meaning: "Role not allowed for this operation (permissions.yaml matrix)" },
  'PERM-002': { http: 403, meaning: "Cross-school access denied (tenancy) — resource belongs to another school" },
  'PERM-003': { http: 403, meaning: "Not a committee member of this assignment" },
  'PERM-004': { http: 403, meaning: "Area-scoped role attempted write outside read-only scope" },
  'VAL-001': { http: 400, meaning: "Malformed request body or query (schema violation) — details[] lists fields" },
  'VAL-002': { http: 422, meaning: "Semantically invalid (valid shape" },
  'VAL-003': { http: 422, meaning: "Referenced entity belongs to an incompatible framework version" },
  'UPL-001': { http: 422, meaning: "Content type not allowed for the evidence category" },
  'UPL-002': { http: 422, meaning: "File exceeds size limit for the category" },
  'UPL-003': { http: 422, meaning: "Video duration exceeds category maximum (e.g. problem/inspiration video > 600s)" },
  'UPL-004': { http: 409, meaning: "Upload already completed for this file id" },
  'UPL-005': { http: 422, meaning: "Checksum mismatch between initiate and complete" },
  'UPL-006': { http: 423, meaning: "File quarantined — virus scan not clean" },
  'UPL-007': { http: 409, meaning: "Upload session not open — completed" },
  'UPL-008': { http: 422, meaning: "Complete called with parts missing (server ListParts disagrees with part_count)" },
  'MAP-001': { http: 409, meaning: "A live mapping already exists for (evidence" },
  'MAP-002': { http: 422, meaning: "Action not allowed in the mapping's state — validate/return need owner_confirmed; revoke needs a live mapping" },
  'MAP-003': { http: 422, meaning: "Indicator not scorable/mappable (workload gate rows cannot be mapped)" },
  'MAP-004': { http: 422, meaning: "Evidence and cycle framework versions incompatible" },
  'SCORE-001': { http: 422, meaning: "Committee incomplete — scoring requires exactly 3 members" },
  'SCORE-002': { http: 409, meaning: "Round is closed — scores immutable" },
  'SCORE-003': { http: 422, meaning: "Rubric level out of range (must be 1..4)" },
  'SCORE-004': { http: 422, meaning: "Workload gate not declared before score submission" },
  'SCORE-005': { http: 422, meaning: "Score set incomplete — all scored indicators of the framework part required in one submission" },
  'CYCLE-001': { http: 422, meaning: "Invalid round state transition (planned→open→scoring→closed only)" },
  'CYCLE-002': { http: 409, meaning: "Overlapping active cycle for (school" },
  'CYCLE-003': { http: 422, meaning: "Round period outside cycle bounds" },
  'RPT-001': { http: 422, meaning: "Invalid report request — unknown template" },
  'RPT-002': { http: 422, meaning: "Report PDF not ready — still draft or generation_status pending" },
  'RPT-003': { http: 422, meaning: "Approval not permitted — report not pending_approval" },
  'AI-002': { http: 429, meaning: "Analysis re-run throttled — at most once per 10 minutes per evidence" },
  'AI-003': { http: 409, meaning: "Suggestion is not open (already accepted" },
  'AI-004': { http: 422, meaning: "Batch accept not enabled for this indicator — its pre-tick gate has not passed" },
  'AGR-001': { http: 409, meaning: "An agreement already exists for this (cycle" },
  'AGR-002': { http: 422, meaning: "Agreement not in a state that allows this — content freezes on submit" },
  'RES-001': { http: 404, meaning: "Resource not found (or hidden by tenancy — indistinguishable by design)" },
  'RES-002': { http: 409, meaning: "Concurrent modification (stale version/etag)" },
  'RES-004': { http: 412, meaning: "If-Match is stale — the resource changed since it was read" },
  'RES-005': { http: 428, meaning: "If-Match is required for this write" },
  'IDEMP-001': { http: 422, meaning: "Idempotency-Key reused with a different request body" },
  'EXP-001': { http: 422, meaning: "Export pre-flight found blocking errors" },
  'EXP-002': { http: 409, meaning: "Export not ready" },
  'SYNC-001': { http: 410, meaning: "Sync cursor too old — resync from scratch" },
  'RES-003': { http: 409, meaning: "Duplicate — an active membership already exists for this (school" },
  'SYS-001': { http: 500, meaning: "Unexpected server error — request_id always present" },
  'SYS-002': { http: 503, meaning: "Dependency unavailable (storage" },
  'SYS-003': { http: 501, meaning: "Operation is in the contract but not served yet — phase-gated (CCR-017 migration plan)" },
};

export function httpStatusFor(code: ErrorCode): number {
  return ERROR_CODE_TABLE[code].http;
}
