# Project State

## Project
School Evidence Intelligence Platform (SEIP)

## Current Phase
**Rethink → P0 (13–30 Oct 2026)** — PRD v1.0 (`docs/project/PRD.md`), plan (`docs/project/plan.md`) and ADR-0010–0018 accepted by the owner 2026-10-12. Scope v1: evidence hub + committee view + DPA export; scoring frozen for v2 (ADR-0017). Web + Flutter clients, in-country AI (ADR-0010).

> **Several photos, one item (SEIP-P2-008, in review):** in the app, after a photo the person can take more ("ถ่ายเพิ่ม"). All the photos become one evidence item, which is created once even when sending is retried.
>
> **Preview picture (SEIP-P2-007, in review):** every photo and video now gets a small preview picture (at most 480 px wide) with all EXIF and location data removed. The original is kept untouched, and the evidence page shows the preview.
>
> **720p copy (SEIP-P2-006, in review):** every video now gets a small 720p copy that plays in a browser, with location metadata removed. The original is kept untouched, and the evidence page offers "ดูแบบ 720p".
>
> **Server-measured media (SEIP-P2-005, in review):** the worker now measures each video and audio file with ffprobe. The real length and resolution replace what the client declared, and a clip longer than its category allows is blocked. Thumbnails and the 720p copy come later.
>
> **App capture, first cut (SEIP-P2-004, in review):** the app's home screen takes a photo or video, or picks one from the gallery, into the offline outbox. Each item shows its status in Thai (รอส่ง / กำลังส่ง / กำลังตรวจ). Not done yet: several photos in one item, document scan, share-in, background sending and a device run.
>
> **Web multi-file upload (SEIP-P2-003, in review):** "ส่งหลายไฟล์" takes several files at once, by drag and drop or by picking them. Each file becomes its own evidence item, with progress and a status per file. A failed file retries without duplicating.
>
> **Offline outbox engine (SEIP-P2-002, in review, no contract change):** in the app, evidence captured offline waits in an outbox that survives the app being closed. Bytes go up resumably, sending only the parts the server lacks, and an expired session is replaced. Twenty flaky replays make no duplicate. The local copy is deleted only after the server's re-hash and a clean scan. This was verified live with a 17 MiB file against the real API, SeaweedFS and worker. The capture screens and background running come next.
>
> **P2 started — duplicate files (SEIP-P2-001, in review, contract 4.8.0 / CCR-026 additive):** when a person picks a file their portfolio already holds, the web warns them and links to the earlier item before any bytes are sent. After the server re-hashes the file, it marks the later copy.
>
> **Owner decisions applied (SEIP-P1-016, CCR-025, permissions 2.7.0):** a director's agreement (ว10) is acknowledged by the area admin, not by anyone in the school. After a teacher moves, the old school keeps only the items its own evaluation mapped. A school admin may still reset a director's password (CCR-022, unchanged).
>
> **Evidence context (SEIP-P1-015, in review, contract 4.7.0 / CCR-024 additive):** an item a school admin uploads for a teacher counts only after the teacher accepts it. A person at two schools moves an item filed under the wrong school, within one สพท., and the move is audited.
>
> **Personnel profile confirmation (SEIP-P1-014, in review, contract 4.6.0 / CCR-023 additive):** each person checks their position, วิทยฐานะ and the date it was granted on first use, then confirms or asks for a correction. The school admin sees the note and edits the profile. A change of position or rank asks the person to confirm again.
>
> **Password reset by the school admin (SEIP-P1-013, in review, contract 4.5.0 / CCR-022 additive):** a school admin issues a one-time code (30 min). The member sets a new password at /reset-password. Every session ends, and the SEIP ID password changes too. Self-service reset by email or SMS waits for a provider.
>
> **Device sessions (SEIP-P1-012, in review, no contract change):** a person sees each phone and browser signed in, on the web page "อุปกรณ์", and can sign one out. A signed-out app is refused at once and cannot renew, because its Keycloak offline session is deleted. It then wipes its stored session.
>
> **Transfer within one สพท. (SEIP-P1-011, in review, no contract change):** after a teacher moves school, the portfolio stays with them and the old school cannot see new evidence. A mapping now belongs to the school where the owner confirmed it, so the new school's director opens the evidence and validates it. Still open: the old school's retention rule (OQ-12) and a move to another สพท.
>
> **Area admin manages schools (SEIP-P1-010, in review, contract 4.4.0 / permissions 2.3.0 / CCR-021 — approved by owner 2026-10-13):** a สพท. admin opens, renames, closes and reopens the schools of their area in the web, and appoints each school's school_admin by invite. These are area_admin's first writes, need step-up, and another area is RES-001. Closing a school ends its members' access but keeps the data.
>
> **School context (SEIP-P1-009, in review, contract 4.3.0 / CCR-020 additive):** a person at several schools picks one in the web, and the pick is remembered. `/auth/me` now lists only memberships in effect, with school names. After a transfer, the web no longer offers the old school's screens.
>
> **Bulk onboarding (SEIP-P1-008, in review, contract 4.2.0 / CCR-019 additive):** a school admin uploads the staff list as CSV, checks it with a dry run that reports each bad row, then imports the valid rows, with every invite code shown once.
>
> **FR-095 gaps closed (SEIP-P1-007, in review):** every denial of a caller whose identity is known (PERM-*, AUTH-006, RES-001) now writes an `access_denied` audit row. The whole permission sweep asserts this. Taxonomy routes require a role, and the last client-supplied FK that could 500 (`createCycle.framework_version_id`) now answers VAL-002.
>
> **Identity slice 4 (SEIP-P1-006, in review):** the Flutter app signs in with SEIP ID through the system browser (PKCE), with an offline session per device. The refresh token is kept in the keystore, renewal is shared and transparent, a restart restores the session, a revoked device signs out, and step-up uses `acr=mfa`. A second factor now counts for 15 minutes only, because Keycloak keeps `acr` "mfa" through every refresh. Measured: Keycloak's admin sign-out does not *reliably* end phone (offline) sessions, so P2 device revocation must delete them directly. CI green (run 38338182959). Not yet run on an emulator.
>
> **Identity slice 3 (SEIP-P1-005, in review, CI green run 38336094640):** every SEIP account gets its Keycloak user. Provisioning runs at accept-invite and at the next password login, the two moments the API holds the password, through the `seip-provisioner` service account. Directors, school admins, evaluators and area admins must enrol TOTP at their first SEIP ID sign-in. If Keycloak is down, sign-in still works and the next password login retries.
>
> **Identity slice 2 (SEIP-P1-004, in review, contract 4.1.0 / CCR-018 additive):** the web signs in through Keycloak behind a BFF. The browser holds only an httpOnly `__Host-seip` cookie (30 min idle, 8 h max) plus a CSRF cookie echoed as `X-CSRF-Token` (AUTH-007 otherwise). A Keycloak session ended elsewhere ends the web session within about a minute. A step-up (AUTH-006) is a new sign-in with OTP that replaces the session. The SPA shows a "เข้าสู่ระบบด้วย SEIP ID" button and a step-up banner. The password login stays until the end of P1. Next: `ENFORCE_MIN_ACR=true` once staging runs Keycloak.
>
> **Identity slice 1 (SEIP-P1-003, in review):** Keycloak 26.7.5 runs in docker compose and CI with the dev realm `seip` (infra/keycloak). The API accepts its access tokens next to its own (JWKS; account = the admin-only `seip_uid` claim) and enforces `min_acr` step-up (password = acr 1, TOTP = acr 2 → AUTH-006 below) behind `ENFORCE_MIN_ACR`, which stays off until the web BFF and Flutter log in through Keycloak (next slices). ThaID waits on the สพท. RP registration.
>
> **RLS backstop by สพท. (SEIP-P1-002, done; ADR-0019 accepted 2026-10-13):** a read-only role `seip_scoped` and `withAreaScope` in `packages/database`. Inside the scope, PostgreSQL hides evidence, its files, mappings and upload sessions, and personnel profiles outside the caller's areas, schools and persons — even for raw SQL with no tenant filter (P1 exit criterion). `listEvidence` reads through it. The backstop is opt-in: other paths still rely on the API's authorization alone. All local gates and suites green, and CI (run 38325277042).
>
> **Contract 4.0.0 is in force (SEIP-P1-001, in review):** the owner approved [CCR-017](../reviews/CCR-017-contract-4.0.0.md) on 2026-10-12, and it is applied. CI is green on 03f64b8 (run 38321728017, 15/15 jobs).
> - Evidence belongs to a **person**, not a school (ADR-0015).
> - Uploads go through **upload sessions**: one PUT up to 16 MiB, S3 multipart above that, and the server completes the upload.
> - Mappings are **two-tier**: the owner confirms, then the director or committee validates or returns, keyed on the framework version.
> - Creates and edits take **Idempotency-Key** and **If-Match**.
> - **23 operations are phase-gated** and answer 501 SYS-003 until their phase lands.
> - v2 scoring and reports sit behind **`FEATURE_SCORING`**, which is off by default.
> - The worker re-hashes every original against its declared SHA-256.
>
> All local gates and suites are green on a fresh DB, and so is CI.
>
> The web reads the same `FEATURE_SCORING` at build time and hides the scoring and report screens when it is off.
>
> Still open: `min_acr` is enforced only with `ENFORCE_MIN_ACR=true` (SEIP-P1-003), which waits for the clients to log in through Keycloak.
>
> **Flutter skeleton (SEIP-P0-006):** `apps/mobile` signs in and reads `/auth/me` through the generated client — live test against the real API passes; emulator run still to do. **S3 conformance suite (SEIP-P0-005)** green on SeaweedFS.
>
> **Dart client spike passed (SEIP-P0-004):** swagger_parser generates, builds and analyses the 4.0.0 draft cleanly; new CI gate `dart client`.
>
> **Contract 4.0.0 drafted (SEIP-P0-003)** — approved 2026-10-12 and applied by SEIP-P1-001 (above).
>
> **P0 week 2 (SEIP-P0-002, in review):** Prisma 7.10 with the pg driver adapter — **13/13 CI green again** (run 38304129059). P0 exit criterion "green after Prisma 7" met.
>
> **P0 week 1 (SEIP-P0-001, in review):** back on PostgreSQL 18 with non-superuser `seip_migrator`/`seip_app` roles (ADR-0012), SeaweedFS replaces MinIO (ADR-0013), dependency audit clean. **13/13 CI gates green on PR #3 (run 38230214195) — the first fully green run of this codebase.**

