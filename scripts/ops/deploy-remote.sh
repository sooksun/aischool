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
#   SEIP_DOMAIN         required on first deploy — the host name users reach
#   SEIP_EDGE           "caddy" (default): HTTPS on 80/443 with automatic certificates
#                       "none": no edge here — the web container is published on a
#                       free port and the origin is http://$SEIP_DOMAIN:<port>, unless
#                       SEIP_PUBLIC_ORIGIN names the URL of a proxy already in front
#   SEIP_PUBLIC_ORIGIN  optional  override the public origin (e.g. https://seip.example.th)
#   SEIP_WEB_PORT       optional  web port on the host ("auto" = first free from 8090)
#   SEIP_ACME_EMAIL     optional  contact for the TLS certificate (caddy)
#   SEIP_SCHOOL_CODE / SEIP_SCHOOL_NAME / SEIP_ADMIN_EMAIL / SEIP_ADMIN_PASSWORD
#                       optional  first school + its admin (skipped when the admin exists)
# Ports chosen once are written to the env file and reused on every later deploy.
# Last line of output: SEIP_PUBLIC_ORIGIN=<url> (the deploy workflow reads it).
set -euo pipefail

ROOT=${SEIP_ROOT:-/opt/seip}
REL=${SEIP_RELEASE:?SEIP_RELEASE is required}
EDGE=${SEIP_EDGE:-caddy}
ENV_FILE="$ROOT/shared/.env.staging"
DIR="$ROOT/releases/$REL"
log() { printf '\n== %s\n' "$*"; }
getenv() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true; }
setenv() { sed -i "/^$1=/d" "$ENV_FILE"; printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"; }
in_use() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
free_port() { local p=$1; while in_use "$p"; do p=$((p + 1)); done; echo "$p"; }

[ -f "$DIR/docker-compose.staging.yml" ] || { echo "no release at $DIR"; exit 1; }
command -v docker >/dev/null || { echo "docker is not installed"; exit 1; }
docker compose version >/dev/null || { echo "docker compose v2 is not installed"; exit 1; }
mkdir -p "$ROOT/shared/backups"

if [ ! -f "$ENV_FILE" ]; then
  log "first deploy: generating $ENV_FILE (secrets stay on this host)"
  : "${SEIP_DOMAIN:?SEIP_DOMAIN is required on the first deploy}"
  r() { openssl rand -hex 24; }
  (umask 077
   sed -e "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(r)/" \
       -e "s/^SEIP_MIGRATOR_PASSWORD=.*/SEIP_MIGRATOR_PASSWORD=$(r)/" \
       -e "s/^SEIP_APP_PASSWORD=.*/SEIP_APP_PASSWORD=$(r)/" \
       -e "s/^JWT_SECRET=.*/JWT_SECRET=$(r)/" \
       -e "s/^S3_ACCESS_KEY=.*/S3_ACCESS_KEY=seip$(openssl rand -hex 6)/" \
       -e "s/^S3_SECRET_KEY=.*/S3_SECRET_KEY=$(r)/" \
       -e "/^SEIP_WEB_BIND=/d" -e "/^SEIP_PUBLIC_ORIGIN=/d" \
       "$DIR/.env.staging.example" > "$ENV_FILE")
  echo "BACKUP_HOST_DIR=$ROOT/shared/backups" >> "$ENV_FILE"
  chmod 600 "$ENV_FILE"
fi

[ -n "${SEIP_DOMAIN:-}" ] && setenv SEIP_DOMAIN "$SEIP_DOMAIN"
[ -n "${SEIP_ACME_EMAIL:-}" ] && setenv SEIP_ACME_EMAIL "$SEIP_ACME_EMAIL"
DOMAIN=$(getenv SEIP_DOMAIN)
[ -n "$DOMAIN" ] || { echo "SEIP_DOMAIN is not set"; exit 1; }

# Pick a port only when none is recorded yet — once our stack runs, its own
# ports would look taken.
WEB_BIND=$(getenv SEIP_WEB_BIND)
if [ -z "$WEB_BIND" ] || { [ -n "${SEIP_WEB_PORT:-}" ] && [ "${SEIP_WEB_PORT}" != auto ] && [ "${WEB_BIND##*:}" != "$SEIP_WEB_PORT" ]; }; then
  port=${SEIP_WEB_PORT:-auto}
  [ "$port" = auto ] && port=$(free_port 8090)
  host=127.0.0.1
  [ "$EDGE" = none ] && host=0.0.0.0
  WEB_BIND="$host:$port"
  setenv SEIP_WEB_BIND "$WEB_BIND"
  log "web published on $WEB_BIND"
fi
WEB_PORT=${WEB_BIND##*:}
if [ -z "$(getenv SEIP_API_BIND)" ]; then
  setenv SEIP_API_BIND "127.0.0.1:$(free_port 3101)"
fi

if [ -n "${SEIP_PUBLIC_ORIGIN:-}" ]; then ORIGIN=$SEIP_PUBLIC_ORIGIN
elif [ "$EDGE" = caddy ]; then ORIGIN="https://$DOMAIN"
else ORIGIN="http://$DOMAIN:$WEB_PORT"
fi
# The public origin follows the settings on every deploy (a renamed host must
# not keep signing upload URLs for the old one).
setenv SEIP_PUBLIC_ORIGIN "$ORIGIN"

ln -sfn "$DIR" "$ROOT/current"
cd "$ROOT/current"
C=(docker compose -f docker-compose.staging.yml --env-file "$ENV_FILE")
PROFILES=()
[ "$EDGE" = caddy ] && PROFILES=(--profile edge)

log "build + start ($REL)"
"${C[@]}" "${PROFILES[@]}" up -d --build --remove-orphans

log "waiting for the api behind the web container (port $WEB_PORT)"
for i in $(seq 1 120); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$WEB_PORT/api/v1/auth/me" || true)
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
echo "SEIP_PUBLIC_ORIGIN=$ORIGIN"
