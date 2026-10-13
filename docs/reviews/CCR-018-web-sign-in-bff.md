# CCR-018: web sign-in through Keycloak behind a BFF (additive)

Status: **APPLIED 2026-10-13** (additive, so a minor bump. No owner approval is needed under contract-policy.md; it is recorded here and in the close-out.)
Task: `SEIP-P1-004` · Decision: ADR-0014 §4 · Depends on: SEIP-P1-003 (Keycloak tokens, `min_acr`)
Shipped: openapi **4.1.0** · permissions **2.1.0** · error-codes **2.1.0** · events unchanged

## Why

ADR-0014 §4 moves the web to a server-side session. The browser never holds an access or refresh token. It holds an httpOnly `__Host-seip` cookie that the API maps to a session row. This closes the gap the web's `useAuth.tsx` has documented since CCR-008: under contract 1.x–4.0 a token pair in the JSON body had to live in `sessionStorage`, where it is readable by script.

## What changed

| Contract | Change |
|---|---|
| openapi | `GET /auth/web/login` (webLogin): 302 to Keycloak, with code flow, PKCE, state and nonce in a signed short-lived cookie. `acr=mfa` asks for the second factor. |
| openapi | `GET /auth/web/callback` (webCallback): exchanges the code and starts the session. Every failure is a 302 to `/login?error=sso`. |
| openapi | `POST /auth/web/logout` (webLogout): revokes the session, ends the Keycloak session and clears the cookies. Idempotent. |
| openapi | New security scheme `webSession` (cookie `__Host-seip`), listed as an alternative to `bearerAuth` at top level. New `X-CSRF-Token` header parameter. |
| error-codes | `AUTH-007` (403): a cookie-session write without a matching `X-CSRF-Token`. |
| permissions | The three operations are `unauthenticated`, with the reason for each. |

Nothing is removed or narrowed. oasdiff reports **no breaking changes from 4.0.0 to 4.1.0**. The bearer flow (`login` / `refreshToken` / `logout`) is unchanged and keeps its `x-seip-sunset: P1` marker.

## Session rules (ADR-0014 §4, implemented in apps/api)

- **Cookies:**
  - `__Host-seip`: random 256-bit value, httpOnly, Secure, SameSite=Lax, Path=/. Only its SHA-256 is stored, in `web_session`.
  - `__Host-seip-csrf`: random, readable by the page, SameSite=Strict. On POST / PUT / PATCH / DELETE it must come back as `X-CSRF-Token` and match the hash on the session row.
- **Lifetime:** 30 min idle, 8 h maximum.
- **Keycloak liveness:** the Keycloak refresh token is kept encrypted on the row. At most once a minute per session the API refreshes it. If Keycloak has ended the session (logout elsewhere, admin revoke), the web session ends too.
- **Step-up:** a successful callback replaces any existing session. A session never upgrades in place, so its acr is exactly what that sign-in proved.
- **Redirects:** `return_to` must be a same-site path. Anything else becomes `/`, which guards against open redirects.

## Verified

See SEIP-P1-004 on the board and `docs/qa/QUALITY-GATES.md`.
