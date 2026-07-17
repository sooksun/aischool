# Close-out: SEIP-OPS-003 — Staging compose + secrets/TLS/backup checklist

Owner: Grok · Date: 2026-07-18 · Branch: `feat/SEIP-OPS-003-staging-ops`  
Rebased onto `origin/develop` (includes WORKER-001) and extended with worker service.

## Delivered

| Artifact | Purpose |
|---|---|
| `docker-compose.staging.yml` | Staging: postgres, minio, minio-init, **api, worker, web** — no hardcoded secrets |
| `infra/docker/Dockerfile.api` | Multi-stage API + `prisma migrate deploy` on start |
| `infra/docker/Dockerfile.worker` | Multi-stage worker (scan / outbox / GC) |
| `infra/docker/Dockerfile.web` | SPA build + nginx static |
| `infra/docker/nginx-web.conf` | Static SPA server inside web image |
| `infra/nginx/seip-staging.conf.example` | Edge TLS reverse proxy example |
| `infra/README.md` | Index + bring-up |
| `docs/project/ops-runbook.md` | Secrets, TLS, backup/restore Postgres **and** MinIO, worker notes |
| `.env.staging.example` | Staging secret template (gitignored copy → `.env.staging`) |
| `.env.example` | Dev template + worker vars + pointer to staging |

## Acceptance criteria

| AC | Result |
|---|---|
| Staging compose for postgres + minio + api + web (+ worker) | **DONE** |
| Secrets never committed; templates document vars | **DONE** |
| Backup/restore checklist Postgres + MinIO | **DONE** (ops-runbook §5) |
| TLS termination guidance | **DONE** (nginx example + runbook §4) |

## Verification

```bash
# With dummy env for interpolation:
# POSTGRES_USER=u POSTGRES_PASSWORD=p JWT_SECRET=x… S3_ACCESS_KEY=a S3_SECRET_KEY=s…
docker compose -f docker-compose.staging.yml --env-file .env.staging config --quiet
```

Full image build is operator-time; config/layout validated in task close-out.

## Paths not touched

- `apps/*/src/**` product code
- `prisma/schema.prisma`

## Next

- Merge this branch → `develop`
- **SEIP-OPS-004** edge rate limiting (optional)
- Product features (reports/AI UI) stay on their own branches
