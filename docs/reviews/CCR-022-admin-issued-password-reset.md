# CCR-022: one-time password reset issued by a school admin (additive)

Status: **APPLIED 2026-10-13.** The change is additive, so it takes a minor bump. It adds a privileged capability, which is highlighted for the owner below.
Task: `SEIP-P1-013` · Requirement: FR-099 (PRD §7), US-26 · Shipped: openapi **4.5.0**, permissions **2.4.0**, error-codes **2.2.0**

## Why

FR-099 has two parts:
- A person with a verified email or phone resets their own password by link or OTP. That part needs an email/SMS provider entered in the NFR-Res-06 register, so it is not built yet.
- A person with no verified channel gets a one-time link or code from the school admin. That part needs nothing outside SEIP, and is what this CCR builds.

## What changed

- `POST /members/{membershipId}/password-reset` (issuePasswordReset):
  - Granted to school_admin (`school`), with `min_acr: 2`.
  - Returns `{ reset_token, expires_at }` once. The token is valid for 30 minutes and only its hash is stored (`password_reset`).
  - Issuing a new one cancels any earlier unused one.
  - VAL-002 for the caller's own account, and for an account that has never set a password (re-invite instead).
  - Audited as `password_reset_issued`.
- `POST /auth/password-reset` (completePasswordReset):
  - Unauthenticated: the token is the credential. Throttled like acceptInvite.
  - Unknown, expired and used tokens all return **AUTH-008** (new code).
  - On success, every session of the account ends: refresh tokens, browser sessions and app devices. The app's Keycloak offline sessions are deleted, all its Keycloak sessions are signed out, and the SEIP ID password is set to the same value (best effort).
  - Audited as `password_reset_completed`.
- Web:
  - A "ตั้งรหัสผ่านใหม่" button on each active member in the members page.
  - A `/reset-password` page.
  - A "ลืมรหัสผ่าน?" hint on the login page.

## For the owner

A school admin can reset the password of anyone in the school, the director included. The safeguards are:
- step-up on issue
- one-time use within 30 minutes
- an audit row at each end
- the account's SEIP ID second factor is not touched, so any step-up still needs the person's own device

If the director should be excluded, or a second approver required, that is a follow-up change.

## Verified

- `apps/api/test/password-reset.test.mjs` (4 tests, one against the real Keycloak):
  - single use, expiry, and cancellation by a newer token
  - old refresh tokens refused
  - the app refused at once and unable to renew
  - SEIP ID takes the new password
  - VAL-002, RES-001 and PERM-001 cases
- The permission-matrix sweep and the step-up test cover issuePasswordReset.
