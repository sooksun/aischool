#!/usr/bin/env bash
# CI: Keycloak with the dev realm (ADR-0014), for apps/api step-up tests.
#   scripts/ci/keycloak.sh start   # docker run -d; returns at once (boot takes ~20 s)
#   scripts/ci/keycloak.sh wait    # blocks until the realm's discovery document answers
# Split so the JVM boots while the job installs, migrates and builds.
set -euo pipefail
case "${1:-}" in
  start)
    docker run -d --name keycloak -p 8180:8180 \
      -e KC_BOOTSTRAP_ADMIN_USERNAME=admin -e KC_BOOTSTRAP_ADMIN_PASSWORD=seip_kc_admin_dev_only \
      -v "$PWD/infra/keycloak/seip-realm.dev.json:/opt/keycloak/data/import/seip-realm.json:ro" \
      keycloak/keycloak:26.7.5 start-dev --import-realm --http-port=8180
    ;;
  wait)
    for _ in $(seq 1 90); do
      if curl -sf -o /dev/null http://127.0.0.1:8180/realms/seip/.well-known/openid-configuration; then
        echo "keycloak ready, realm seip"; exit 0
      fi
      sleep 2
    done
    echo "::error::keycloak did not become ready"; docker logs keycloak | tail -80; exit 1
    ;;
  *) echo "usage: $0 start|wait" >&2; exit 2 ;;
esac
