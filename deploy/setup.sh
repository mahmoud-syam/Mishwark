#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 24.04 server (Oracle Cloud, Hetzner, any VPS;
# ARM or x86). Run as a user with sudo:
#
#   curl -fsSL https://raw.githubusercontent.com/mahmoud-syam/Mishwark/main/deploy/setup.sh -o setup.sh
#   sudo bash setup.sh
#
# It installs Docker, puts the code in /opt/mishwark, writes deploy/.env with
# new random secrets, asks for the Cloudflare Tunnel token and the Super Admin's
# details, starts everything, prints the Super Admin's temporary password, and
# turns on automatic updates from GitHub. Running it again is safe: it keeps the
# existing .env, data and admin.
#
# Unattended (cloud-init / user data when creating the VM): with no terminal it
# asks nothing. TUNNEL_TOKEN, ADMIN_EMAIL, ADMIN_NAME and ADMIN_PHONE can come
# from the environment; whatever is missing is skipped, and running
# `sudo bash /opt/mishwark/deploy/setup.sh` later in a terminal finishes it.
#   curl -fsSL https://raw.githubusercontent.com/mahmoud-syam/Mishwark/main/deploy/setup.sh | bash
set -euo pipefail
INTERACTIVE=false; [ -t 0 ] && INTERACTIVE=true
REPO_URL="${MISHWARK_REPO_URL:-https://github.com/mahmoud-syam/Mishwark.git}"
ROOT=/opt/mishwark
say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
[ "$(id -u)" = 0 ] || { echo "Run with sudo: sudo bash setup.sh"; exit 1; }

say "1/6 Installing Docker and git"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git curl python3 openssl ca-certificates >/dev/null
if ! { command -v docker && docker compose version; } >/dev/null 2>&1; then
  apt-get install -y -qq docker.io docker-compose-v2 >/dev/null
fi
systemctl enable --now docker >/dev/null

say "2/6 Getting the code into $ROOT"
REF="${MISHWARK_REF:-main}"
[ -d "$ROOT/.git" ] || git clone -q "$REPO_URL" "$ROOT"
git -C "$ROOT" fetch -q origin "$REF"
git -C "$ROOT" checkout -q --detach FETCH_HEAD
cd "$ROOT/deploy"
mkdir -p backups secrets
chmod 700 backups secrets

say "3/6 Settings (deploy/.env)"
if [ ! -f .env ]; then
  cp .env.example .env
  chmod 600 .env
  sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 24)|" .env
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 32)|" .env
  echo "Created deploy/.env with new database password and JWT secret."
else
  echo "Keeping the existing deploy/.env."
fi
if ! grep -qE '^TUNNEL_TOKEN=eyJ' .env; then
  token="${TUNNEL_TOKEN:-}"
  if [ -z "$token" ] && $INTERACTIVE; then
    echo "Paste the Cloudflare Tunnel token (starts with eyJ; it won't show while you paste), then Enter."
    echo "Leave empty to add it later in deploy/.env."
    read -rs token; echo
  fi
  token=$(printf '%s' "$token" | grep -oE 'eyJ[A-Za-z0-9_=+/-]+' | head -1 || true)
  if [ -n "$token" ]; then
    python3 - "$token" <<'PY'
import sys, re
p = ".env"; s = open(p).read()
s = re.sub(r"(?m)^TUNNEL_TOKEN=.*$", "TUNNEL_TOKEN=" + sys.argv[1], s)
open(p, "w").write(s)
PY
    echo "Tunnel token saved."
  fi
fi

say "4/6 Building and starting (the first build takes several minutes)"
export APP_VERSION="$(git -C "$ROOT" rev-parse --short=7 HEAD)"
docker compose build api
docker compose up -d db api
for _ in $(seq 1 60); do
  curl -fsS -m 5 http://127.0.0.1:5000/api/v1/health >/dev/null 2>&1 && break
  sleep 3
done
curl -fsS -m 5 http://127.0.0.1:5000/api/v1/health >/dev/null || { docker compose logs --tail 80 api; echo "The API didn't start."; exit 1; }
echo "API is up: $(curl -fsS http://127.0.0.1:5000/api/v1/health)"

say "5/6 Super Admin"
admins=$(docker compose exec -T db psql -U mishwark -d mishwark -Atc \
  "SELECT count(*) FROM \"Users\" u JOIN \"Role\" r ON r.id = u.\"roleId\" WHERE r.name = 'SUPER_ADMIN' AND NOT u.\"isDeleted\"" 2>/dev/null || echo 0)
if [ "${admins:-0}" -gt 0 ] 2>/dev/null; then
  echo "A Super Admin already exists."
elif [ -z "${ADMIN_EMAIL:-}" ] && ! $INTERACTIVE; then
  echo "No Super Admin yet: run 'sudo bash $ROOT/deploy/setup.sh' in a terminal to create it."
else
  admin_email="${ADMIN_EMAIL:-}"; admin_name="${ADMIN_NAME:-}"; admin_phone="${ADMIN_PHONE:-}"
  [ -n "$admin_email" ] || read -rp "Super Admin email: " admin_email
  [ -n "$admin_name" ] || read -rp "Super Admin name: " admin_name
  [ -n "$admin_phone" ] || ! $INTERACTIVE || read -rp "Super Admin phone (+2010..., optional): " admin_phone
  docker compose exec -T -e ADMIN_EMAIL="$admin_email" -e ADMIN_NAME="$admin_name" -e ADMIN_PHONE="$admin_phone" \
    api npx tsx prisma/seed/production.ts | grep -vE '^(Seeding|Created|Upserted|Linked|Permission)' || true
fi

say "6/6 Tunnel, backups and automatic updates"
if grep -qE '^TUNNEL_TOKEN=eyJ' .env; then docker compose up -d tunnel; else echo "No tunnel token yet: add TUNNEL_TOKEN to deploy/.env, then: cd $ROOT/deploy && sudo docker compose up -d tunnel"; fi
docker compose up -d backup
if [ "${MISHWARK_NO_TIMER:-}" = 1 ]; then
  echo "Automatic updates not installed (MISHWARK_NO_TIMER=1)."
else
  install -m 644 systemd/mishwark-update.service systemd/mishwark-update.timer /etc/systemd/system/
  systemctl daemon-reload
  systemctl enable --now mishwark-update.timer >/dev/null
  echo "Automatic updates are on (every 2 minutes, only commits whose checks passed)."
fi

say "Done."
echo "Status:   cd $ROOT/deploy && sudo docker compose ps"
echo "Logs:     cd $ROOT/deploy && sudo docker compose logs -f api"
echo "Updates:  journalctl -u mishwark-update -f"