### Previous phase
**Sprint 1 — First production features** (opened 2026-07-17 when the ARCH-002 merge went green on develop, run `b5c6d6a`). Single-agent mode per ADR-0004.

> ✅ **All three audit blockers closed** (2026-07-19/20): B-1 onboarding (CCR-014, openapi 2.9.0), B-2 agreements + ประเด็นท้าทาย (CCR-015, **3.0.0** breaking), B-3 report approval (CCR-016, 3.1.0). The วPA flow now runs end to end through the API: invite → accept → PA1 + ประเด็นท้าทาย → evidence → mapping → cycles/rounds → 3-evaluator scoring with the challenge visible → report → **director approves**.
>
> **This is not the same as "ready to deploy."** What remains is listed under "Known gaps at blocker-close" below. The two items previously flagged as not-safe-to-defer — **no malware scanning** and **manual backups** — were both closed 2026-07-20 (ADR-0009; `npm run backup`/`restore` + a scheduled staging service). The largest gap left is that nothing consumes the outbox, which makes notification-shaped features no-ops rather than hazards.

## Development Model
Claude Code is the sole developer (architect + backend + frontend + QA); the user is the final approver. The multi-AI team model (Codex/Antigravity/Grok) was retired by ADR-0004 — its docs remain with SUPERSEDED banners.

