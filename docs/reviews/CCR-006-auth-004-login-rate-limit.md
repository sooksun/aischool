# CCR-006: AUTH-004 login rate limit (additive)

## Request
Add error code for login throttling (SEC-AUTH-5 / SEIP-OPS-004).

## Changes
| Surface | Change |
|---|---|
| error-codes.yaml | version **1.1.0 → 1.2.0**; add `AUTH-004` http 429 |

## Breaking?
No — new code only.
