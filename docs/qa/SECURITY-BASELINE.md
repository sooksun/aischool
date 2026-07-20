# Security Baseline — SEIP (SEIP-QA-001)

Status: v1 (2026-07-17) · Checkable requirements, each with an ID and a "verified by".
Scope per original GROK.md review scope; enforcement responsibility is claude (ADR-0004), approval is the user's.
"Gate" = CI job in QUALITY-GATES.md · "Test" = automated test to exist by the named sprint · "Review" = human/AI review checklist item.

## 1. Authentication & session (SEC-AUTH)

| ID | Requirement | Verified by |
|---|---|---|
| SEC-AUTH-1 | Passwords stored only as adaptive hashes (argon2id or bcrypt ≥ cost 12); never logged, never in AuditEvent snapshots | Test (Sprint 1) + review |
| SEC-AUTH-2 | Access token TTL ≤ 60 min; refresh rotation with reuse detection; logout revokes refresh | Test (Sprint 1) |
| SEC-AUTH-3 | Disabled/`invited` accounts cannot authenticate (AUTH-003) | Permission tests |
| SEC-AUTH-4 | No credentials or tokens in URLs, query strings, or client storage other than httpOnly cookie / secure storage | Review + e2e |
| SEC-AUTH-5 | Login brute-force throttling (per-account + per-IP) before Sprint 1 exit. `acceptInvite` is throttled on its OWN per-IP bucket, not login's — a school sits behind one NAT'd IP, so a shared bucket would let an onboarding batch lock out staff logins (CCR-014) | Test (Sprint 1) |
| SEC-AUTH-6 | Minimum password length **12**, enforced server-side. Length, not composition: NIST 800-63B dropped composition rules because they push users toward `Passw0rd!`. Mirrored in three places that must move together — `MIN_PASSWORD_LENGTH` (packages/auth), `AcceptInviteRequest.password.minLength` (openapi.yaml), and the accept-invite UI hint (CCR-014) | Test (onboarding-flow.test.mjs) |

## 2. Tenant / school data isolation (SEC-TEN) — highest-risk area

| ID | Requirement | Verified by |
|---|---|---|
| SEC-TEN-1 | Every operational query is school-scoped; repository layer enforces `school_id` filter by construction (not per-handler discipline) | Review of packages/database design + permission tests |
| SEC-TEN-2 | Cross-school access returns **RES-001 not-found shape** — existence never leaks (permissions.yaml tenancy rule) | Permission tests: every list/detail endpoint × foreign-school id |
| SEC-TEN-3 | `area_admin` is read-only; any write from area scope → PERM-004 | Permission tests |
| SEC-TEN-4 | Evaluators access only assignments where they are CommitteeMember (PERM-003), and evidence only through those assignments | Permission tests |
| SEC-TEN-5 | The permissions.yaml matrix itself is the test fixture — tests generate cases from the contract file, so contract and enforcement cannot drift silently | Test design rule (Sprint 1) |

## 3. File-upload security (SEC-UPL)

| ID | Requirement | Verified by |
|---|---|---|
| SEC-UPL-1 | Bytes flow client→object storage via short-lived presigned target; never through the API process; API stores metadata only | Review + integration test |
| SEC-UPL-2 | Server-side validation of mime/size/duration against `EvidenceCategory` regardless of client checks (UPL-001..003); worker probe is authoritative for video duration (CCR-002) | Integration tests |
| SEC-UPL-3 | Every file virus-scanned before it is servable; `getEvidenceFileDownloadUrl` only when `scan_status=clean` (UPL-006); embedded `download_url` always null (CCR-010); blocked files quarantined + owner notified | Integration tests + events |
| SEC-UPL-4 | Checksum sha256 verified at complete (UPL-005); mismatch discards the object | Integration tests |
| SEC-UPL-5 | Served files: `Content-Disposition` safe filename, no content-type sniffing (`X-Content-Type-Options: nosniff`), presigned read URLs short-lived | Test (Sprint 1) |
| SEC-UPL-6 | Upload endpoints rate-limited per user; storage keys unguessable (uuid, no user-supplied names) | Review |

## 4. OWASP Top 10 mapping (SEC-OWASP)

| OWASP 2021 | SEIP concretization | Verified by |
|---|---|---|
| A01 Broken access control | SEC-TEN-1..5; deny-by-default matrix | Permission tests |
| A02 Cryptographic failures | TLS-only deployment; SEC-AUTH-1; checksums; no PII in URLs | Review + config test |
| A03 Injection | ORM-parameterized queries only; no string SQL; file names never hit shell | Lint rule + review |
| A04 Insecure design | Contract-first + this baseline as design input, not afterthought | Process (this doc) |
| A05 Security misconfiguration | Helmet-style headers, CORS allowlist, prod error handler hides internals (SYS-001 shape only) | e2e header test |
| A06 Vulnerable components | Dependency-audit gate (LIVE), lockfile pinned, renovate policy Sprint 1 | Gate |
| A07 Identification & auth failures | SEC-AUTH-1..5 | Tests |
| A08 Software & data integrity | Pinned CI actions/binaries (gitleaks, oasdiff); outbox prevents dual-write divergence; sha256 on evidence | Gate + review |
| A09 Logging & monitoring failures | AuditEvent append-only on every mutation with `request_id`; access-denied events logged | Integration tests |
| A10 SSRF | API never fetches user-supplied URLs (v0.1 has none); AI-mapping (Sprint 2) must re-review | Review checkpoint at Sprint 2 |

## 5. Privacy & auditability — PDPA (SEC-PDPA)

| ID | Requirement | Verified by |
|---|---|---|
| SEC-PDPA-1 | PII classes per entity follow the entity dictionary legend; `sensitive` entities (Evidence, scores, approvals) never appear in logs beyond ids | Review + log lint |
| SEC-PDPA-2 | AuditEvent before/after snapshots use a field **allowlist** — no learner images/free-text duplicated into audit rows (DB-000 review observation #4) | DB-001 test |
| SEC-PDPA-3 | Evidence retention follows dictionary intent (`cycle+N`, default N=5; audit-long 7y) — deletion is soft + async storage GC with audit trail | DB-001 design test |
| SEC-PDPA-4 | PDPA notice version shown at submission is recorded with the consent-adjacent audit event (UX §PDPA) | Integration test |
| SEC-PDPA-5 | Evidence access (view/download) is itself audited — who viewed learner data, when | Integration test |
| SEC-PDPA-6 | Data never leaves Thailand-resident storage without an ADR (OPEN-3 blocks AI provider choice on exactly this) | ADR gate (Sprint 2) |

## 6. Repository & pipeline hygiene (SEC-REPO)

| ID | Requirement | Verified by |
|---|---|---|
| SEC-REPO-1 | No secrets in git — gitleaks full-history gate (LIVE); `.env*` ignored; found-secret = rotate + purge, never just delete the file | Gate |
| SEC-REPO-2 | CI third-party actions/binaries pinned to versions (checkout@v4, node@v4, gitleaks v8.18.4, oasdiff image) | Review of ci.yml |
| SEC-REPO-3 | GITHUB_TOKEN permissions minimal (`contents: read` in ci.yml) | Review |
| SEC-REPO-4 | Evidence/PII never in the repo — uploads/, storage/ ignored (OPS-001) | Gate (secret-scan catches common cases) + review |

## Review cadence

- Every task close-out: self-check against the relevant SEC-* section, noted in the close-out file.
- ARCH-002 (contract lock): full pass over §2 and §3 against final contracts.
- Sprint 2 entry: §4-A10 and §5-SEC-PDPA-6 re-review (AI provider).