## Sprint 0 exit — CLEARED 2026-07-17
Gate result: 8 pass, 1 accepted deviation (direct commits to develop — sanctioned by ADR-0004), 2 superseded by ADR-0004. Item-by-item evaluation in `.ai-team/handoffs/SEIP-ARCH-002.md`.
The no-production-code constraint is **lifted**. Contracts are locked at v1.0.0 and now bind implementation: no invented fields, changes need a CCR + version bump (enforced by the contract-compatibility gate on every push and PR).

## Sprint 0 — all done 2026-07-17
OPS-001 (repo + CI) · ARCH-001 (contracts v0.1) · DB-000 (data model, inherited from Codex, review PASS) · UI-000 (evidence UX + CCR-002) · QA-001 (gates) · ARCH-002 (lock v1.0.0). QA-002 cancelled by ADR-0004.

## Current Objectives (Sprint 1)
1. ~~SEIP-DB-001~~ **DONE** — schema + migrations + seed + constraint tests
2. ~~SEIP-DB-002~~ **DONE** (structure)
2b. ~~SEIP-DB-003~~ **DONE** — IndicatorLevelDescription matrix seeded (432+360; framework-anchored operational text)
3. ~~SEIP-API-001~~ **DONE** — evidence-workflow 15 ops (3db868d)
4. ~~SEIP-QA-003~~ **DONE** — permission matrix tests
5. ~~SEIP-UI-001~~ **DONE** — evidence SPA (3db868d)
6. ~~SEIP-OPS-002~~ **DONE** — develop CI fix (556958c)
7. ~~SEIP-API-002~~ **DONE** — cycles + committee scoring (remaining 11 ops); all 27 contract operations implemented *(contract has since grown to 35 ops; all 35 are implemented)*
8. Contracts at **v2.8.0** (was v2.1.0 at CCR-005; CCR-010 lazy download_url → 2.5.0, CCR-011 ReportPayloadV1 → 2.6.0, CCR-012 `unscanned` → 2.7.0, CCR-013 rubric text → 2.8.0)
9. ~~SEIP-WORKER-001~~ **DONE** — outbox + file.process + storage GC. CCR-012 *deleted* the virus-scan stub and the duration probe rather than fixing them; **ADR-0009 (2026-07-20) replaced the scanner for real** with on-prem ClamAV that fails closed. The duration probe is still absent by design — `duration_seconds` stays null unless the client declares it, because an estimate is not a measurement.
10. ~~SEIP-UI-002~~ **DONE** — director/admin UI for cycles, rounds, committee assignment; handoff `.ai-team/handoffs/SEIP-UI-002.md`
11. ~~SEIP-OPS-003~~ **DONE** — staging compose + TLS/backup runbook + worker (`6b8b66c` on develop)
12. ~~Wave D+E reports/AI~~ **DONE** (`f014cf8`) — ARCH-003/API-003/WORKER-002/UI-004 + ARCH-005/API-004/UI-005
13. ~~SEIP-UI-003~~ **DONE** — evaluator scoring UI (`feat/SEIP-UI-003-evaluator-scoring`); handoff `.ai-team/handoffs/SEIP-UI-003.md`
14. ~~SEIP-API-003a / UI-003b / QA-004~~ **DONE** on `feat/SEIP-WAVE-B-CF` — safe download_url, scan UI, Playwright e2e smoke
15. ~~SEIP-OPS-004~~ **DONE** — edge login rate limit + security headers; API AUTH-004 defense-in-depth
16. ~~PA form PDF + expanded e2e~~ **DONE** on `feat/SEIP-PDF-E2E` — getReportPdf, UI download, Playwright director/teacher paths
17. ~~Cleanup B1–B3 / H1 / H2~~ **DONE** — list scan_status; atomic AI suggest; **lazy download_url** (CCR-010, openapi 2.5.0)
18. ~~Cleanup M2~~ **DONE** — ReportPayloadV1 shared type (CCR-011, openapi 2.6.0)
19. ~~Cleanup M3~~ **DONE** — capability flags from memberships (no ad-hoc App.tsx role arrays)
20. ~~Cleanup M4~~ **DONE** — login rate limiter process-global singleton; multi-instance = edge primary (Redis deferred)
21. ~~Cleanup L1~~ **DONE** — PDF UX draft/review fidelity (not official plate)
22. ~~Cleanup L2~~ **DONE** — e2e depth (upload, score, report/PDF, session refresh)
23. ~~DB engine migration~~ **DONE 2026-07-18** — PostgreSQL → MySQL 8 per ADR-0008 (Laragon localhost dev; staging/CI containers swapped; migrations rebaselined; full suite + e2e green on MySQL).
24. ~~Cleanup L2-a~~ **DONE 2026-07-19** — `.category-card` selected-state CSS matched `aria-pressed` while the markup renders `role="radio" aria-checked`; the rule never applied, so picking an evidence category gave sighted users no visual confirmation. Verified fixed against the real stylesheet on the dev server.
25. **Sprint 2 — BLOCKERS (must precede any release; each needs a CCR + a version bump — major vs minor decided per CCR, not assumed).** Tracked as `SEIP-BLOCK-001/002/003` on `.ai-team/task-board.yaml` (CCR-014/015/016). **CCR-014 drafted 2026-07-19, awaiting approval** — it lands additive (openapi 2.8.0 → 2.9.0), correcting this entry's original claim that all three require a major bump:
    - ~~**B-1 Onboarding path**~~ (`SEIP-BLOCK-001`, CCR-014) — **DONE 2026-07-19.** `listPersonnel` / `listMembers` / `inviteMember` / `endMembership` + unauthenticated `acceptInvite` (openapi 2.9.0). The first admin and school provisioning ship as operator CLIs (`npm run provision:school`, `npm run bootstrap:admin`) because no role may write across schools and inventing a `system_admin` would rewrite all 31 matrix rows. Proven by an e2e spec that onboards a teacher through the browser with no Prisma write in the path.
    - ~~**B-2 PerformanceAgreement + AgreementChallenge**~~ (`SEIP-BLOCK-002`, CCR-015) — **DONE 2026-07-19.** 6 operations (list/get/create/update/submit/acknowledge) + `AssignmentDetail.challenge`, so the committee now reads the method and targets that C.1/C.2.1/C.2.2 rate instead of scoring 40% blind. `AssignmentCreate.agreement_id` removed (**breaking → openapi 3.0.0**) — the server derives it from (cycle, evaluatee), and an unvalidated client value was letting one person's workload gate read another's row. Both raw `performanceAgreement.create` fixtures deleted: the suite can no longer be green while scoring is unreachable.
    - ~~**B-3 Approval**~~ (`SEIP-BLOCK-003`, CCR-016) — **DONE 2026-07-20.** `approveReport` / `returnReport` / `listReportApprovals` + `ReportDetail.approvals`, and `report.approved` left the `events.yaml` `deferred:` block. Approval requires the round **closed** (RPT-003): nothing checked round state before a report was generated, and scores stay mutable until close (SCORE-002), so signing earlier produced a document its own data could contradict. Nobody may approve their own report. The PDF now states whether it has been endorsed. `rejected` / `issued` / `superseded` stay deliberately unreachable — reasons in the CCR.
