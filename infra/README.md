# Infrastructure (SEIP-OPS-003+)

On-prem / staging layout for SEIP. Architecture decisions: **ADR-0005** (MinIO + on-premise).

| Path | Purpose |
|---|---|
| `docker/Dockerfile.api` | Multi-stage image for `apps/api` |
| `docker/Dockerfile.web` | Static SPA image for `apps/web` |
| `docker/nginx-web.conf` | Static file server inside the web image |
| `nginx/seip-staging.conf.example` | **Edge** TLS reverse proxy example (host or separate container) |
| `../docker-compose.staging.yml` | Staging stack (secrets via env, not git) |
| `../docs/project/ops-runbook.md` | Backup/restore, TLS, secrets, bring-up checklist |

## Quick start (staging-shaped)

```bash
cp .env.staging.example .env.staging
# edit .env.staging — real passwords, JWT_SECRET ≥ 32 chars

docker compose -f docker-compose.staging.yml --env-file .env.staging up -d --build
```

Then point a host nginx at `infra/nginx/seip-staging.conf.example` (or terminate TLS with Caddy/Traefik equivalently).

**Dev** continues to use root `docker-compose.yml` (throwaway credentials, published ports for local tools). Do not reuse staging secrets in dev.

## Collision note (task board)

- **SEIP-OPS-003** owns this tree + staging compose + ops-runbook.
- **SEIP-WORKER-001** may add a `worker` service after this lands — extend staging compose in that task, do not fork a second stack.
