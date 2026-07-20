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
| `MYSQL_ROOT_PASSWORD` / `MYSQL_USER` / `MYSQL_PASSWORD` / `MYSQL_DATABASE` | mysql, api/worker `DATABASE_URL` | Strong passwords; rotate with re-encrypt plan (ADR-0008) |
| `DATABASE_URL` | api, worker (dev / process) | Staging compose builds this from MYSQL_*; dev uses Laragon MySQL `mysql://root@localhost:3306/seip` |
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
   # Expect: mysql, minio, api, worker, web (minio-init exited 0)
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

## 4b. Rate limiting & security headers (SEIP-OPS-004 / SEC-AUTH-5)

### Edge nginx (primary)

1. Add zone definitions from `infra/nginx/http-rate-zones.conf.example` into the main `http { }` block:
   - `seip_login` — 5 req/min per IP (location burst 8)
   - `seip_api` — 30 req/s per IP background (location burst 60)
2. Use `infra/nginx/seip-staging.conf.example` which applies:
   - `limit_req` on `= /api/v1/auth/login` → HTTP **429** when exceeded
   - `limit_req` on `/api/` for general API flood dampening
   - Security headers: HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
     `Referrer-Policy`, `Permissions-Policy`, hide `server_tokens`

```bash
# After deploying edge config — hammer login and expect 429 from nginx:
for i in $(seq 1 20); do
  curl -sS -o /dev/null -w "%{http_code}\n" -X POST https://seip.example.school.th/api/v1/auth/login \
    -H 'content-type: application/json' -d '{"email":"x@y.z","password":"wrong-password"}'
done
# Expect a mix of 401 (API) then 429 (edge limit)

# Headers on SPA:
curl -sSI https://seip.example.school.th/ | grep -iE 'strict-transport|x-content-type|x-frame|referrer'
```

### API defense-in-depth

Even without nginx (local API on :3001), `apps/api` enforces:

| Bucket | Default | Env override |
|---|---|---|
| Per IP | 40 / 15 min | `LOGIN_RATE_MAX_PER_IP`, `LOGIN_RATE_WINDOW_MS` |
| Per email | 12 / 15 min | `LOGIN_RATE_MAX_PER_EMAIL` |

Exceeded attempts return **AUTH-004** (HTTP 429) + `Retry-After`.  
API also sets baseline headers (`nosniff`, `DENY` frame, `no-store` cache) via `security-headers` plugin.

Set `TRUST_PROXY=true` (or `NODE_ENV=production`) so `request.ip` uses `X-Forwarded-For` from the edge.

### Multi-instance note (cleanup M4 — accepted MVP)

| Layer | Scope | Launch status |
|---|---|---|
| Edge nginx `limit_req` on `/api/v1/auth/login` | Fleet-wide per client IP | **Primary — required in staging/prod** |
| API `LoginRateLimiter` (`apps/api/src/lib/login-rate-limit.ts`) | **One process** (`globalThis` singleton) | Defense-in-depth; local/dev still safe |

In-process counters are **not** shared across API replicas. That is **not a launch blocker** while the edge is always primary. Shared Redis (or similar) only if we scale many API instances *without* a trusted edge — see PROJECT_STATE Sprint 2+ remaining.

Tests may replace the process singleton via `installLoginRateLimiterForTests` and must restore it so other files in the same Node process are not left throttled.

---

## 4c. First-run bootstrap (CCR-014)

A freshly migrated + seeded database has the complete ว9/ว10 framework and **no
people at all**. Two operator commands turn it into something that can be logged
into. Both are CLIs on purpose, not API endpoints:

- **Nothing may create a school through the API.** All six roles in
  `permissions.yaml` are school- or area-scoped, and `area_admin` is read-only by
  contract (PERM-004, SEC-TEN-3), so no role can legitimately write across
  schools. Adding a `system_admin` to allow it would rewrite all 31 matrix rows.
- **The first admin cannot invite themselves.** A public bootstrap endpoint whose
  safety depends on a runtime "are there zero users?" check is wrong in exactly
  the cases that matter — a restore that left the DB empty, a freshly provisioned
  tenant. Running these needs DB access, which already implies more authority
  than they grant.

