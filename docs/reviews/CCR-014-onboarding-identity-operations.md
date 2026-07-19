# CCR-014: Onboarding — there is no way to create a user, and no way to log in for the first time

Status: **APPLIED 2026-07-19** (approved by the user the same day)
Blocker: `SEIP-BLOCK-001` · Audit: 2026-07-19 · Depends on: nothing · Blocks: `SEIP-BLOCK-002`
Shipped: openapi **2.9.0** · permissions **1.5.0** · error-codes **1.4.0**

## What changed between draft and implementation

Three things the design did not survive contact with. Recorded here rather than
silently folded in, because each was a defect in the approved plan.

1. **`invite_token` had to become nullable.** The draft made it required. But if
   `inviteMember` always issued a token, any school_admin could "invite" an
   existing account's email and receive a credential that resets *that account's*
   password — an admin-triggered password reset for any user in the system,
   wearing an onboarding hat. Now: an account that already has a password gets
   the membership and **no token**. Regression test: *"inviting an email that
   already has a password does NOT issue a token"*.

2. **`RES-002` was the wrong code for a duplicate membership.** Its contract
   meaning is *"concurrent modification (stale version/etag)"*, which tells a
   client to retry — retrying a duplicate invite will never succeed. Added
   `RES-003` instead.

3. **`acceptInvite` must not share the login rate-limit bucket.** The draft said
   "throttled on the same limiter as login". Running the e2e suite proved that
   wrong: onboarding traffic exhausted AUTH-004 for every other spec. A Thai
   school reaches the API from one NAT'd IP, so a shared bucket means an admin
   onboarding a batch of teachers throttles logins for the entire staff. Now two
   independent buckets with identical limits. Regression test: *"accepting
   invites does not consume the login rate-limit budget"*.

Also found while implementing, and fixed in passing:
- `schema.prisma:74` claims `no-overlapping-active-membership` is a DB constraint.
  **It is not** — that partial unique index did not survive the Postgres → MySQL
  move (ADR-0008); only `membership_scope_ids` exists. The invariant is now
  enforced in the repository, inside the transaction, with the comment saying so.
- The permission sweep gained `completeFileUpload` and `getEvidenceFileDownloadUrl`
  (the two undocumented gaps the audit flagged) and immediately reported 3
  mismatches — all three were the sweep not knowing those ops are ownership-gated,
  not enforcement bugs. Sweep now covers 34 of 35 matrix rows.
- The report-create e2e assertion, which the audit called too soft, now asserts
  the report list actually grew rather than that the form closed.

## Verified

- `apps/api/test/onboarding-flow.test.mjs` — **17 tests**, including the
  account-takeover vector, tenancy (body `school_id` ignored, cross-school
  RES-001), AUTH-005 no-oracle, single-use token, and the rate-limit separation.
- `tests/e2e/onboarding.spec.ts` — **2 specs** driving the real browser:
  admin invites → invitee sets their own password → invitee logs in, with no
  Prisma write anywhere in the path.
- Full suite green: 53 API integration, 19 backend, 38 web unit, 19 auth/package
  unit, 6 security (204 sweep assertions), 12 e2e. `npm run typecheck` clean
  across all 6 workspaces. `oasdiff` confirms no breaking change.
- Manually driven in the browser end to end, including the invite panel's
  show-once token and the Thai expiry date.

## Known limitations shipped knowingly

- **Committee seats are still raw UUID inputs.** They key on
  `evaluator_user_id` (a UserAccount id), which `listPersonnel` does not return,
  and the operation that maps users to names — `listMembers` — is `school_admin`
  only while that screen is `manageCycles` (director + school_admin). Widening it
  would be a permissions change beyond this CCR. External evaluators have no
  `PersonnelProfile` at all, so `listPersonnel` could never cover them.
- **Rank codes display as codes** (`apply_adapt`), not Thai labels. `RankLevel`
  has `labelTh` but `IndicatorLevel` does not expose it, so showing it needs its
  own additive change.

## Request

A fresh install of SEIP cannot be used by anybody.

`prisma/seed.mjs` seeds the complete ว9/ว10 framework — 2 frameworks, 38 indicators,
792 level descriptions, 12 score weights — and **zero** `Area`, `School`,
`UserAccount`, `SchoolMembership`, or `PersonnelProfile` rows. None of the 35
operations in `openapi.yaml` create them either. `hashPassword`
(`packages/auth/src/password.ts:12`) has no caller outside its own unit test.