26. ~~Malware scanning + automated backups~~ **DONE 2026-07-20** — ADR-0009 (ClamAV on-prem, fail-closed) and `scripts/ops/backup.mjs` + `restore.mjs` with a scheduled staging service. The backup verifies each dump by restoring it, which immediately exposed a schema bug that had made every prior backup unable to restore its audit triggers (migrations `20260720060000`–`3`, runbook §5.4).
27. ~~Re-scan of files uploaded before ADR-0009~~ **DONE 2026-07-20** — `npm run rescan:files` (runbook §5b). Writing it corrected the gap's own description, which this document had carried since the audit: the population needing a re-scan is not the `unscanned` files, it is the **`clean`** ones. Those were written by the pre-CCR-012 filename stub — downloadable, badged ปลอดภัย, never scanned by anything — and this database held 81 of them against 180 `unscanned`. Selecting on `scan_status` would have skipped exactly the rows that assert safety they never earned, so selection moved to the new `evidence_file.scanned_at`, set only when clamd actually returned a verdict (ADR-0009 addendum). The sweep enqueues `file.process` jobs and never writes a verdict itself, so one scanner and one fail-closed policy still govern every file.
28. **Sprint 2+ remaining** — outbox consumers (nothing reacts to any event); multi-instance Redis rate limits *only if* no trusted edge; pixel-perfect official paper plates (Protected Artifact); a real video duration probe; surfacing `scanned_at` in the API so the ปลอดภัย badge is dateable by the person trusting it.

