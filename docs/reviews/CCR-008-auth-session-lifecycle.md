# CCR-008: Auth session lifecycle — refreshToken + logout (additive)

## Request
Close the SEC-AUTH-2 gap found by the 2026-07-18 code-status audit: the refresh-token
rotation/revocation layer (`RefreshToken` model, `packages/database` repository
functions, `packages/auth` opaque-token helpers) was fully built but had no
endpoints — login minted refresh tokens that nothing could ever use or revoke,
sessions hard-expired every 15 minutes, and logout was client-side-only.

## Changes
| Surface | Change |
|---|---|
| openapi.yaml | version **2.2.0 → 2.3.0**; add `POST /auth/refresh` (`refreshToken`, security: [], body `RefreshRequest`, 200 `TokenPair`) and `POST /auth/logout` (`logout`, bearer, optional body `LogoutRequest`, 204); add `RefreshRequest`/`LogoutRequest` schemas |
| permissions.yaml | version **1.2.0 → 1.3.0**; `refreshToken` under `unauthenticated:` (the refresh token IS the credential), `logout` under `any_authenticated:` |
| error-codes.yaml | no change — reuses AUTH-001 (invalid/replayed token, no oracle), AUTH-002 (expired), AUTH-003 (account not active) |

## Semantics
- **Rotation**: every successful refresh revokes the presented token and issues a
  new pair (`rotateRefreshToken` links old→new via `replacedById`). Clients must
  replace both stored tokens.
- **Reuse detection**: presenting a token whose `revokedAt` is already set is
  treated as theft — `revokeAllRefreshTokensForUser` fires and the response is
  the same AUTH-001 as any invalid token (no oracle distinguishing the cases).
- **Logout**: with `refresh_token` in the body revokes that token; without one
  revokes all the caller's live tokens. Idempotent 204 either way; a token not
  owned by the caller is ignored, not an error.
- Access tokens are not blacklisted — 15-minute TTL bounds the exposure, same
  trade-off `useAuth.tsx`'s header comment already documents.

## Breaking?
No — two new operations and two new request schemas; nothing existing changed.
`oasdiff` classifies as additive.
