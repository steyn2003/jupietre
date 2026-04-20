# Deploy via Dokploy + PWA Install

> Deploy Jupietre to your server using Dokploy (self-hosted PaaS), which handles Traefik + Let's Encrypt TLS + git-based deploys for us. Then add the PWA manifest so iPhone Safari "Add to Home Screen" opens a standalone web app.

**Assumptions (flag if wrong):**
- Dokploy is already installed and running on the server.
- Domain DNS is (or will be) pointed at the server's public IP.
- We deploy as a Dokploy **Compose** service (not the simpler single-Dockerfile "Application" — we want the app + its Postgres managed together).

---

## Chunks

### Chunk 1 — Containerize the app

**Create:**
- `Dockerfile.web` — multi-stage. `oven/bun` installs deps + `bun run build` (Next standalone output). Runtime stage: slim `node:22-slim` + copied `.next/standalone` + `bun` (the poller uses Bun) + `git` + `gh` CLI. Target under 500 MB.
- `.dockerignore` — `.next`, `node_modules`, `.planning`, `docs`, `.env*`, `.git`.

**Modify:**
- `next.config.ts` — `output: "standalone"`.
- `package.json` — runtime `start` script points at `.next/standalone/server.js` via `bun` (or `node` — whichever Next's standalone expects).

### Chunk 2 — docker-compose for Dokploy

**Modify:**
- `docker-compose.yml` — two services, both on Dokploy's shared `dokploy-network` so Traefik can route to `web`:

  ```yaml
  services:
    web:
      build:
        context: .
        dockerfile: Dockerfile.web
      restart: unless-stopped
      environment:
        POSTGRES_URL: postgres://jupietre:${POSTGRES_PASSWORD}@postgres:5432/jupietre
        JWE_SECRET: ${JWE_SECRET}
        ADMIN_EMAIL: ${ADMIN_EMAIL}
        ADMIN_PASSWORD: ${ADMIN_PASSWORD}
        ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
        APP_URL: https://${APP_DOMAIN}
        # optional: LINEAR_API_KEY, GITHUB_TOKEN, per-agent pickup state vars
      volumes:
        - jupietre_repos:/data/repos
      depends_on: [postgres]
      labels:
        - "traefik.enable=true"
        - "traefik.http.routers.jupietre.rule=Host(`${APP_DOMAIN}`)"
        - "traefik.http.routers.jupietre.entrypoints=websecure"
        - "traefik.http.routers.jupietre.tls.certresolver=letsencrypt"
        - "traefik.http.services.jupietre.loadbalancer.server.port=3000"
      networks: [default, dokploy-network]

    postgres:
      image: postgres:17
      restart: unless-stopped
      environment:
        POSTGRES_USER: jupietre
        POSTGRES_DB: jupietre
        POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      volumes:
        - jupietre_pg:/var/lib/postgresql/data
      networks: [default]

  volumes:
    jupietre_repos:
    jupietre_pg:

  networks:
    dokploy-network:
      external: true
  ```

  *Exact Traefik labels + network name verified against Dokploy docs before implementation — Dokploy's conventions evolve.*

### Chunk 3 — Env + boot safety

**Create:**
- `lib/env.ts` — `loadEnv()` called from `instrumentation.ts`. Zod schema asserts: `POSTGRES_URL`, `JWE_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ANTHROPIC_API_KEY`, `APP_URL`. Missing → log + `process.exit(1)` at boot (not at first request).

**Modify:**
- `.env.example` — add the new vars + `APP_DOMAIN`, `POSTGRES_PASSWORD`.

### Chunk 4 — PWA manifest + iPhone install

**Create:**
- `public/manifest.webmanifest` — `name: "Jupietre"`, `short_name: "Jupietre"`, `display: "standalone"`, `start_url: "/"`, `theme_color`, `background_color`, icons (192, 512, maskable).
- `public/icons/icon-192.png`, `icon-512.png`, `icon-maskable.png`.
- `public/apple-touch-icon.png` (180×180 — iOS uses this one).

**Modify:**
- `app/layout.tsx` — manifest link, apple-touch-icon link, `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style=black-translucent`, `apple-mobile-web-app-title=Jupietre`, `theme-color`, viewport `viewport-fit=cover`.
- `app/globals.css` — `env(safe-area-inset-*)` padding on outer layout; composer stays above keyboard via `env(keyboard-inset-height, 0px)`.

### Chunk 5 — Dokploy deploy doc

**Create:**
- `docs/DEPLOY.md`:
  1. In Dokploy UI, create a new **Compose** service.
  2. Point it at this repo (git provider + branch = `master`).
  3. Compose path: `docker-compose.yml`.
  4. Set env vars in Dokploy's env UI (don't commit secrets): `APP_DOMAIN`, `POSTGRES_PASSWORD`, `JWE_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ANTHROPIC_API_KEY`, `APP_URL=https://<APP_DOMAIN>`, optional Linear/GitHub tokens.
  5. Add domain + enable Let's Encrypt in Dokploy's domain UI (this sets the Traefik labels automatically if you prefer UI over hardcoded labels — pick one approach, not both).
  6. Deploy. First boot seeds admin user + built-in agents.
  7. Open a shell into the `web` container and run `gh auth login` once (needed by GitHub MCP tools). Document that this persists as long as the container's home dir persists — if Dokploy rebuilds the image from scratch, you'll need to re-login. (Alternative: mount a `gh_config` volume at `/root/.config/gh`.)
  8. Backups: rely on Dokploy's volume backup UI if it has one, else cron `pg_dump` + tar of `jupietre_repos` off-box.
  9. Updates: push to `master` → Dokploy auto-deploys (if you enabled it) or click "Rebuild" in the UI.

---

## Out of scope

- **Push notifications.** HTTPS unblocks them but the wiring (VAPID keys, subscription storage, sending code) is its own plan. Defer until "I missed an agent question" actually bites.
- **Public signup / multi-tenant.** Still single admin until M6.
- **Android install flow, splash screens.**
- **CI tests before deploy.** Dokploy auto-deploys from `master`; you're the QA gate for now.

---

## Open questions

- **Dokploy domain UI vs hardcoded Traefik labels:** pick one. Hardcoded in compose is reproducible; Dokploy UI is friendlier. Recommend hardcoded since the compose file is checked in.
- **`gh` auth persistence:** does Dokploy preserve the `web` container's filesystem across redeploys, or does every rebuild start from a fresh image? If fresh, mount a named volume at `/root/.config/gh`.
- **Poller placement:** stays inside `web` via `instrumentation.ts`. Split to a `poller` service only if it starts crashing the web process.
- **Backup target:** relies on whatever you're already doing for Dokploy-managed data.

---

## Success criteria

1. Pushing to `master` results in a working instance at `https://<your-domain>` via Dokploy, with a valid Let's Encrypt cert.
2. Admin login works on first boot with seeded credentials; built-in agents visible at `/agents`.
3. Creating a session → agent runs end-to-end (incl. MCP tools) against a persisted worktree under `/data/repos` that survives redeploys.
4. iPhone Safari → "Add to Home Screen" → tapping the icon opens Jupietre full-screen, no URL bar.
5. Content isn't clipped by notch or home indicator; composer stays above keyboard.
6. `docs/DEPLOY.md` is enough for a fresh Dokploy install without re-deriving anything.
