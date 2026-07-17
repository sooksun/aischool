# ADR-0007: AI mapping provider and PDPA residency (OPEN-3)

## Status
Accepted (local-only path)

## Context

OPEN-3 blocked AI-mapping contracts: which provider, and may personal data leave
Thai on-prem hardware (ADR-0005)? Evidence often includes learner images/voice.

## Decision

1. **Default and only enabled path in SEIP v2.1:** **on-prem heuristic mapping**
   (`local_heuristic`) that never calls an external network. It scores
   evidence title/description tokens against indicator names already in the DB
   and creates `mapping_source=ai_suggested` rows for human confirm.

2. **Foreign / cloud LLM providers remain forbidden** while ADR-0005 holds,
   unless a future ADR explicitly authorizes a named provider, data classes,
   and residency controls (SEC-PDPA-6).

3. The API surface `POST .../mappings/suggest` is the stable contract; the
   implementation is swappable later behind that operationId without changing
   clients, provided data still does not leave on-prem without a new ADR.

## Consequences

- OPEN-3 is **closed for product progress** with a safe default.
- Cloud AI remains an open product option but requires superseding this ADR.
- UI must label suggestions as automatic/AI and require human confirm
  (`actOnMapping` confirm) — never auto-confirm.

## Approved By
User direction to implement reports/AI (2026-07-18); recorded by Grok co-pilot.

## Date
2026-07-18
