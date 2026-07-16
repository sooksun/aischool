# Close-out: SEIP-ARCH-001 — Architecture & Contracts v0.1

Owner: claude (solo per ADR-0004) · Work done: 2026-07-17 (commit `d056059`)
**Written retroactively on 2026-07-17 during SEIP-ARCH-002** — the exit-gate check (item 10: every Sprint 0 task has a handoff) caught that this file was skipped when the task closed. Content below is reconstructed from the commit and the artifacts; no claim is made here that was not verified at the time.

## Delivered
| Artifact | Content |
|---|---|
| `docs/contracts/openapi.yaml` | 27 operations: auth, taxonomy (framework→domain→indicator per ADR-0003), cycles/rounds (1..n), evidence + two-phase upload, governed mappings, per-evaluator scoring |
| `docs/contracts/permissions.yaml` | 6 roles, school-scoped tenancy rule, per-operation matrix |
| `docs/contracts/error-codes.yaml` | 9 namespaces (AUTH/PERM/VAL/UPL/MAP/SCORE/CYCLE/RES/SYS) + response shape |
| `docs/contracts/events.yaml` | Outbox-delivered domain events for the evidence lifecycle |
| `docs/architecture/module-boundaries.md` | Module map + 6 interaction rules |
| `docs/reviews/SEIP-DB-000-claude-review.md` | Inherited data-model review — verdict PASS |

## Acceptance criteria
| AC | Result |
|---|---|
| 4 contract files drafted at v0.1 | ✅ |
| Roles + school-scoped tenancy | ✅ |
| Indicator taxonomy per ADR-0003 | ✅ — T-x.x / A-x.x as versioned data, no hard-coding |
| OpenAPI lints clean; typegen runs | ✅ redocly valid 0 warnings; openapi-typescript OK |
| AI-mapping deferred, not guessed | ✅ `x-deferred` section (Sprint 2, OPEN-3) |
| Resolves CCR-001 | ✅ marked RESOLVED |
| Module boundary map | ✅ |

## Key decisions taken inside the contracts
- **Tenancy by absence**: no endpoint accepts `school_id` — scope comes from the token. Cross-school → RES-001 (not-found), never 403, so existence cannot be probed.
- **Two-phase upload**: bytes go client→storage via presigned target; the API never proxies them; `storage_uri`/`storage_provider` never appear in responses.
- **Per-evaluator score grain**: `submitMyScores` is an idempotent per-evaluator upsert; overall pass = workload gate AND every evaluator ≥70% (ว9/ว10 rule encoded in `AssignmentResults`).
- **Taxonomy payload weight**: level descriptions are opt-in via `include=levels` — addressing the "fat payload" cost signal from the DB-000 feasibility checklist.

## Known limitations at close
- Contracts were v0.1 **draft**, not locked — lock happened in ARCH-002.
- Report contracts (PA1/PA2/PA3) deferred to v0.2 pending the official form field inventory.
- Feasibility/usability validation was still pending: DB-000 review landed in this task, UX field-trace validation came in SEIP-UI-000 (which found 3 gaps → CCR-002).

## Verification (at the time)
`npx @redocly/cli lint docs/contracts/openapi.yaml` → valid, 0 warnings ·
`npx openapi-typescript … -o …` → OK ·
`js-yaml` parse × 3 → OK · CI on develop@d056059 → success

## Next
SEIP-UI-000 (done, raised CCR-002) → SEIP-QA-001 (done) → SEIP-ARCH-002 lock.
