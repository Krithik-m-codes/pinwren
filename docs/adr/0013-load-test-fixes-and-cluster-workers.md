# ADR 0013 — Hot-row fixes and cluster workers (from the first load test)

**Status:** accepted

## Context

The first k6 run (`loadtest/README.md`) saturated at ~64 req/s with multi-second p95s and no errors.
`pg_stat_activity` showed lock waits on three rows (project `last_seen_at`, page upsert, per-project counter), and
the app container sat at one full core.

## Decision

1. Write `project.last_seen_at` only when it is more than 60 s old.
2. Insert pages with `on conflict do nothing` and look up the existing id; never update a page row on report.
3. Write a widget report — counter increment, feedback, diagnostics, screenshot record, activity — in **one**
   SQL statement (data-modifying CTEs). Screenshot bytes are written to storage before it, and removed if it fails.
   Racing retries of the same `clientId` resolve through the unique index to the stored record.
4. Cache Better Auth sessions in a signed cookie for 60 s.
5. Run the standalone Next.js server under `node:cluster` (`docker/cluster.cjs`, `ANNOTA_WORKERS`, default 2).
6. Widget pins: closed items excluded by default (`?include=closed` to get them), bodies truncated to 500 chars,
   at most 100 per page.

## Consequences

- p95 under the same 2-CPU limit went from ~9 s to ~50 ms at 74 req/s; 4 CPU / 4 workers handles 130 req/s at
  p95 < 100 ms.
- Per-project report numbers stay gap-free and sequential.
- A signed-out session can stay valid for up to 60 s on other tabs/devices (cookie cache lifetime).
- Each worker holds its own DB pool: size Postgres `max_connections` ≥ workers × `DATABASE_POOL_MAX` + headroom.