## Audit correction — 2026-07-19

A full evidence-based code audit was run against `feat/cleanup-L2-e2e-depth` (`42173e0`). **It contradicted this document.** The previous wording of this section claimed the product slice "works" end-to-end; that is true only because `tests/e2e/global-setup.mjs:196` and `apps/api/test/scoring-flow.test.mjs:114` write bootstrap rows **straight into Prisma, bypassing the API**. Corrected statement:

**Product slice, as reachable through the API today** (updated 2026-07-20): onboarding (invite → accept → login) → **PA1 agreement + ประเด็นท้าทาย (write → submit → director acknowledges)** → evidence upload → MinIO → `file.process` size check **+ ClamAV scan (ADR-0009)** → mapping (+ local AI suggest) → cycles/rounds → committee assignment → **3-evaluator scoring with the challenge visible** → report JSON + section refs → on-demand PDF.
Creating the very first admin and provisioning schools are operator CLIs by design, not gaps (CCR-014 decisions 1 and 2).

## Known gaps at blocker-close — 2026-07-20

The three blockers are closed; these are not, and none of them is a blocker only
because none of them stops the วPA flow from completing. Listed so "all blockers
closed" is never read as "done".

| Gap | Why it matters |
|---|---|
| ~~**No malware scanning**~~ — **CLOSED 2026-07-20 (ADR-0009)** | ClamAV on-prem (never a cloud AV — same PDPA reasoning as ADR-0007). Fails closed: if the scanner is unreachable the file stays `pending` and undownloadable, never `clean`. `SCAN_PROVIDER=none` keeps the honest `unscanned` and is the only way to opt out — there is no silent fallback. `scan_status = clean` is reachable for the first time |
| ~~**Backups are manual**~~ — **CLOSED 2026-07-20** | `npm run backup` / `npm run restore`, plus a scheduled `backup` service in staging compose. Each dump is **restored into a scratch database and row-counted before being called a backup** — which is how it immediately caught a schema bug that made every prior backup unable to restore its audit triggers (runbook §5.4) |
| **The outbox delivers to nobody.** `outbox.dispatch` marks events published and returns; 6 of 14 declared events have a producer and none has a consumer | Every notification-shaped feature is a no-op. `report.approved` is durably recorded and read by nothing |
| **No deploy automation.** One CI workflow, no image build/push, no registry, no rollback path. Containers run as root | Deployment is a human following a runbook |
| **`ReportStatus` is 3-of-5 reachable.** `issued` and `superseded` have no operation, by design (CCR-016) | Stop describing the report lifecycle as complete |
| **Committee seats are still raw UUIDs**, and rank codes display as codes | Documented in CCR-015; needs a contract addition each |
| **The report page dumps `payload` as raw JSON** | A developer view serving as a director's primary content |
| **No test-coverage measurement anywhere** | 190+ tests with no denominator |

