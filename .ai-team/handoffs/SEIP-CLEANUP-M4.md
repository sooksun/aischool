# Handoff — SEIP-CLEANUP-M4 (login rate limiter singleton)

## Summary
Formalize the process-global login rate limiter singleton; document multi-instance
acceptance (edge primary); tests install/restore process state explicitly.

## Changes
| File | Change |
|---|---|
| `apps/api/src/lib/login-rate-limit.ts` | `globalThis` slot; `configureLoginRateLimiterFromEnv`; `installLoginRateLimiterForTests`; `resetLoginRateLimiterState` |
| `apps/api/src/server.ts` | boot via `configureLoginRateLimiterFromEnv` |
| `apps/api/test/login-rate-limit.test.mjs` | singleton identity + restore helpers; AUTH-004 still covered |
| `docs/project/ops-runbook.md` | multi-instance table: edge primary, API per-process, Redis not launch blocker |

## Policy
- **Not a launch blocker** if edge `limit_req` is always deployed for login.
- Redis shared counters = future only without trusted edge.

## Verify
```
npm run build --workspace apps/api
node --env-file-if-exists=.env --test apps/api/test/login-rate-limit.test.mjs
```
