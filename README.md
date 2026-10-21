# Annota

Pinned feedback and bug reports for any website. One script tag adds a widget that lets clients and
teammates **pin comments on exact page elements** or **send an annotated screenshot bug report** with
console errors, failed requests and browser details. Everything lands in a fast triage inbox.

Self-host it with Docker in one container plus Postgres.

> Status: early alpha. Product spec and roadmap: [blueprint/](blueprint/README.md); feature checklist against SitePing and BugPin: [blueprint/14-feature-parity.md](blueprint/14-feature-parity.md).

## Self-host with Docker

```bash
cp docker/.env.example docker/.env      # set ANNOTA_URL, ANNOTA_SECRET, POSTGRES_PASSWORD
docker compose -f docker/compose.yml --env-file docker/.env up -d --build
```

Open `ANNOTA_URL`, create an account and a workspace, create a project for your site, then paste the
snippet it shows before `</body>`:

```html
<script src="https://feedback.example.com/widget.js" data-project="pk_…" async></script>
```

Put a TLS reverse proxy (Caddy, Traefik, nginx) in front and allow request bodies of at least 12 MB
(screenshots). Data lives in two volumes: `annota-db` (Postgres) and `annota-data` (screenshots).

## Develop

Requirements: Node 22+, pnpm, Docker (for Postgres).

```bash
pnpm install
pnpm db:up                                # Postgres on 127.0.0.1:5433
cp apps/web/.env.example apps/web/.env.local
pnpm --filter @annota/widget build        # widget.js into apps/web/public
pnpm --filter @annota/web dev -- -p 3100  # migrations run on start
```

Try the widget on the demo site: add `localhost:5173` to a project's allowed sites, run
`node scripts/demo-server.mjs`, and open `http://localhost:5173/?key=<project key>&host=http://localhost:3100`.

API smoke test (20 end-to-end checks against a running instance):

```bash
node scripts/smoke.mjs http://localhost:3100
```

## Load testing

k6 against the Docker stack, with results and sizing: [loadtest/README.md](loadtest/README.md).

## Layout

| Path | What |
|---|---|
| `apps/web` | Next.js 16 dashboard; mounts the API at `/api` and `/w` |
| `packages/api` | Hono API: Better Auth, dashboard routes, public widget routes, storage, rate limits |
| `packages/db` | Drizzle schema + migrations (Postgres) |
| `packages/core` | Shared Zod schemas and origin matching |
| `packages/widget` | The embeddable widget (MIT) — `widget.js` + lazy `widget-capture.js` |
| `docker` | Dockerfile, self-host compose, dev database compose |

## Licence

AGPL-3.0 for the server and dashboard; MIT for `packages/widget`.