**Both items flagged as not-safe-to-defer are now closed** (2026-07-20). What is
left on this list is real but none of it silently loses or exposes data. The
largest remaining is that the outbox delivers to nobody, which makes every
notification-shaped feature a no-op rather than a hazard.

One thing the backup work surfaced that is worth carrying forward: the trigger
bug had existed since 2026-07-18 and no test, gate or review found it. It was
found by a script that verified its own output. Prefer that shape.

Audited completeness ≈ **70%** weighted. Quality of what exists is high — 35/35 contract operations implemented with zero stubs or TODOs, `permission-guard.ts` reads `permissions.yaml` at runtime and fails closed, zero raw SQL, 180 verbatim ก.ค.ศ. paragraphs seeded, migration drift verified zero, `npm run typecheck` clean across all 6 workspaces, 164 real test cases. **The gap is missing scope, not rot** — closing it is a sprint of new contract operations, not bug-fixing.

Lower-severity findings (full list in the audit session): `completeFileUpload` does not re-validate category rules despite a comment at `apps/api/src/routes/evidence.ts:289` claiming it does; ~~3 taxonomy routes never call `resolveGrant`; 4 FK fields unvalidated (→ P2003 500s, one cross-tenant write)~~ closed by SEIP-P1-007 (2026-10-13); outbox dispatch has no backoff and no dead-letter; ~~`permissions.yaml` promises an `access_denied` AuditEvent that is emitted nowhere~~ emitted since SEIP-P1-007; the n8n key in `autokey.md` is gitignored but **not rotated**; backups are manual copy-paste per `ops-runbook.md:147`; no test-coverage instrumentation exists anywhere.