```bash
# 1. the school (idempotent; re-running with the same --code is a no-op)
node --env-file-if-exists=.env scripts/ops/provision-school.mjs \
  --code=SCH-001 --name="โรงเรียนตัวอย่าง" \
  --area-code=AREA-1 --area-name="สพป. เขต 1"     # area is optional

# 2. the first school_admin
#    Password comes from the environment, never a flag: argv is visible to every
#    process on the box via `ps` and lands in shell history. Omit it and one is
#    generated and printed ONCE.
SEIP_ADMIN_PASSWORD='choose-something-long' \
node --env-file-if-exists=.env scripts/ops/bootstrap-admin.mjs \
  --email=admin@school.ac.th --name="ผู้ดูแลระบบ" --school=SCH-001
```

Also available as `npm run provision:school -- …` / `npm run bootstrap:admin -- …`
(these build the workspace libs first). On Windows, npm mangles quoted arguments
containing spaces — call `node` directly as above when a name contains a space.

`bootstrap-admin` **refuses** to touch an account that already has a password. It
creates the first admin; it is not a password-reset tool. Recovery is a separate,
deliberate act.

Everything after this happens in the app: the admin opens **บุคลากร**, invites
people, and hands each person a single-use invite code. The invitee sets their own
password at `/accept-invite` — the admin never learns it. Codes expire in 14 days
and are shown exactly once (only a SHA-256 of each is stored), so a lost code
means re-inviting, not recovering.

There is no email dependency anywhere in that flow, deliberately: an on-prem
school server (ADR-0005) may have no SMTP relay.

## 5. Backup and restore (automated)

Evidence videos and evaluation rows are **irreplaceable**. Until 2026-07-20 this
section was two commands and a hope that someone typed them; the audit called it
the largest unbounded downside in the system. It is now a script that runs on a
timer and **proves each dump restorable before calling it a backup**.

### 5.1 Running it

```bash
# manual, from the repo (needs mysqldump + mysql on PATH; mc for objects)
npm run backup                       # dump + object mirror + verify + prune
npm run backup -- --no-objects       # database only
npm run backup -- --retain-days=30
```

Staging/on-prem runs it automatically — the `backup` service in
`docker-compose.staging.yml` loops on `BACKUP_INTERVAL_SECONDS` (default daily)
and logs each run to `docker logs`. A failed run prints `!!! BACKUP FAILED` and
retries next interval rather than stopping the schedule.

**Point `BACKUP_HOST_DIR` at storage on a different disk from the app.** The
default (`./backups`) is a bind mount so it is at least outside the Docker
volumes it protects, but a backup on the same disk as the database survives
exactly the failures that do not matter.

| variable | default | |
|---|---|---|
| `BACKUP_HOST_DIR` | `./backups` | host path for dumps + object mirror |
| `BACKUP_RETAIN_DAYS` | `14` | older artefacts pruned each run |
| `BACKUP_INTERVAL_SECONDS` | `86400` | schedule |

### 5.2 What it actually does

1. `mysqldump --single-transaction --routines --triggers --events` to
   `<dir>/seip-<timestamp>.sql.gz`, mode 0600, directory 0700 — dumps contain
   every evaluation score and every teacher's evidence metadata (PDPA at rest).
2. **Restores that dump into a scratch database and compares table counts**, then
   drops it. Fails the run if the restore errors or the counts differ.
3. `mc mirror` of the evidence bucket (without `--remove`: a mirror that deletes
   local copies of missing objects would faithfully replicate an accidental
   bucket wipe).
4. Prunes artefacts older than the retention window.

The password reaches `mysqldump` through `MYSQL_PWD`, never `-p` on the command
line, because argv is readable by every local user via `ps`.

### 5.3 Restoring

```bash
# drill: restore into a scratch database, report, drop it (the default)
npm run restore -- --from=backups/seip-2026-07-20-05-41-20.sql.gz --dry-run

# into a named database
npm run restore -- --from=<file> --into=seip_recovered

# over the live database — deliberately awkward
npm run restore -- --from=<file> --into=seip --i-understand-this-overwrites
```

The drill reports `tables / triggers / evidence / users` and **fails if the
restored database has no triggers**, because a restore that quietly lost them
gives you a database that accepts `DELETE` on `audit_event`.

