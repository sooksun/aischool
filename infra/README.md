# Infrastructure (SEIP-OPS-003+)

On-prem / staging layout for SEIP. Architecture decisions: **ADR-0011** (hosting), **ADR-0012** (PostgreSQL 18), **ADR-0013** (S3 API / SeaweedFS).

| Path | Purpose |
|---|---|
| `docker/Dockerfile.api` | Multi-stage image for `apps/api` (+ migrate on start) |
| `docker/Dockerfile.worker` | Multi-stage image for `apps/worker` (async jobs) |
| `docker/Dockerfile.web` | Static SPA image for `apps/web` |
| `docker/nginx-web.conf.template` | The web container: SPA + `/api/` → api + `/<bucket>/` → seaweedfs (browser origin for presigned URLs) |
| `../.dockerignore` | Keeps `.env*`, `node_modules`, backups out of every image |
| `../scripts/ops/smoke-install.mjs` | End-to-end check of an install through the public origin (CI gate **deploy smoke**) |
| `../docs/project/INSTALL.th.md` | Step-by-step install guide (Thai) |
| `nginx/seip-staging.conf.example` | **Edge** TLS reverse proxy + rate limit + security headers (OPS-004) |
| `nginx/http-rate-zones.conf.example` | `limit_req_zone` lines for main `http {}` block |
| `../docker-compose.staging.yml` | Staging stack: postgres, seaweedfs, migrate, api, worker, web, clamav, backup |
| `../docs/project/ops-runbook.md` | Backup/restore, TLS, secrets, bring-up checklist |

## Quick start (staging-shaped)

```bash
cp .env.staging.example .env.staging
# edit .env.staging — real passwords, JWT_SECRET ≥ 32 chars

docker compose -f docker-compose.staging.yml --env-file .env.staging up -d --build
```

Then point a host nginx at `infra/nginx/seip-staging.conf.example` (or terminate TLS with Caddy/Traefik equivalently).

**Dev** continues to use root `docker-compose.yml` (throwaway credentials, published ports for local tools). Do not reuse staging secrets in dev.

## Services

| Service | Public? | Role |
|---|---|---|
| postgres | no (internal) | Primary data store |
| seaweedfs | no (internal) | S3-compatible evidence storage |
| api | localhost:3001 | HTTP API (`/api/v1`) |
| worker | no | Scan, duration, outbox, GC |
| web | localhost:8080 | SPA + gateway: `/api/` → api, `/seip-evidence/` → seaweedfs; edge nginx terminates TLS in front |
| ops | no (`--profile ops`, `run --rm`) | Seed, provision-school, bootstrap-admin |

## Ownership

- **SEIP-OPS-003** owns this tree + staging compose + ops-runbook.
- Product code changes (`apps/*/src`) stay on feature branches, not here.
