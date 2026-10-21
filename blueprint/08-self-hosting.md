# 08 — Self-hosting

## 1. Image

- `ghcr.io/<org>/pinwren:<version>` and `:latest`, multi-arch (`linux/amd64`, `linux/arm64`), built in CI with provenance + SBOM, signed with cosign.
- Base: `node:24-alpine` (or distroless node), non-root `uid 10001`, read-only root filesystem except `/data` and `/tmp`.
- Contents: compiled server (single bundled `server.mjs` + required native-free deps), dashboard static build, widget bundles, migrations, `HEALTHCHECK` on `/healthz`.
- Targets: image < 250 MB, idle RSS < 200 MB, cold start < 3 s (excluding migrations).

## 2. Compose (Community quick start)

```yaml
# docker/compose.yml
services:
  pinwren:
    image: ghcr.io/<org>/pinwren:latest
    restart: unless-stopped
    ports: ["3000:3000"] # put a TLS reverse proxy in front (see below)
    env_file: .env
    environment:
      DATABASE_URL: postgres://pinwren:${POSTGRES_PASSWORD}@db:5432/pinwren
    volumes: [pinwren-data:/data]
    depends_on: { db: { condition: service_healthy } }
  db:
    image: postgres:17-alpine
    restart: unless-stopped
    environment: { POSTGRES_USER: pinwren, POSTGRES_PASSWORD: "${POSTGRES_PASSWORD}", POSTGRES_DB: pinwren }
    volumes: [pinwren-db:/var/lib/postgresql/data]
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U pinwren"], interval: 5s, retries: 10 }
volumes: { pinwren-data: {}, pinwren-db: {} }
```

Variants shipped in `docker/`:

- `compose.caddy.yml` — adds Caddy with automatic HTTPS for `PINWREN_URL`.
- `compose.traefik.yml` — labels for an existing Traefik.
- `compose.minio.yml` — S3 storage with MinIO for people who want object storage locally.
- `compose.external-db.yml` — app only, external Postgres.

One-liner installer (`install.sh`): checks Docker, writes `.env` with generated secrets, asks for the domain, starts compose with Caddy.

## 3. Required environment

Minimum `.env`:

```
PINWREN_URL=https://feedback.example.com
POSTGRES_PASSWORD=<generated>
PINWREN_SECRET=<generated 32+ bytes>          # sessions, CSRF, signing
PINWREN_ENCRYPTION_KEY=<generated 32 bytes>   # encrypts secrets at rest
```

Everything else is optional — see [templates/env.example](templates/env.example). Email, storage and AI can also be configured in the admin UI (stored encrypted in the DB).

## 4. First run

1. Open `PINWREN_URL` → setup wizard (only available while no admin exists, or with `PINWREN_SETUP_TOKEN` printed in logs to prevent setup-hijacking on public hosts).
2. Create the owner account → org → first project → snippet → verification.
3. Optional: email (with "Send test"), storage driver, AI provider, licence upload.

## 5. Upgrades

- `docker compose pull && docker compose up -d`. Migrations run automatically under an advisory lock; the app refuses to start on a schema **newer** than itself (downgrade protection) with a clear log message.
- Breaking upgrades require stepping through each major (documented); `pinwren doctor` CLI inside the container checks config, DB connectivity, storage writability, SMTP, and pending migrations.

## 6. Backups

- Built-in scheduled backup job (opt-in): `pg_dump` (via the `postgres` client bundled in the image) + storage sync to any S3 target (`PINWREN_BACKUP_S3_*`), retention N days, with restore documented and tested in CI (`e2e/backup-restore.spec.ts`).
- Admin UI shows last backup status.

## 7. Scaling

| Size                                    | Setup                                                                                                                   |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Small (≤ 20 users, ≤ 10k reports/month) | Defaults: 1 container, 2 vCPU, 1 GB RAM, `PINWREN_WORKERS=2` — measured ~70 req/s at p95 ≤ 50 ms (`loadtest/README.md`) |
| Medium-small                            | 4 vCPU, `PINWREN_WORKERS=4` — measured 130 req/s at p95 < 100 ms                                                        |
| Medium                                  | `PINWREN_ROLE=web` × 2 behind a load balancer + `PINWREN_ROLE=worker` × 1, S3 storage                                   |
| Large                                   | Same + managed Postgres with read replica (`DATABASE_READ_URL`), optional Redis for rate limits/SSE (`REDIS_URL`)       |

Helm chart (`deploy/helm/pinwren`) in Phase 4.

## 8. Reverse proxy requirements

- Pass `X-Forwarded-For/Proto/Host`; set `PINWREN_TRUST_PROXY=1`.
- Allow request bodies ≥ 25 MB on `/w/uploads/*`.
- Disable response buffering for `/api/stream` (SSE) — e.g. nginx `proxy_buffering off;` — documented snippets for nginx, Caddy, Traefik.

## 9. Air-gapped installs

No outbound calls are required: licence verification is offline, telemetry is off by default, fonts and assets are bundled (no Google Fonts CDN), update checks can be disabled (`PINWREN_UPDATE_CHECK=false`).
