#!/bin/sh
# docker-entrypoint-initdb.d hook for docker-compose.staging.yml: runs
# bootstrap-roles.sql once, on first boot, with passwords from the environment
# rather than the dev defaults baked into the .sql file.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v migrator_password="$SEIP_MIGRATOR_PASSWORD" \
  -v app_password="$SEIP_APP_PASSWORD" \
  -v db="${POSTGRES_DB:-seip}" \
  -f /seip/bootstrap-roles.sql
