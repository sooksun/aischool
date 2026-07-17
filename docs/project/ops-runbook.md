# SEIP Operations Runbook (SEIP-OPS-003)

Status: Operational draft for **staging / on-prem** (ADR-0005)  
Audience: school or area IT operator + developer bring-up  
Related: `docker-compose.staging.yml`, `infra/`, `.env.staging.example`, `docs/qa/QUALITY-GATES.md` (backup/restore release gate)

---

## 1. Environments

| Env | Compose file | Secrets | Public exposure |
|---|---|---|---|
| **dev** | `docker-compose.yml` | Throwaway values in file + `.env.example` | Postgres/MinIO ports on localhost for tooling |
| **staging / on-prem** | `docker-compose.staging.yml` | **Only** via gitignored `.env.staging` (or OS secrets) | Prefer edge TLS proxy; DB/MinIO not published |

Same architecture everywhere: **Node API + SPA + PostgreSQL + MinIO (S3 API)**. Configuration differs; code does not.

---

## 2. Secrets (SEC-REPO-1)

**Never commit** `.env`, `.env.staging`, private keys, or real MinIO/Postgres passwords.

| Variable | Used by | Notes |
|---|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | postgres, api/worker `DATABASE_URL` | Strong password; rotate with re-encrypt plan |
| `DATABASE_URL` | api, worker (dev / process) | Staging compose builds this from POSTGRES_* |
| `JWT_SECRET` | api | ≥ 32 characters; rotating invalidates sessions |
| `S3_ENDPOINT` | api, worker | Staging internal: `http://minio:9000` |
| `S3_BUCKET` | api, worker, minio-init | Private bucket; no anonymous read |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | api, worker, minio root (staging) | Treat as root secrets; separate app keys later if needed |
| `S3_REGION` | api, worker | Dummy for S3 SDK; MinIO accepts any |
| `PORT` | api | Default `3001` |
| `NODE_ENV` | api, worker | `production` in staging compose |
| `WORKER_POLL_MS` | worker | Job poll interval (default 2000) |
| `WORKER_GC_AFTER_DAYS` | worker | Soft-deleted evidence GC age (default 7) |
| `VITE_API_BASE` | web build arg | Empty = same-origin `/api` behind nginx (recommended) |

Templates:

- Dev: `.env.example` → copy to `.env`
- Staging: `.env.staging.example` → copy to `.env.staging`

---

## 3. Staging bring-up checklist

1. Install Docker Engine + Compose v2 on the host (Thai on-prem server per ADR-0005).
2. `cp .env.staging.example .env.staging` and fill secrets (generate with `openssl rand -base64 32`).
3. Build and start:
   ```bash
   docker compose -f docker-compose.staging.yml --env-file .env.staging up -d --build
   ```
4. Confirm health:
   ```bash
   docker compose -f docker-compose.staging.yml --env-file .env.staging ps
   # Expect: postgres, minio, api, worker, web (minio-init exited 0)
   # API container healthcheck is TCP :3001; process probe:
   curl -sS -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:3001/api/v1/auth/login \
     -H 'content-type: application/json' -d '{}'
   # expect 4xx with JSON error body (process up), not connection refused
   curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/
   # Worker has no HTTP port — check logs for the poll loop:
   docker compose -f docker-compose.staging.yml --env-file .env.staging logs --tail=20 worker
   ```
5. Install edge TLS (section 4).
6. Run seed **once** if empty taxonomy (operator decision):
   ```bash
   # from a one-shot node container on the same network, or host with DATABASE_URL pointed at published DB
   npm run db:seed
   ```
7. Create the first school_admin / director accounts via approved bootstrap procedure (not documented as open registration).

---

## 4. TLS termination

