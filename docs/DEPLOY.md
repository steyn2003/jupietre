# Deploy

End-to-end deploy of Jupietre on a single Linux server with your own domain. Single-tenant; admin user only. Plan to budget about 30 minutes for a clean run.

## Prerequisites

- Linux server (any distro that runs Docker) with a public IPv4 (and ideally IPv6).
- A domain — `jupietre.example.com` in this doc — with an `A` (and `AAAA`) record pointing at the server's IP. DNS must be live before you start (Caddy needs it for ACME).
- SSH access as a user that can run `sudo`.
- Open inbound: TCP 80, TCP/UDP 443 (Caddy/HTTP/3).
- A Claude API key or OAuth token, plus any tokens for Linear/GitHub if you want those MCP tools.

## 1. Install Docker

```bash
# Debian/Ubuntu — adjust for your distro.
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker  # so the next docker command works without re-login
```

## 2. Clone the repo

```bash
sudo mkdir -p /opt/jupietre && sudo chown $USER /opt/jupietre
git clone <YOUR_FORK_URL> /opt/jupietre
cd /opt/jupietre
```

## 3. Configure environment

```bash
cp .env.example .env
$EDITOR .env
```

Required for production:

| Var | Value |
| --- | --- |
| `POSTGRES_URL` | leave blank — `docker-compose.yml` overrides it to use the in-network `postgres` service |
| `JWE_SECRET` | `openssl rand -base64 32 \| tr '+/' '-_' \| tr -d '=\n'` |
| `ADMIN_EMAIL` | first-boot admin user |
| `ADMIN_PASSWORD` | first-boot admin password (≥8 chars) |
| `APP_URL` | `https://jupietre.example.com` |
| `APP_DOMAIN` | `jupietre.example.com` (host only, no scheme) |
| `ANTHROPIC_API_KEY` *or* `CLAUDE_CODE_OAUTH_TOKEN` *or* `CLAUDE_TOKENS` | how the SDK authenticates |

Optional:

| Var | Purpose |
| --- | --- |
| `LINEAR_API_KEY` | enables Linear MCP tools + Linear poller |
| `GITHUB_TOKEN` | reserved (gh CLI in container uses its own auth — see step 6) |
| `GITHUB_REPOS` | comma-separated `label:owner/repo` pairs for the new-session repo dropdown |
| `POLL_INTERVAL_MS` | default 120 000 (2 min); set higher for low-volume Linear workspaces |
| `<SLUG>_PICKUP_STATE` / `<SLUG>_IN_PROGRESS_STATE` | per-agent Linear states (slug = agent slug, e.g. `ENGINEER_PICKUP_STATE`) |
| `DISABLE_LINEAR_POLLER=1` | turn the poller off entirely |

## 4. Build + start

```bash
docker compose build web
docker compose up -d
```

Watch the first boot:

```bash
docker compose logs -f web
```

Look for:

- `[auth] Bootstrapped admin user: …` (first boot only)
- `[linear] poller starting — every Ns` (or the disabled message)
- `Ready in …`

If `web` exits immediately, env validation failed — `lib/env.ts` prints exactly which vars are missing.

## 5. Verify TLS

Caddy gets a cert automatically on first request. Hit the domain over HTTPS:

```bash
curl -I https://jupietre.example.com/login
```

Expect `HTTP/2 200`. If you see a TLS error, give it a minute and check `docker compose logs caddy` — most failures are DNS not yet pointing at the server.

Sign in at `https://jupietre.example.com/login` with your `ADMIN_EMAIL` / `ADMIN_PASSWORD`. The three built-in agents (PM, Engineer, QA) seed automatically.

## 6. Authenticate the GitHub CLI inside the container

The `gh_*` MCP tools shell out to `gh` from inside the `web` container. `gh auth login` is interactive and writes to `/root/.config/gh`, which is volume-mounted so it survives restarts. Run it once:

