# Production server

Mishwark runs on one Linux server with Docker: Postgres, the API (which also
serves the dashboard at `/dashboard/`), a Cloudflare Tunnel for the public
address, and daily backups. Nothing on the server is open to the internet
except SSH; HTTPS comes from Cloudflare.

```
phone apps / browser ──https──> Cloudflare ──tunnel──> cloudflared ──> api:5000 ──> db
                                                                     backup (daily) ──> deploy/backups (+ R2)
```

Works on ARM (Oracle Cloud Ampere) and x86 (Hetzner, DigitalOcean, any VPS).
The `Server` GitHub workflow builds and runs this exact stack on both, with
every pull request and every push to main.

## Files

| File | What it is |
|---|---|
| `../Dockerfile` | One image: API + dashboard. Applies missing migrations on start. |
| `docker-compose.yml` | db, api, tunnel, backup. |
| `.env.example` | Every setting. `setup.sh` turns it into `deploy/.env` (never committed). |
| `setup.sh` | One-time setup of a fresh Ubuntu 24.04 server. |
| `update.sh` | Deploys new commits from GitHub (run by a systemd timer every 2 minutes). |
| `backup.sh` | Runs in the backup container: daily database dump + uploaded files. |
| `restore.sh` | Restores a backup. |
| `systemd/` | The timer that runs `update.sh`. |

## 1. Create the server

### Oracle Cloud (Always Free)

1. Sign up at cloud.oracle.com. The **home region** can't be changed later and
   free ARM machines only exist there: pick one close to Egypt with capacity
   (e.g. Jeddah or Frankfurt).
2. Upgrade the account to **Pay As You Go**. You still pay nothing within the
   Always Free limits, and idle free machines are no longer reclaimed (a new
   app with little traffic would otherwise look idle).
3. Compute > Instances > Create:
   - Image: **Ubuntu 24.04** (not "Minimal").
   - Shape: **VM.Standard.A1.Flex**, **2 OCPU, 12 GB** (the Always Free limit).
   - Boot volume: 100 GB (free up to 200 GB in total).
   - SSH key: upload your own public key, or download the one Oracle generates
     and keep it safe.
   - If it says "Out of capacity", try another availability domain or try later.
4. Note the public IP. No ingress rules are needed beyond SSH (22), which is
   open by default.

### Any other VPS

Ubuntu 24.04, 2 vCPU / 2 GB RAM or more, 40 GB disk. Same steps from 2.

## 2. Cloudflare Tunnel

Cloudflare dashboard > Zero Trust > Networks > Tunnels:

1. Use the existing tunnel for `mishwark.mahmoud-syam.me` or create one
   ("Cloudflared" type).
2. Public hostname: `mishwark.mahmoud-syam.me` → service **HTTP**, URL **`api:5000`**.
3. Copy the tunnel token (the long value starting with `eyJ` in the install
   command). `setup.sh` asks for it. Treat it like a password.

Running the same tunnel on the old preview and on the server at the same time
splits traffic between them, so stop pushing to `preview/**` once the server is up
(or give the preview its own tunnel).

## 3. Run the setup

```bash
ssh ubuntu@SERVER_IP
curl -fsSL https://raw.githubusercontent.com/mahmoud-syam/Mishwark/main/deploy/setup.sh -o setup.sh
sudo bash setup.sh
```

It asks for the tunnel token and the Super Admin's email, name and phone, and
prints a **temporary password** once. Open `https://mishwark.mahmoud-syam.me/dashboard/`,
sign in with it, choose your own password, then set up 2FA. Add the rest of the
team from the Team page.

The production database starts empty: no test accounts, cars or drivers.
Add cars, prices and destinations from the dashboard.

## Updates

Merging into `main` is the deploy. Every 2 minutes the server checks GitHub;
when `main` has a new commit and all its checks passed, `update.sh`:

1. takes a backup,
2. builds the new image,
3. starts it (missing migrations are applied on start),
4. waits for `/api/v1/health` to report the new version,
5. otherwise goes back to the previous commit and image.

```bash
journalctl -u mishwark-update -f            # what the updater did
sudo /opt/mishwark/deploy/update.sh --force # rebuild main now
curl -s http://127.0.0.1:5000/api/v1/health # {"ok":true,"version":"<commit>"}
```

Migrations only ever add (new tables, columns, values), so going back to the
previous version keeps working after a migration ran. A migration that removes
or renames something must be released in two steps: first code that no longer
uses it, then the migration.

## Backups

Every day at `BACKUP_HOUR_UTC` (default 01 UTC = 3 a.m. Cairo), plus before
every update: the database (`db-*.dump`) and the uploaded files: drivers' papers
and photos (`files-*.tar.gz`), in `/opt/mishwark/deploy/backups`, kept
`BACKUP_KEEP_DAYS` days.

A copy outside the server is strongly recommended: create a Cloudflare R2
bucket and an R2 API token for it, then fill `R2_*` and `BACKUP_PASSPHRASE` in
`deploy/.env` and run `sudo docker compose up -d backup`. Copies on R2 are
encrypted with the passphrase; keep it outside the server (password manager).

```bash
sudo /opt/mishwark/deploy/restore.sh                    # list backups
sudo /opt/mishwark/deploy/restore.sh db-XXXX.dump       # restore the database
sudo /opt/mishwark/deploy/restore.sh files-XXXX.tar.gz  # restore uploaded files
```

`restore.sh` takes a backup of the current state before replacing anything.

## Settings

Edit `/opt/mishwark/deploy/.env`, then `cd /opt/mishwark/deploy && sudo docker compose up -d`.

- **SMS** (`SMS_PROVIDER` and its keys): needed for customers and drivers to
  sign in with a code. Without it the API answers 503 to code requests, unless
  `OTP_DEV_RESPONSE=true` (returns the code in the response; closed testing only).
- **Push** (Firebase): put the service-account file at `deploy/secrets/firebase.json`
  and set `FCM_SERVICE_ACCOUNT_FILE=/run/mishwark/firebase.json`.
- **Road distances**: `ORS_API_KEY`.

The dashboard's Settings page shows which of these are configured.

## Everyday commands

```bash
cd /opt/mishwark/deploy
sudo docker compose ps                 # what's running
sudo docker compose logs -f api        # API logs
sudo docker compose restart api        # restart the API
sudo docker compose exec db psql -U mishwark mishwark   # database shell
```

## Moving to another server

Run `setup.sh` on the new server, stop the API there, restore the latest
`db-*.dump` and `files-*.tar.gz` with `restore.sh`, then move the tunnel token
(the address follows the tunnel, no DNS change).