- **Terminate TLS at the edge**, not inside the API process (matches reverse-proxy shape already simulated by Vite dev proxy).
- Example config: `infra/nginx/seip-staging.conf.example`
- Certificates: school/area CA or ACME on an internal name — **never commit PEMs**.
- After TLS works, disable plain HTTP or redirect 80 → 443 only.
- HSTS is enabled in the example; enable only when HTTPS is permanent for that hostname.

### Verification

```bash
curl -I https://seip.example.school.th/
curl -I https://seip.example.school.th/api/v1/auth/me   # expect 401 without token
```

---

## 5. Backup and restore (release gate subject)

Evidence videos and evaluation rows are **irreplaceable**. Backup **both** Postgres and MinIO on the same schedule (or document RPO/RTO if staggered).

### 5.1 PostgreSQL — backup

```bash
# Staging compose network; adjust container name from `docker compose ps`
docker compose -f docker-compose.staging.yml --env-file .env.staging exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "backup-seip-$(date +%Y%m%d).dump"
```

Store dumps on encrypted media **off the app disk** (or second NAS on-prem). Retain per school policy (entity-dictionary retention intents: cycle+N / evidence+N).

### 5.2 PostgreSQL — restore

```bash
# Destructive — confirm environment first
docker compose -f docker-compose.staging.yml --env-file .env.staging exec -T postgres \
  pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists < backup-seip-YYYYMMDD.dump
```

Then re-run `prisma migrate deploy` if restore is older than current migrations.

### 5.3 MinIO (evidence objects) — backup

Option A — `mc mirror` to a second disk/NAS:

```bash
mc alias set staging http://127.0.0.1:9000 "$S3_ACCESS_KEY" "$S3_SECRET_KEY"   # only if port published for backup window
mc mirror --overwrite staging/seip-evidence /backup/seip-evidence/
```

Option B — filesystem snapshot of the Docker volume `seip_staging_minio` while MinIO is **stopped** (consistent snapshot).

### 5.4 MinIO — restore

```bash
mc mirror --overwrite /backup/seip-evidence/ staging/seip-evidence/
```

Or restore the volume snapshot, then start MinIO.

### 5.5 Backup/restore test (QUALITY-GATES release gate)

Before first production go-live, and before each release that touches storage or schema:

1. Take Postgres dump + MinIO mirror on staging.
2. Restore into a **throwaway** compose project name.
3. Confirm: login works; an evidence row’s object is GET-able via presigned flow; mapping/score rows intact.
4. Record date + operator in the release notes.

---

## 6. Disk growth and retention

- Teaching videos dominate growth (ADR-0005 risk).
- Monitor volume size for `seip_staging_pgdata` and `seip_staging_minio`.
- Soft-deleted evidence GC is handled by the **worker** service (`WORKER_GC_AFTER_DAYS`).
- Longer school retention (`evidence+N`) still needs a written purge policy; do not delete volumes without approval.

---

## 7. Worker process (SEIP-WORKER-001)

Staging runs `worker` as a first-class compose service (`infra/docker/Dockerfile.worker`).

| Job type | Role |
|---|---|
| `file.process` | Virus-scan stub + optional video duration probe; updates `scan_status` |
| `storage.gc` | Removes orphaned/soft-deleted objects after `WORKER_GC_AFTER_DAYS` |
| outbox dispatch | Publishes transactional outbox rows (domain events) |
| future | `report.generate`, AI mapping — same process, new job types |

API never runs heavy async work inline — it enqueues / writes outbox only.

---

## 8. What this task does *not* cover

| Deferred | Owner task |
|---|---|
| Login rate limiting (refined) | SEIP-OPS-004 |
| Branch protection GitHub settings | ops (manual / `gh`) |
| Full production systemd units | may replace compose later without changing app architecture |
| Official PA PDF layout / cloud AI | product ADRs — not ops |

---

## 9. Path notes

Ops work stays in `infra/**`, `docker-compose*.yml`, env examples, and this runbook.
Do not edit product feature paths (`apps/web/src/**`, `apps/api/src/routes/**`) from ops tasks.
