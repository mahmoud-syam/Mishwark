#!/bin/sh
# Runs in the "backup" container (postgres:17-alpine).
#   sh /scripts/backup.sh        loop: one backup a day at BACKUP_HOUR_UTC
#   sh /scripts/backup.sh now    one backup now, then exit (update.sh uses it)
# Each backup: the database (pg_dump custom format) and the uploaded files
# (drivers' papers, photos), in /backups; older than BACKUP_KEEP_DAYS removed.
# With R2_* and BACKUP_PASSPHRASE set, an encrypted copy also goes to R2.
set -eu
KEEP="${BACKUP_KEEP_DAYS:-14}"
HOUR="${BACKUP_HOUR_UTC:-01}"

remote_enabled() {
  [ -n "${R2_BUCKET:-}" ] && [ -n "${R2_ACCOUNT_ID:-}" ] && [ -n "${R2_ACCESS_KEY_ID:-}" ] && [ -n "${R2_SECRET_ACCESS_KEY:-}" ]
}

setup_remote() {
  remote_enabled || return 0
  if [ -z "${BACKUP_PASSPHRASE:-}" ]; then
    echo "[backup] R2 is set but BACKUP_PASSPHRASE is empty: not uploading unencrypted copies." >&2
    return 0
  fi
  command -v rclone >/dev/null 2>&1 && command -v openssl >/dev/null 2>&1 || apk add --no-cache rclone openssl >/dev/null
  export RCLONE_CONFIG_R2_TYPE=s3 RCLONE_CONFIG_R2_PROVIDER=Cloudflare \
    RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
    RCLONE_CONFIG_R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com" RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true
}

upload() { # file
  remote_enabled && [ -n "${BACKUP_PASSPHRASE:-}" ] || return 0
  enc="$1.enc"
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE -in "$1" -out "$enc"
  rclone copyto --s3-no-check-bucket "$enc" "r2:${R2_BUCKET}/$(basename "$enc")"
  rm -f "$enc"
  # Same retention on R2.
  rclone delete --min-age "${KEEP}d" "r2:${R2_BUCKET}" >/dev/null 2>&1 || true
}

run_backup() {
  ts=$(date -u +%Y%m%d-%H%M%S)
  db="/backups/db-$ts.dump"
  files="/backups/files-$ts.tar.gz"
  # (An "a && b" list doesn't stop the script under set -e, so check each step.)
  if ! pg_dump -Fc -Z 6 -f "$db.part"; then
    rm -f "$db.part"; echo "[backup] ERROR: the database dump failed" >&2; return 1
  fi
  mv "$db.part" "$db"
  if ! tar -czf "$files.part" -C /data storage uploads; then
    rm -f "$files.part"; echo "[backup] ERROR: archiving the uploaded files failed" >&2; return 1
  fi
  mv "$files.part" "$files"
  find /backups -maxdepth 1 \( -name 'db-*.dump' -o -name 'files-*.tar.gz' \) -mtime +"$KEEP" -delete
  echo "[backup] $(date -u '+%F %T') UTC  $(basename "$db") ($(du -h "$db" | cut -f1)), $(basename "$files") ($(du -h "$files" | cut -f1))"
  if upload "$db" && upload "$files"; then
    remote_enabled && [ -n "${BACKUP_PASSPHRASE:-}" ] && echo "[backup] copied to R2 (encrypted)"
  else
    echo "[backup] WARNING: the copy to R2 failed; the local backup is fine." >&2
  fi
  return 0
}

mkdir -p /backups
setup_remote

if [ "${1:-}" = "now" ]; then
  run_backup || exit 1
  exit 0
fi

# First start: a backup right away if there is none.
ls /backups/db-*.dump >/dev/null 2>&1 || run_backup || true
while true; do
  today=$(date -u +%F)
  if [ "$(date -u +%H)" = "$HOUR" ] && [ ! -f "/backups/.done-$today" ]; then
    if run_backup; then
      rm -f /backups/.done-*
      touch "/backups/.done-$today"
    fi
  fi
  sleep 300
done