So the database ships knowing exactly how to evaluate a Thai teacher, and knowing
nobody at all. `npm run db:reset && npm run db:seed && npm run dev:api` produces a
system whose login page cannot be passed.

This survived to 2026-07-19 because every test manufactures its own identity rows
straight through Prisma (`tests/e2e/global-setup.mjs`, `apps/api/test/*.test.mjs`),
so a fully green suite never once exercised the path a real operator has to walk.
Recorded as a coverage caveat in `docs/qa/QUALITY-GATES.md`.

## Why a contract change is required

There is no client-side fix. `apps/web` may only call generated operations
(`module-boundaries.md`), and the operations do not exist. Nor is this a seed-only
fix: seeding one admin would let that person log in, but they would still have no
way to onboard a single teacher, and B-2 (`PerformanceAgreement`) cannot be built
on top of personnel that no operation can create.

A second, quieter consequence: because no personnel-lookup operation exists, the
director's committee-assignment screen identifies teachers by raw UUID
(`RoundAssignmentsPage.tsx:76`, `:85`, `EvaluatorRoundPage.tsx:67`,
`AssignmentScorePage.tsx:171`, `:356`). `listPersonnel` below closes that too — it
is the same missing operation, not a separate UI task.

## Decision 1 — how the *first* account comes into existence

Three options were considered. This is the only genuinely contested choice in this
CCR, and it is a security decision, so it is called out rather than buried.

| | Mechanism | Cost | Risk |
|---|---|---|---|
| **A** | `db:seed` inserts a default admin with a known password | none | Ships a published credential. On-prem operators (ADR-0005) demonstrably do not change these. A grep of any future SEIP install finds the password in git |
| **B** | One-shot operator CLI (`npm run bootstrap:admin`), writes via Prisma | small script | Requires DB access — an authority that already implies total control, so it grants nothing new |
| **C** | `POST /bootstrap`, self-disabling once any user exists | contract surface | A permanently public write endpoint whose safety is a runtime row count. An empty DB after a failed restore, or a freshly provisioned tenant, is a full admin takeover |

**Recommendation: B.** It adds no API attack surface, requires a capability that
is already strictly stronger than what it grants, and leaves `permissions.yaml`
with exactly one unauthenticated write instead of two. Option C's guard is the
precise shape — "safe because of a condition evaluated at runtime" — that fails
catastrophically rather than gracefully when the condition is wrong.

Consequence: **bootstrap is out of contract scope.** It becomes an ops procedure
in `docs/project/ops-runbook.md`, not an operation in `openapi.yaml`. This CCR
therefore covers only what happens *after* the first `school_admin` exists.

## Decision 2 — who may create a School

Nobody, through the API — and this needs stating because it is a deliberate
omission, not an oversight.

`permissions.yaml` has six roles. Five are `scope: school`. The sixth, `area_admin`,
is `scope: area` and **read-only by contract** (`writes_by_area_admin: forbidden`,
PERM-004, SEC-TEN-3). No role has cross-school write authority, so no role can
legitimately create a school.

Granting one would mean adding a seventh `system_admin` role, which ripples through
every one of the 31 matrix rows and widens the permission sweep from 6 to 7 roles —
a large, security-sensitive change to satisfy a rare, slow-changing, operator-level
need. School and area provisioning therefore joins bootstrap on the CLI side.

**Net effect: this CCR adds no new role and does not touch the tenancy model.**
Every new operation is school-scoped and fits the existing `school`/`own` grant
vocabulary unchanged.

## Decision 3 — how a teacher gets a password

The data model already answers this, and the answer is not "the admin types one in".

- `UserAccount.status` defaults to **`invited`** (`schema.prisma:209`)
- `UserAccount.passwordHash` is **nullable**, and the field comment says why:
  *"nullable because an `invited` account has no password until it's accepted"*
  (`schema.prisma:206`)
- `SECURITY-BASELINE.md` SEC-AUTH-3: *"Disabled/`invited` accounts cannot
  authenticate (AUTH-003)"*

So an invite→accept flow is what the schema and the security baseline were both
already written against. This CCR implements it rather than inventing something.

