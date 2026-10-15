#!/bin/sh
# Run the backup on a fixed interval, forever.
#
# A sleep loop rather than cron: one process, output straight to `docker logs`,
# and no second scheduler whose failures are invisible. The trade-off is that the
# schedule drifts by the run duration, which for a nightly database backup does
# not matter.
set -eu

INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"

echo "[backup-runner] starting; interval=${INTERVAL}s retain=${BACKUP_RETAIN_DAYS:-14}d dir=${BACKUP_DIR:-/backups}"

# Wait a little on boot so MySQL is genuinely serving, not merely healthy.
sleep 30

while true; do
  echo "[backup-runner] === run started $(date -Iseconds) ==="
  # Do NOT `set -e` out of the loop on failure: a single bad run must not stop
  # every future backup. Report loudly and try again next interval.
  if node /app/scripts/ops/backup.mjs; then
    echo "[backup-runner] === run OK $(date -Iseconds) ==="
  else
    echo "[backup-runner] !!! BACKUP FAILED $(date -Iseconds) — investigate now; the next attempt is in ${INTERVAL}s" >&2
  fi
  sleep "${INTERVAL}"
done