Objects: `mc mirror --overwrite <dir>/objects-<timestamp>/ <alias>/seip-evidence/`.
After restoring a dump older than the current code, run `npm run db:migrate`.

### 5.4 Why the dump format matters (a real incident)

The first real run of `backup.mjs` **failed its own verify**, and the cause was a
schema bug nobody had noticed:

Three of the four triggers stored a trailing `;` inside their body. `mysqldump`
wraps a trigger body in `/*!50003 TRIGGER ... <body> */`, so a `;` at the end of
`<body>` terminated the statement before the closing `*/` and the restore died
with `syntax error near '*/'`. **Every backup this project had ever taken could
not restore its audit-immutability triggers** — and nothing would have said so.

Root cause: Prisma's migration runner passes each statement to the server *with*
its terminator, except a file's last. Fixed by migrations
`20260720060000`–`20260720060003`, which is why there is one `CREATE TRIGGER` per
migration file — merging them back would silently reintroduce the bug in every
trigger but the last.

The lesson is the one this section is built on: a backup that has never been
restored is a hypothesis, and the verify step is what turns it into a backup.

### 5.5 Backup/restore test (QUALITY-GATES release gate)

Before first production go-live, and before each release touching storage or schema:

1. `npm run backup` on staging — it self-verifies, so a green run is step 1 and 2.
   **On staging, not on a dev box.** The MySQL half needs `mysqldump`/`mysql` on
   PATH (Laragon ships them under `bin/mysql/*/bin`, which is not on PATH by
   default) and the object half needs `mc`, which the `backup` image installs but
   a Windows dev machine generally does not have. Verified 2026-07-20: on this
   dev machine the database dump verifies at 32 tables and the object mirror then
   exits 1 with `mc alias failed`, so **every local run to date has backed up the
   database only**. The script is right to fail loudly rather than report a
   partial backup as success — but a green *database* run is not a green backup.
2. `npm run restore -- --from=<latest> --dry-run` and check the reported counts
   against production expectations.
3. Restore objects into a throwaway bucket; confirm an evidence object is
   downloadable through the presigned flow.
4. Confirm login works against the restored database, and that
   `SELECT COUNT(*) FROM information_schema.triggers` is 4.
5. Record date + operator in the release notes.

## 5b. Malware scanning and the re-scan sweep (ADR-0009)

### 5b.1 Running the scanner

`clamav` is a first-class service in `docker-compose.staging.yml` and is **required**
whenever `SCAN_PROVIDER=clamav`. Two operational facts ADR-0009 promised were
documented here and were not, until this section existed:

- **Memory.** clamd holds the signature database resident — budget ~1 GB, plus
  headroom during a `freshclam` reload when both copies are briefly live. A host
  sized for API + worker alone will OOM the container, and an OOM-killed clamd
  means uploads stay `pending` (fail-closed), not that they pass.
- **Signatures.** The `clamav/clamav` image runs `freshclam` on a timer. Stale
  signatures are the silent failure mode: everything looks green while detection
  degrades. Check `docker compose logs clamav | grep -i "database updated"`.

Verify reachability without scanning anything — the worker also does this at boot
and logs a loud warning rather than exiting (killing the worker would stop report
generation and GC too):

```bash
docker compose -f docker-compose.staging.yml exec clamav clamdscan --version
```

### 5b.2 Why old files need a sweep at all

Enabling the scanner only covers **new** uploads. Two populations of existing rows
are left behind, and the dangerous one is not the obvious one:

| Population | `scan_status` | Downloadable? | Reality |
|---|---|---|---|
| Pre-CCR-012 uploads | `clean` | yes, badged ปลอดภัย | **Never scanned.** The old `file.process` matched "eicar"/"virus" against the *filename*, read no bytes, and called everything else clean. |
| `SCAN_PROVIDER=none` period | `unscanned` | yes, badged honestly | Never scanned, and says so. |

The first row is the reason the sweep cannot select on `scan_status`: `clean` is
precisely the value that lies. It selects on **`evidence_file.scanned_at IS NULL`**
— a receipt written only when clamd actually returned a verdict. Migration
`20260718220000` declined to backfill those rows because it "cannot distinguish
those rows from ones a real scanner might have cleared"; `scanned_at` is that
distinction made durable.

