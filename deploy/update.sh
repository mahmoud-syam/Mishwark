#!/usr/bin/env bash
# Brings the server up to date with GitHub's main branch. The systemd timer
# (mishwark-update.timer) runs it every 2 minutes; it does nothing unless main
# has a new commit whose checks passed on GitHub.
#   sudo /opt/mishwark/deploy/update.sh            normal run
#   sudo /opt/mishwark/deploy/update.sh --force    rebuild the current main now
# Steps: backup, build the new image, start it (migrations run on start), wait
# for /api/v1/health to report the new version; if it doesn't, go back to the
# previous commit and image.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/deploy"
REPO="${MISHWARK_REPO:-mahmoud-syam/Mishwark}"
BRANCH="${MISHWARK_BRANCH:-main}"
FORCE=false; [ "${1:-}" = "--force" ] && FORCE=true
log() { echo "[update] $(date '+%F %T') $*"; }
dc() { docker compose "$@"; }

exec 9>/run/lock/mishwark-update.lock
flock -n 9 || { log "another update is running"; exit 0; }

git -C "$ROOT" fetch -q origin "$BRANCH"
current=$(git -C "$ROOT" rev-parse HEAD)
target=$(git -C "$ROOT" rev-parse "origin/$BRANCH")
if [ "$current" = "$target" ] && ! $FORCE; then exit 0; fi

# Only deploy a commit whose checks on GitHub all passed (public API, no token).
if ! $FORCE; then
  checks=$(curl -fsS -m 20 -H 'Accept: application/vnd.github+json' \
    "https://api.github.com/repos/$REPO/commits/$target/check-runs?per_page=100" || true)
  verdict=$(printf '%s' "$checks" | python3 -c '
import json,sys
try: runs=json.load(sys.stdin)["check_runs"]
except Exception: print("unknown"); sys.exit()
if not runs: print("pending")
elif any(r["status"]!="completed" for r in runs): print("pending")
elif all(r["conclusion"] in ("success","skipped","neutral") for r in runs): print("ok")
else: print("failed")')
  case "$verdict" in
    ok) ;;
    pending|unknown) log "${target:0:7}: checks not finished yet, will try again"; exit 0 ;;
    *) log "${target:0:7}: checks failed on GitHub, not deploying"; exit 0 ;;
  esac
fi

log "deploying ${target:0:7} (was ${current:0:7})"
dc run --rm -T backup now || { log "backup failed, not deploying"; exit 1; }

previous_image=""
docker image inspect mishwark-api:current >/dev/null 2>&1 && {
  docker tag mishwark-api:current mishwark-api:previous
  previous_image=mishwark-api:previous
}

wait_healthy() { # version
  for _ in $(seq 1 60); do
    v=$(curl -fsS -m 5 http://127.0.0.1:5000/api/v1/health 2>/dev/null | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["version"] if d.get("ok") else "")' 2>/dev/null || true)
    [ "$v" = "$1" ] && return 0
    sleep 3
  done
  return 1
}

git -C "$ROOT" checkout -q --detach "$target"
export APP_VERSION="${target:0:7}"
if dc build api && dc up -d --remove-orphans && wait_healthy "$APP_VERSION"; then
  dc up -d tunnel backup
  docker image prune -f >/dev/null
  log "live: ${target:0:7}"
  exit 0
fi

log "the new version didn't come up; going back to ${current:0:7}"
dc logs --tail 80 api || true
git -C "$ROOT" checkout -q --detach "$current"
if [ -n "$previous_image" ]; then
  docker tag "$previous_image" mishwark-api:current
  dc up -d --force-recreate api
else
  APP_VERSION="${current:0:7}" dc build api && dc up -d api
fi
wait_healthy "${current:0:7}" && log "back on ${current:0:7}" || log "WARNING: the previous version isn't healthy either; check: docker compose logs api"
# Migrations already applied stay applied; they only add things, so the
# previous version keeps working. The backup above is there if it doesn't.
exit 1
