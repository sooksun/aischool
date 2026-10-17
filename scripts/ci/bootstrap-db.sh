#!/usr/bin/env bash
# CI: create seip_migrator / seip_app on the fresh PG18 service container
# (ADR-0012 §4) — the only step that runs as the postgres superuser, standing in
# for the RDS master user. Everything after it runs as one of the two roles.
set -euo pipefail
for _ in $(seq 1 30); do
  pg_isready -h 127.0.0.1 -p 5432 -U postgres >/dev/null 2>&1 && break
  sleep 2
done
PGPASSWORD=seip_ci_root psql -h 127.0.0.1 -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -v migrator_password=seip_migrator_dev -v app_password=seip_app_dev -v db=seip \
  -f scripts/db/bootstrap-roles.sql