`scanned_at` stays null for anything refused *without being read* — oversize,
size-mismatch, scanner down — so "could not be checked" remains re-checkable
instead of hardening into a permanent verdict.

### 5b.3 Running the sweep

```bash
# 1. census first — changes nothing, and tells you the size of the problem
npm run rescan:files -- --report

# 2. see what would be queued
npm run rescan:files -- --dry-run

# 3. queue a batch (default 500, oldest upload first)
SCAN_PROVIDER=clamav npm run rescan:files -- --limit=500

# 4. watch it drain; re-run step 3 until --report shows no gap
npm run rescan:files -- --report
```

The script **never scans and never writes a verdict** — it enqueues `file.process`
jobs and stops. The worker does the work through the same path an upload takes, so
there is one implementation of "what is this file" and one fail-closed policy over
it. **The worker must be running** or nothing happens.

| Flag | Effect |
|---|---|
| `--report` | Coverage census + queue state. Read-only. |
| `--dry-run` | Select and print, queue nothing. The only mode that runs without a scanner. |
| `--limit=N` | Batch size (default 500). Re-running is safe — already-queued files are skipped. |
| `--school=<id>` | Scope to one school. |
| `--include-blocked` | Also re-scan `blocked`. Opt-in because it can *widen* access: a file blocked only for exceeding `CLAMAV_MAX_BYTES` becomes downloadable if clamd now clears it. Use after raising `StreamMaxLength`. |
| `--scanned-before=<date>` | Also re-scan genuine but stale verdicts — how a signature update gets swept in. |

It refuses to run when `SCAN_PROVIDER != clamav`: every job would re-derive
`unscanned`, write no receipt, and re-emit `scan_completed` — the whole store
pushed through the queue to change nothing.

### 5b.4 Expected outcomes, including the alarming ones

- **Files ending `blocked` is the sweep working.** A file that was serving as
  `clean` for months and now blocks is the finding, not a regression. Tell the
  affected teacher before they discover it as a broken download.
- **Files staying `pending`** mean the scan could not be completed — clamd down,
  timed out. They are undownloadable until it succeeds. That is fail-closed.
- **`object missing from storage for file <id> (bucket=… key=…)`** in
  `--report` means a metadata row outlived its bytes. The sweep is usually the
  first thing to notice; these rows need a separate data decision (restore the
  object, or delete the row), not a scanner fix.
- A failed job **leaves its file exactly as it was**. No verdict is ever invented
  for a file the scanner could not read.
- **Terminally-failed jobs do not stop the file being selected again.** The
  skip-guard only looks at `pending`/`running`, which is right for a transient
  outage and wrong for a permanently absent object: every future sweep re-queues
  it and burns another 8 attempts. Deal with those rows (restore the object, or
  remove the row) rather than letting them accumulate.

### 5b.5 First full-store run, 2026-07-20

Recorded because the numbers are the argument for doing this at all.

| | |
|---|---|
| Enqueued | 315 (whole store, `--limit=5000`) |
| Verified with a real clamd verdict | **295, all clean** |
| Failed — object missing from storage | 46 |
| Wall clock | ~7 min, single worker, 10 jobs/poll |
| Unverified `clean` files being served, before → after | **67 → 0** |

Everything left unverified is accounted for, with nothing unexplained: 50
`blocked` (opt-out, needs `--include-blocked`), 46 orphaned rows whose objects are
gone, and 30 soft-deleted (excluded by design; **re-run the sweep after any
restore**, since a restored file is served again).

Two reporting defects surfaced only at this scale and are fixed:
`summariseRescanJobs` grouped failures by a key that still contained the file id,
so 46 identical failures printed as 46 lines instead of one `46×` — the exact
noise the grouping existed to prevent. And the census counted soft-deleted files
in the "downloadable, badged ปลอดภัย" warning, overstating the alarm by 27; it
now reports live evidence and lists soft-deleted separately.

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
| `file.process` | Size/integrity check + ClamAV scan (ADR-0009); writes `scan_status` and, only on a real verdict, `scanned_at`. Also the sweep's unit of work (§5b). |
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