**Out-of-band token, not email.** ADR-0005 puts SEIP on-premise; an on-prem school
server may have no SMTP relay at all, and making onboarding depend on one would
strand exactly the deployments this product targets. `inviteMember` therefore
returns a single-use token **to the calling admin**, who passes it to the teacher
by whatever channel the school already uses. The admin never learns the password.

Schema cost is two nullable columns on `user_account` (`invite_token_hash`,
`invite_expires_at`) — an invite is 1:1 with an account, so a separate table would
buy nothing. SHA-256 of a 256-bit random, mirroring the existing `RefreshToken`
handling in `packages/auth/src/refresh-token.ts:12-20`.

## Changes

| Surface | Change |
|---|---|
| `openapi.yaml` | **2.8.0 → 2.9.0** additive: 5 new operations, 6 new schemas |
| `permissions.yaml` | **1.4.0 → 1.5.0** additive: 4 matrix rows + 1 `unauthenticated:` entry |
| `error-codes.yaml` | **1.3.0 → 1.4.0** additive: `AUTH-005` (invite invalid/expired/used) |
| `prisma/schema.prisma` | `UserAccount.inviteTokenHash`, `UserAccount.inviteExpiresAt` — both nullable |
| migration | one additive migration, two nullable columns, no generated column or trigger involved |
| `packages/auth` | `createInviteToken` / `hashInviteToken`; first real caller of `hashPassword` |
| `packages/database` | `repositories/identity.ts` — invite, accept, list members, list personnel, end membership |
| `apps/api` | `routes/members.ts`; `acceptInvite` added to the `AUTH_PATHS` rate limiter |
| `apps/web` | admin members page; `listPersonnel` replaces raw UUIDs in 4 director/evaluator screens |
| `scripts/` | `bootstrap-admin.mjs` (Decision 1), `provision-school.mjs` (Decision 2) |
| `prisma/seed.mjs` | unchanged — taxonomy only, deliberately |

## New operations

| operationId | Route | Grant | Notes |
|---|---|---|---|
| `listPersonnel` | `GET /personnel` | `school_admin: school`, `director: school`, `evaluator: school` | Also fixes the raw-UUID screens. `evaluator` needs it to see who they are scoring |
| `listMembers` | `GET /members` | `school_admin: school` | Admin cannot manage what they cannot see |
| `inviteMember` | `POST /members` | `school_admin: school` | Creates `UserAccount(invited)` + `SchoolMembership` + optional `PersonnelProfile`, one transaction. Returns the invite token **once** |
| `endMembership` | `POST /members/{membershipId}/end` | `school_admin: school` | Sets `effective_to`. Offboarding is not optional — without it there is no way to revoke access |
| `acceptInvite` | `POST /auth/accept-invite` | **unauthenticated** | Token + chosen password → `passwordHash` set, `status` → `active` |

`personnel` is an optional block on `inviteMember` because an external committee
`evaluator` is a member of the school without being evaluated by it — mirroring
`CurrentUser.personnel`, which is already nullable for exactly this reason (CCR-002).

## Breaking? — **No. Additive, minor bump.**

Per `contract-policy.md`: *"Additive (new endpoint, new optional field, new error
code, new event) → minor bump."* Five new operations, six new schemas, one new
error code, two new nullable columns. Nothing removed, nothing retyped, no
existing constraint tightened. `oasdiff breaking` should report clean, and the
compatibility gate will not demand a major bump.

> **Self-correction.** `.ai-team/task-board.yaml` (`612f7f3`) and
> `PROJECT_STATE.md` (`9d0fb5e`) both state that BLOCK-001/002/003 each need a
> "CCR + **major** bump". That was my assertion, made before the change was
> designed, and it is wrong for this one: adding operations is additive under the
> project's own policy. The board and PROJECT_STATE need correcting to "CCR +
> version bump", with the major/minor call made per CCR. Flagged here rather than
> quietly bumping the number, because the same claim is what a future session
> would otherwise trust.

