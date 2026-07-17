# Contract Change Request: CCR-003

## Requested By
claude (SEIP-API-001 implementation)

## Contract Affected
`docs/contracts/openapi.yaml` — clarification, not a breaking or additive field change.

## Reason
No school-scoped operation (evidence, mappings, cycles, assignments) takes a `school_id`
path or query parameter — by design (ARCH-001: "school is derived from the token's
membership", `permissions.yaml` tenancy rule). But `CurrentUser.memberships` is an
**array** — a user can hold memberships at more than one school (e.g. an evaluator
invited from another school for one committee). The contract never specified how a
request resolves *which* school is "current" when the caller has more than one
active school-scope membership. This is an implementation-blocking gap, not a
hypothetical: `apps/api` cannot resolve tenancy for a single-school caller vs. a
multi-school caller without a rule.

## Resolution (documented here, implemented in `apps/api/src/plugins/auth.ts`)
1. If the caller has exactly **one** active `membership_scope=school` membership,
   that school is the implicit current school for every school-scoped request.
2. If the caller has **more than one**, the request must carry an `X-School-Id`
   header naming one of them; requests without it get `VAL-002` ("semantically
   invalid — ambiguous school context"). This is additive to the transport (a
   header, not a body/query field), so it does not change any schema in
   `openapi.yaml`.
3. If the caller has **zero** active school memberships (e.g. a pure `area_admin`),
   school-scoped write operations are unreachable for them anyway per the
   `permissions.yaml` matrix; school-scoped *reads* they're entitled to
   (`area_admin: area-r`) are resolved per-resource, not per-request, and don't need
   a "current school" at all.
4. The header, when present, is validated against the caller's own memberships —
   supplying an arbitrary school id there does **not** grant access to it (PERM-002
   if it doesn't match an active membership).

## Breaking Change
No. Adds an optional header only meaningful to multi-school callers, who are
rare in practice (single-school teachers/directors are the overwhelming majority).

## Affected Modules
apps/api (auth plugin), apps/web (must set `X-School-Id` if a future account picker
lets a user switch schools — not needed for the MVP evidence flow, which assumes
single-school teachers per the UX design's target persona).

## Approval Status
**APPLIED 2026-07-17** — self-review under ADR-0004; noted for ratification alongside
the next contract version bump (would formalize the header in `openapi.yaml`'s
`parameters` if/when multi-school support becomes a real product requirement).