### Incident: develop CI broke on the API-001+UI-001 merge, fixed same-day
The merge (`3db868d`, 2026-07-17) went in with CI never having exercised real
Postgres+MinIO service containers on GitHub's runners before — 3 of 12 gates
failed. Fix in `556958c` (contract gate missing npm ci; MinIO services entrypoint).
Verified green on GitHub Actions run 29549242802.

## Active Tasks
See `.ai-team/task-board.yaml` (single tracker).

## Major Decisions
- ADR-0001 — Technology stack: Node/TypeScript monorepo (Accepted)
- ADR-0002 — Repository layout canonicalization (Accepted; per-agent ownership parts superseded by ADR-0004)
- ADR-0003 — Evaluation framework: วPA ว9/2564 (ครู) + ว10/2564 (ผู้บริหาร); taxonomy in `docs/architecture/evaluation-framework.md` (Accepted)
- ADR-0004 — Single-agent development by Claude Code (Accepted)
- ADR-0005 — Object storage: MinIO / S3-compatible; deployment: on-premise (Accepted)
- ADR-0006 — Implementation frameworks: Fastify (api), Vite+React (web), npm workspaces (Accepted)
- ADR-0007 — AI mapping provider: on-prem `local_heuristic` only (**superseded by ADR-0010**)
- ADR-0008 — MySQL 8 (**superseded by ADR-0012**)
- ADR-0009 — Malware scanning, ClamAV fail-closed (amended by ADR-0018)
- ADR-0010 — In-country AI on open models · ADR-0011 — Hosting/residency/GPU · ADR-0012 — PostgreSQL 18 · ADR-0013 — Object storage (S3 API, SeaweedFS) · ADR-0014 — Keycloak + ThaID · ADR-0015 — Portfolio ownership · ADR-0016 — Clients + contract 4.0 · ADR-0017 — v1 scope, rules as data · ADR-0018 — Upload integrity + media (all Accepted 2026-10-12)
- ADR-0008 — Database engine: MySQL 8 (Laragon local dev, containerized staging/on-prem); PostgreSQL retired (Accepted)

## Open Questions
- ~~OPEN-3~~ **Closed by ADR-0007** — default path is local_heuristic; cloud/foreign LLM requires a superseding ADR.
- ~~OPEN-1~~ GitHub · ~~OPEN-2~~ วPA per ADR-0003 · ~~OPEN-4~~ MinIO on-prem per ADR-0005 · ~~OPEN-5~~ AI-mapping implemented as local_heuristic

## Known Risks
- Criteria and official forms may change by year → framework versioned as data (ADR-0003)
- AI mapping must remain human-reviewable
- Uploaded evidence contains personal data (PDPA) — never in git, storage design server-side
- Video storage can grow quickly (mitigated by ADR-0005 MinIO on-prem + retention policy)
- Solo-agent risk (replaces multi-agent drift risk): no independent reviewer — mitigate with CI gates + user review before contract lock
- **Green CI is compatible with an undeployable system.** The e2e and scoring suites seed `PerformanceAgreement` and all identity rows directly through Prisma, so they prove the scoring *logic* while saying nothing about whether the flow is *reachable*. This masked B-1/B-2 until the 2026-07-19 audit. Any future fixture shortcut that bypasses the API must be recorded in `docs/qa/QUALITY-GATES.md` as a coverage caveat.
- ~~Evidence store has no malware scanning~~ — **CLOSED 2026-07-20 by ADR-0009.** ClamAV on-prem, fail-closed. Residual risk worth carrying: a deployment may still set `SCAN_PROVIDER=none`, in which case files read `unscanned` and are served — disclosed, not gated. Files uploaded **before** ADR-0009 are covered by `npm run rescan:files` (runbook §5b), but the sweep is an operator action, not automatic: **a deployment that enables the scanner and does not run it keeps serving stub-written `clean` files indefinitely.** `npm run rescan:files -- --report` is the check, and it names that number explicitly.
