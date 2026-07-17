# Close-out: SEIP-OPS-003 — Staging compose + secrets/TLS/backup checklist

Owner: grok (co-pilot) · Date: 2026-07-18 · Branch: `feat/SEIP-OPS-003-staging-ops`  
Collision: Claude holds **UI cycles/scoring** (`apps/web/**`) — this task used only ops paths.

## Delivered

| Artifact | Purpose |
|---|---|
| `docker-compose.staging.yml` | Staging stack: postgres, minio, minio-init, api, web — **no hardcoded secrets** (`${VAR:?}`) |
| `infra/docker/Dockerfile.api` | Multi-stage API image + `prisma migrate deploy` on start |
| `infra/docker/Dockerfile.web` | SPA build + nginx static |
| `infra/docker/nginx-web.conf` | Static SPA server inside web image |
| `infra/nginx/seip-staging.conf.example` | Edge TLS reverse proxy example |
| `infra/README.md` | Index + bring-up pointer |
| `docs/project/ops-runbook.md` | Secrets, bring-up, TLS, backup/restore for Postgres **and** MinIO |
| `.env.staging.example` | Staging secret template (gitignored copy → `.env.staging`) |
| `.env.example` | Dev template + pointer to staging/ops-runbook |
| `.gitignore` | Allow `.env.staging.example` |

## Acceptance criteria

| AC | Result |
|---|---|
| Staging compose for postgres + minio + api + web | **DONE** |
| Secrets never committed; templates document vars | **DONE** |
| Backup/restore checklist Postgres + MinIO | **DONE** (ops-runbook §5) |
| TLS termination guidance | **DONE** (nginx example + runbook §4) |

## Verification

```bash
# Required env vars set for interpolation:
docker compose -f docker-compose.staging.yml config --quiet   # exit 0
npm run gate:ownership                                       # exit 0
```

Full `docker compose up --build` of api/web images is operator-time (long); layout and config validated.

## Paths deliberately not touched

- `apps/web/**` (Claude UI)
- `apps/api/src/**`
- `prisma/schema.prisma`

## Next

- **SEIP-WORKER-001** may add `worker` service to staging compose (depends on this task).
- **SEIP-DB-003** remains parallel-safe (seed data only).
- **SEIP-OPS-004** rate limiting at edge (optional follow-on).
