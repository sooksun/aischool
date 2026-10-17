#!/usr/bin/env bash
# deploy-remote.sh — install or update SEIP on ONE host, idempotently. Runs ON
# the server (the deploy workflow pipes it over SSH; an operator can run it by
# hand from an unpacked release). Needs Docker Engine + Compose v2, openssl, curl.
#
# Layout under $SEIP_ROOT (default /opt/seip):
#   releases/<id>/        unpacked source of each deploy (last 3 kept)
#   current -> releases/<id>
#   shared/.env.staging   generated on the FIRST deploy, chmod 600; secrets are
#                         created here and never leave the host
#   shared/backups/       BACKUP_HOST_DIR (copy it off the machine — runbook §5)
#
# Inputs (environment):
#   SEIP_RELEASE        required  release id (the commit sha)
#   SEIP_DOMAIN         required on first deploy (https://$SEIP_DOMAIN is the public origin)
#   SEIP_ACME_EMAIL     optional  contact for the TLS certificate
#   SEIP_EDGE           optional  "caddy" (default: TLS here) or "none" (an existing proxy in front)
#   SEIP_SCHOOL_CODE / SEIP_SCHOOL_NAME / SEIP_ADMIN_EMAIL / SEIP_ADMIN_PASSWORD
#                       optional  first school + its admin (skipped when the admin exists)
set -euo pipefail

ROOT=${SEIP_ROOT:-/opt/seip}
REL=${SEIP_RELEASE:?SEIP_RELEASE is required}
EDGE=${SEIP_EDGE:-caddy}
ENV_FILE="$ROOT/shared/.env.staging"
DIR="$ROOT/releases/$REL"
log() { printf '\n== %s\n' "$*"; }

[ -f "$DIR/docker-compose.staging.yml" ] || { echo "no release at $DIR"; exit 1; }
command -v docker >/dev/null || { echo "docker is not installed"; exit 1; }
docker compose version >/dev/null || { echo "docker compose v2 is not installed"; exit 1; }
mkdir -p "$ROOT/shared/backups"

if [ ! -f "$ENV_FILE" ]; then
  log "first deploy: generating $ENV_FILE (secrets stay on this host)"
  : "${SEIP_DOMAIN:?SEIP_DOMAIN is required on the first deploy}"
  r() { openssl rand -hex 24; }
  umask 077
  sed -e "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(r)/" \
      -e "s/^SEIP_MIGRATOR_PASSWORD=.*/SEIP_MIGRATOR_PASSWORD=$(r)/" \
      -e "s/^SEIP_APP_PASSWORD=.*/SEIP_APP_PASSWORD=$(r)/" \
      -e "s/^JWT_SECRET=.*/JWT_SECRET=$(r)/" \
      -e "s/^S3_ACCESS_KEY=.*/S3_ACCESS_KEY=seip$(openssl rand -hex 6)/" \
      -e "s/^S3_SECRET_KEY=.*/S3_SECRET_KEY=$(r)/" \
      "$DIR/.env.staging.example" > "$ENV_FILE"
  {
    echo "BACKUP_HOST_DIR=$ROOT/shared/backups"
    echo "SEIP_DOMAIN=$SEIP_DOMAIN"
    echo "SEIP_ACME_EMAIL=${SEIP_ACME_EMAIL:-}"
  } >> "$ENV_FILE"
  chmod 600 "$ENV_FILE"
fi
# The public origin follows the domain on every deploy (a renamed host must not
# keep signing upload URLs for the old one).
if [ -n "${SEIP_DOMAIN:-}" ]; then
  sed -i -e "/^SEIP_DOMAIN=/d" -e "/^SEIP_PUBLIC_ORIGIN=/d" "$ENV_FILE"
  printf 'SEIP_DOMAIN=%s\nSEIP_PUBLIC_ORIGIN=https://%s\n' "$SEIP_DOMAIN" "$SEIP_DOMAIN" >> "$ENV_FILE"
fi

ln -sfn "$DIR" "$ROOT/current"
cd "$ROOT/current"
C=(docker compose -f docker-compose.staging.yml --env-file "$ENV_FILE")
PROFILES=()
[ "$EDGE" = caddy ] && PROFILES=(--profile edge)

log "build + start ($REL)"
"${C[@]}" "${PROFILES[@]}" up -d --build --remove-orphans

log "waiting for the api behind the web container"
for i in $(seq 1 120); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/api/v1/auth/me || true)
  [ "$code" = 401 ] && break
  [ "$i" = 120 ] && { echo "api never answered (last $code)"; "${C[@]}" logs --tail=80 api web migrate; exit 1; }
  sleep 5
done

log "seed taxonomy (idempotent)"
"${C[@]}" run --rm ops node prisma/seed.mjs

if [ -n "${SEIP_SCHOOL_CODE:-}" ] && [ -n "${SEIP_ADMIN_EMAIL:-}" ] && [ -n "${SEIP_ADMIN_PASSWORD:-}" ]; then
  log "first school + admin (skipped if they exist)"
  "${C[@]}" run --rm ops node scripts/ops/provision-school.mjs \
    --code="$SEIP_SCHOOL_CODE" --name="${SEIP_SCHOOL_NAME:-$SEIP_SCHOOL_CODE}"
  out=$(SEIP_ADMIN_PASSWORD="$SEIP_ADMIN_PASSWORD" "${C[@]}" run --rm -e SEIP_ADMIN_PASSWORD ops \
    node scripts/ops/bootstrap-admin.mjs --email="$SEIP_ADMIN_EMAIL" --name="ผู้ดูแลระบบ" --school="$SEIP_SCHOOL_CODE" 2>&1) \
    || { echo "$out" | grep -q 'already has a password' || { echo "$out"; exit 1; }; }
  echo "$out" | grep -vi password || true
fi

log "prune old releases (keep 3)"
ls -1dt "$ROOT"/releases/*/ | tail -n +4 | xargs -r rm -rf

"${C[@]}" "${PROFILES[@]}" ps
log "deployed $REL"