```bash
docker compose exec web gh auth login
```

Pick **GitHub.com → HTTPS → Login with a web browser** and follow the device-flow URL. Verify:

```bash
docker compose exec web gh auth status
```

Without this step, `gh_create_pr` fails on every call.

## 7. Repos visible to the agents

Anything you want agents to work on must live under `/data/repos` *inside the web container*. The volume is `jupietre-repos`. **Source repos under `/data/repos` are read-only as far as the agents are concerned** — every session gets its own git worktree under `/app/data/worktrees/<sessionId>` (volume `jupietre-data`), so the agent can branch, commit, and trash freely without touching the source. Deleting a session removes its worktree.

Two ways to get source repos in:

```bash
# Option A: clone directly from inside the container
docker compose exec web sh -c "cd /data/repos && git clone https://github.com/owner/repo.git owner-repo"

# Option B: bind-mount a host directory in docker-compose.yml instead of the named volume.
# Replace `- jupietre-repos:/data/repos` with `- /srv/repos:/data/repos`.
```

Then add a label→repo entry in `.env`:

```
GITHUB_REPOS=app:owner/repo
```

The repo dropdown on `/sessions/new` reads this list; the path becomes `/data/repos/app`.

## 8. Install on iPhone

1. Open `https://jupietre.example.com` in Safari (Chrome on iOS uses Safari's WebKit too but the install flow lives in Safari's share sheet).
2. Sign in.
3. Tap **Share → Add to Home Screen**.
4. Tap the icon. Jupietre opens full-screen with no URL bar; safe-area paddings keep content clear of the notch + home indicator.

Push notifications aren't wired yet — that's a follow-up plan.

## 9. Backups

Postgres data lives in the `jupietre-postgres-data` volume, source repos in `jupietre-repos`, per-session worktrees in `jupietre-data`. A nightly cron is enough:

```bash
# /etc/cron.daily/jupietre-backup
#!/bin/sh
set -eu
ts=$(date -u +%Y%m%dT%H%M%SZ)
out=/var/backups/jupietre
mkdir -p "$out"
docker compose -f /opt/jupietre/docker-compose.yml exec -T postgres pg_dump -U jupietre jupietre | gzip > "$out/db-$ts.sql.gz"
docker run --rm -v jupietre_jupietre-repos:/repos -v "$out":/out alpine tar -czf "/out/repos-$ts.tar.gz" -C /repos .
# Worktrees + Jupietre state. Optional — they regenerate from sessions, but
# backing them up means a faster recovery on disk loss.
docker run --rm -v jupietre_jupietre-data:/data -v "$out":/out alpine tar -czf "/out/data-$ts.tar.gz" -C /data .
find "$out" -mtime +14 -delete
```

Send `/var/backups/jupietre` off the box however you usually move backups.

## 10. Updates

```bash
cd /opt/jupietre
git pull
docker compose build web
docker compose up -d web
```

Drizzle schema changes auto-apply on boot via `instrumentation.ts` → bootstrap path *only when explicitly invoked* — for now run them manually:

```bash
docker compose exec web bun run db:push
```

If `db:push` introduces a destructive change (column drop), drizzle-kit prompts for confirmation; run it interactively (no `-T`).

## Troubleshooting

| Symptom | Most likely cause |
| --- | --- |
| Caddy keeps retrying ACME | DNS not yet propagated, or port 80 blocked by firewall |
| `web` exits with "JWE_SECRET must be set" | env file not loaded — confirm `.env` exists at repo root and Compose sees it |
| `gh_create_pr` returns "not authenticated" | step 6 not run, or volume not mounted (check `docker compose config`) |
| SSE messages appear all at once instead of streaming | reverse proxy buffering — verify `Caddyfile` `flush_interval -1` block is in place |
| Agent says "permission denied" on git push | ssh keys aren't mounted; switch the repo remote to HTTPS so it uses `gh` auth |