A CCR is still warranted despite semver not requiring one: this change adds a
**second unauthenticated write operation** to the API, and `permissions.yaml`
records unauthenticated entries as deliberate reviewed decisions ("silence is
never treated as *no authz needed*"). That judgement is the user's, not semver's.

## Security review (contract-policy step 2)

**`acceptInvite` is the sensitive surface.** Requirements:
- Rate-limited on the existing login limiter path (SEC-AUTH-5). Note the audit
  found `/auth/refresh` is currently *not* limited despite also being
  unauthenticated — do not repeat that here.
- Uniform `AUTH-005` for unknown, expired, and already-used tokens. No oracle.
- Token single-use: cleared in the same transaction that sets the password.
- Password minimum length enforced server-side. SEC-AUTH-1 specifies storage
  (argon2id, already correct) but states no length floor — this CCR proposes 12
  characters and a corresponding SECURITY-BASELINE line, since the first password
  policy in the system should be written down rather than implied.
- Accepting an invite must not authenticate the caller. Return 204; the user then
  logs in normally, so `invited → active` is enforced once, in `login`, by
  SEC-AUTH-3.

**`inviteMember` must derive `school_id` from the caller, never the body.** The
audit found four fields already trusting client-supplied FKs — including
`createEvidence.owner_personnel_id`, which lets a `school`-grant caller attach
evidence to another school's personnel (`apps/api/src/routes/evidence.ts:139-152`).
An identity-creation operation with that bug is materially worse. Explicit
acceptance criterion, with a test.

**Validation that must be server-side, each mapping to an existing constraint:**
- `email` lowercased before insert — the `user_account` CHECK compares
  `CAST(email AS BINARY)` against its lowercase form and will 500 on mixed case.
- `rank_level_code` must exist **and** its `role_family` must match
  `position_role`; a mismatch silently selects the wrong framework's rubric →
  VAL-003.
- Re-inviting somebody who already holds an active membership in the school must
  return RES-002 (409), not surface the `no-overlapping-active-membership`
  constraint as a 500. The audit found unmapped `P2003` already doing this
  elsewhere.
- Invite tokens never logged, never in an `AuditEvent` snapshot (SEC-AUTH-1's
  "never logged" applies to any credential, not only passwords).

**Audit trail:** `inviteMember` and `endMembership` change who can access
PDPA-scoped evidence and must write `AuditEvent` rows. Note `permissions.yaml`
already promises *"Every deny path emits an AuditEvent with action=access_denied"*
and the audit found zero implementations of that — this CCR should not add to
that debt.

## Explicitly deferred

- **Self-service password reset.** Same token machinery; not needed to unblock.
  An admin can `endMembership` and re-invite in the interim.
- **Editing a `PersonnelProfile`** (name, rank change on promotion). Real need —
  วิทยฐานะ changes are how careers work — but not a blocker. A wrong
  `rank_level_code` today means deleting and re-inviting.
- **Bulk import.** A 60-teacher school onboarding one at a time is tedious;
  it is not broken.
- **A `system_admin` role.** Only revisit if multi-school-per-install becomes a
  real deployment shape (Decision 2).

## Verification plan

The acceptance criterion that actually matters is the one the current suite cannot
pass:

```bash
npm run db:reset && npm run db:migrate && npm run db:seed
npm run bootstrap:admin -- --email=... --school=...
# then, through the HTTP API alone — no Prisma writes:
#   login as admin -> inviteMember(teacher) -> acceptInvite -> login as teacher
```

- e2e test walking exactly that, with **no** direct Prisma writes in its setup.
- Permission sweep extended to all 5 operations (and while there, close the two
  undocumented gaps the audit found: `completeFileUpload`,
  `getEvidenceFileDownloadUrl`).
- Negative tests: cross-school invite → RES-001; body-supplied `school_id`
  ignored; expired / reused / unknown token → indistinguishable AUTH-005;
  `rank_level_code` ÷ `position_role` mismatch → VAL-003.
- `tests/e2e/global-setup.mjs` keeps its direct inserts for now — removing those
  is BLOCK-002's acceptance criterion, once agreements are creatable too.

## Related

- `SEIP-BLOCK-001` (this), `SEIP-BLOCK-002` (CCR-015, depends on `listPersonnel`)
- ADR-0004 solo model — user is final approver · ADR-0005 on-prem (drives the
  no-SMTP decision)
- SEC-AUTH-1/3/5, SEC-TEN-1/2/3
- `docs/qa/QUALITY-GATES.md` § Coverage caveats — the fixture shortcut that hid this
- Audit findings: "no onboarding path", "raw UUIDs as primary user-facing text",
  "unvalidated FK fields"
