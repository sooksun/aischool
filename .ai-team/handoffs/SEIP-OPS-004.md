# Close-out: SEIP-OPS-004 — Login rate limiting + security headers

Branch: `feat/SEIP-OPS-004-edge-security` · Date: 2026-07-18

## Delivered

### Edge (primary)
| File | Role |
|---|---|
| `infra/nginx/http-rate-zones.conf.example` | `limit_req_zone` for login + API |
| `infra/nginx/seip-staging.conf.example` | Login 5r/m, API 30r/s, security headers, `limit_req_status 429` |
| `infra/docker/nginx-web.conf` | Baseline headers on SPA container |
| `docs/project/ops-runbook.md` §4b | Operator verification + multi-instance note |

### API (defense-in-depth)
| File | Role |
|---|---|
| `apps/api/src/lib/login-rate-limit.ts` | Per-IP + per-email fixed window |
| `apps/api/src/routes/auth.ts` | Check before password verify → AUTH-004 |
| `apps/api/src/plugins/security-headers.ts` | nosniff, DENY frame, no-store, … |
| `apps/api/src/server.ts` | `trustProxy` in production / `TRUST_PROXY=true` |
| error-codes **1.2.0** | AUTH-004 (429) — CCR-006 |

## Acceptance
| Criterion | Result |
|---|---|
| Login brute-force limited | Edge nginx + API AUTH-004 |
| Safe serving headers | Edge + SPA nginx + API plugin |

## Verification
```
npm run codegen:contracts
npm run build --workspace apps/api
node --env-file-if-exists=.env --test apps/api/test/login-rate-limit.test.mjs
```
