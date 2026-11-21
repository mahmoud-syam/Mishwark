#!/usr/bin/env bash
# Restore a backup made by backup.sh. Run on the server, from anywhere:
#   sudo /opt/mishwark/deploy/restore.sh                 list backups
#   sudo /opt/mishwark/deploy/restore.sh db-XXXX.dump    restore the database
#   sudo /opt/mishwark/deploy/restore.sh files-XXXX.tar.gz   restore uploaded files
# For a copy from R2, decrypt it first:
#   openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in db-XXXX.dump.enc -out db-XXXX.dump
# A backup of the current state is taken before anything is replaced.
set -euo pipefail
cd "$(dirname "$0")"
dc() { docker compose "$@"; }
file="${1:-}"
if [ -z "$file" ]; then
  echo "Backups in $(pwd)/backups:"; ls -1t backups | grep -E '^(db|files)-' || echo "(none)"; exit 0
fi
path="backups/$(basename "$file")"
[ -f "$path" ] || { echo "No such backup: $path" >&2; exit 1; }
read -rp "This replaces the current $( [[ $file == db-* ]] && echo database || echo files ) with $file. Type yes to continue: " ok
[ "$ok" = "yes" ] || { echo "Cancelled."; exit 1; }
echo "Backing up the current state first..."
dc run --rm -T backup now
case "$file" in
  db-*)
    dc stop api
    dc exec -T db sh -c 'dropdb -U mishwark --if-exists --force mishwark && createdb -U mishwark mishwark'
    dc exec -T db pg_restore -U mishwark -d mishwark --no-owner < "$path"
    dc start api
    ;;
  files-*)
    dc run --rm -T --no-deps -v "$(pwd)/backups:/backups:ro" --entrypoint sh api -c \
      "cd /app/backend && rm -rf storage/* uploads/* && tar -xzf /backups/$(basename "$file")"
    ;;
  *) echo "Not a backup file: $file" >&2; exit 1 ;;
esac
echo "Restored $file."
