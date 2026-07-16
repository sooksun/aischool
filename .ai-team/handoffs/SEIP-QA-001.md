# Close-out: SEIP-QA-001 — Runnable Quality & Security Gates

Owner: claude (solo per ADR-0004) · Completed: 2026-07-17

## Delivered
| Artifact | Content |
|---|---|
| `docs/qa/QUALITY-GATES.md` | Gate→command→CI-job table; LIVE vs self-arming states; release-gate owners/triggers; required-check names |
| `docs/qa/SECURITY-BASELINE.md` | 28 checkable SEC-* requirements: auth, tenancy, upload, OWASP mapping, PDPA, repo hygiene |
| `docs/qa/FINDING-SEVERITY.md` | S1–S5 model + SLA + merge impact + board mapping; GROK.md finding format retained |
| `.github/workflows/ci.yml` | 12 stubs → 4 LIVE gates + 8 self-arming gates (arm on script/schema/test presence — no future CI edits) |
| `package.json` + lockfile | `gate:*` runner scripts; deliberately no build/lint scripts so those gates stay unarmed until Sprint 1 |
| `scripts/security/validate-contracts.mjs` | lint + typegen + YAML parse, pinned majors |
| `scripts/security/run-gitleaks.mjs` | local runner: PATH → docker → honest fail with instructions |

## Acceptance criteria
| AC | Result |
|---|---|
| 1 PR gates have command+threshold+CI job | ✅ table complete, 12 gates + CODEOWNERS policy |
| 2 Release gates have owner+trigger | ✅ 7 gates (owner = claude executes / user approves) |
| 3 Security baseline per GROK scope | ✅ SEC-AUTH/TEN/UPL/OWASP/PDPA/REPO |
| 4 Severity model | ✅ S1–S5, PDPA bump rule, board mapping |
| 5 Enforcement documented | ✅ required-check names listed; protection setup still pending gh auth (OPS-001 note) |
| 6 Commands handed to CI wiring | ✅ same task (ADR-0004) — wired directly |

## Verification (actual, 2026-07-17 local)
- `npm run gate:ownership` → exit 0 (5 modules, 0 errors)
- `npm run gate:contracts` → exit 0 (lint OK, typegen OK, 3× parse OK)
- `npm run gate:dep-audit` → exit 0 (0 vulnerabilities)
- `npm run gate:secret-scan` → exit 0 (7 commits, no leaks; docker pinned v8.18.4)
- CI on GitHub: see run for this commit (monitored on push)

## Notes
- oasdiff breaking-change path executes only on PR events — first real exercise will be the ARCH-002 PR; noted so a failure there is triaged as pipeline, not contract.
- Self-arming rule for Sprint 1: defining `scripts.{format:check,lint,typecheck,test:unit,test:integration,build}` or adding `prisma/schema.prisma` / `tests/security/*` arms the matching gate automatically. Add each newly-armed check name to branch protection required list.
