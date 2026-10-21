# Load testing

`k6.js` drives the self-host stack (`docker/compose.yml`: app + Postgres) with four concurrent scenarios:

| Scenario | What it simulates | Default rate |
|---|---|---|
| `widget_read` | A visitor's widget loading config + the pins of a page (2 requests) | 60 iterations/s |
| `widget_ingest` | Visitors sending comments and bug reports (40% bugs, half with a screenshot up to 60 KB) | ramps to 25/s |
| `dashboard` | A team member listing, opening and re-statusing feedback | 10 iterations/s |
| `abuse` | One IP flooding the submit endpoint — must be throttled | 5/s for 20 s |

Each simulated visitor sends its own `X-Forwarded-For`, so the per-IP rate limit behaves as in production.

## Run

```powershell
# PowerShell (Git Bash rewrites the /scripts path inside the container)
docker compose -p annota-load -f docker/compose.yml -f docker/compose.loadtest.yml `
  --env-file <env file> up --build --abort-on-container-exit --exit-code-from k6
```

The env file needs `ANNOTA_URL=http://annota:3000`, `ANNOTA_SECRET`, `POSTGRES_PASSWORD`, `ANNOTA_IMAGE`.
Knobs: `ANNOTA_CPUS`, `ANNOTA_WORKERS`, `DATABASE_POOL_MAX`, `K6_DURATION`, `K6_READ_RPS`, `K6_INGEST_RPS`,
`K6_DASH_RPS`. Thresholds fail the run (exit 99) if p95 or error budgets are missed.

No Redis is needed: rate limits and (later) background jobs live in Postgres by design (blueprint ADRs 0001/0003).

## Results — 2026-10-21 (Windows 11, Docker Desktop, Postgres 17, 2-minute runs)

| Run | App limits | Offered load | Result | p95 read / dashboard / submit | Errors |
|---|---|---|---|---|---|
| 1 — first build | 2 CPU, 1 process | ~170 req/s | ❌ saturated at 64 req/s | 5.8 s / 9.5 s / 9.1 s | 0 |
| 2 — throttle "last seen" write, lock-free page insert, session cookie cache | 2 CPU, 1 process | ~170 req/s | ❌ 75 req/s | 5.2 s / 8.5 s / 12.3 s | 0.04 % |
| 3 — 2 cluster workers, slimmer pins response | 2 CPU, 2 workers | ~170 req/s | ❌ 102 req/s | 3.8 s / 5.6 s / 10.6 s | 0 |
| 4 — single-statement report insert (CTE) | 2 CPU, 2 workers | ~170 req/s | 🟡 127 req/s, 206 dropped | 0.97 s / 1.1 s / 2.2 s | 0 |
| 5 — same build | **4 CPU, 4 workers** | ~130 req/s | ✅ all thresholds | **38 ms / 65 ms / 70 ms** | 0 |
| 6 — same build, lighter load | **2 CPU, 2 workers** | ~74 req/s | ✅ all thresholds | **20 ms / 41 ms / 50 ms** | 0 |

The rate limiter held in every run: the single-IP flood got exactly its 10/minute allowance through and the rest
was answered `429`.

### What the bottlenecks were (and how they were found)

`pg_stat_activity` sampled during the runs showed most connections waiting on row locks:

1. **`project` row** — every widget load wrote `last_seen_at`; now written at most once a minute.
2. **`page` row** — the report upsert updated the page row on every report; now `insert … on conflict do nothing`.
3. **Per-project counter** — numbering reports (`#142`) locks one row per project. Holding it across several
   round trips while the event loop was busy queued ~30 connections behind it. The number, report, diagnostics,
   screenshot record and activity entry are now written in one SQL statement, so the lock lasts microseconds.

After that the limit was CPU: one Node process uses one core. `docker/cluster.cjs` now runs `ANNOTA_WORKERS`
processes (default 2) sharing the port.

### Sizing guide

| Server | Settings | Comfortable load |
|---|---|---|
| 1–2 vCPU, 1 GB | `ANNOTA_WORKERS=2` | ~70 req/s ≈ thousands of daily active widget visitors |
| 4 vCPU, 2 GB | `ANNOTA_WORKERS=4` | 130+ req/s with p95 < 100 ms |

A widget visitor costs about two requests per page view; a report adds one. Screenshots are the heaviest request.
