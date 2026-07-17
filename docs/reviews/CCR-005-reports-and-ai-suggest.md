# CCR-005: Reports API + AI mapping suggest (additive → OpenAPI 2.1.0)

## Request
Add report list/create/get operations and evidence mapping suggest (local AI
path per ADR-0007). Unblock SPA and worker jobs without breaking v2.0 clients
(additive paths/schemas only).

## Changes
| Surface | Change |
|---|---|
| openapi.yaml | version **2.0.0 → 2.1.0**; paths `/reports`, `/reports/{reportId}`, `POST .../mappings/suggest`; schemas Report*, MappingSuggest* |
| permissions.yaml | matrix rules for new operationIds; version **1.0.0 → 1.1.0** |
| events.yaml | `report.generated`, `ai.suggestion.created`; version **1.0.0 → 1.1.0** |
| error-codes.yaml | `RPT-001`, `AI-001`; version **1.0.0 → 1.1.0** |
| x-deferred | reports + ai-mapping removed from deferred (implemented) |

## Breaking?
No — additive only (oasdiff should report no breaking changes).

## Implementation tasks
SEIP-ARCH-003 / API-003 / WORKER-002 / UI-004 / API-004 / UI-005 (this branch bundles them).
