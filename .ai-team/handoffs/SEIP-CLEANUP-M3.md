# Handoff — SEIP-CLEANUP-M3 (capability flags)

## Summary
Replace ad-hoc role arrays in `App.tsx` (`DIRECTOR_ROLES` / `REPORT_NAV_ROLES` /
`EVALUATOR_NAV_ROLES`) with capability flags computed once from memberships.

## Design
| Piece | Role |
|---|---|
| `lib/capabilities.ts` | `CAPABILITY_ROLES` keyed by UI flag; comments cite permissions.yaml operationIds |
| `useAuth().capabilities` | memoized `capabilitiesFromMemberships(user.memberships)` |
| `App.tsx` | `RequireCapability` + nav booleans from flags — no role lists |
| Pages | `governMappings` / `createReports` instead of inline `hasRole([...])` |

## Flags ↔ matrix
| Flag | permissions.yaml ops (roles) |
|---|---|
| manageCycles | createCycle, createRound, createAssignment → director, school_admin |
| scoreAsCommittee | submitMyScores → evaluator, director |
| viewReports | listReports / getReport / getReportPdf (+ area_admin) |
| createReports | createReport → director, school_admin |
| governMappings | actOnMapping school-level → director, school_admin |

## Note
Still UI-only. API enforces permissions.yaml. `hasRole` kept for rare one-offs.

## Verify
```
npm run typecheck --workspace apps/web
npm run test:unit --workspace apps/web
```
