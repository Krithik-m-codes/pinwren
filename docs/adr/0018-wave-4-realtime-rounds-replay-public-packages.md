# ADR 0018 — Wave 4 backend: real time, rounds, replay, viewer role, public packages

**Status:** accepted

## Context

Wave 4 (`docs/contracts/wave-4.md`) adds the real-time inbox, review rounds and saved views, session replay, signed
identity, the viewer role, a public SDK, an MCP server and a CLI. Postgres must stay the only required service and the
app runs as several cluster workers (ADR 0013).

## Decision

1. **Real time over Postgres LISTEN/NOTIFY.** Each process holds one extra connection listening on `pinwren_events`.
   Domain events are published from `emit()` (same moment as the job queue, not through it) after loading the few
   fields a stream event carries; payloads stay under 7 KB (`changes` values are dropped above it). Each process keeps
   its own ring of the last 500 events for `Last-Event-ID` (ids are `<worker>.<seq>`, so a reconnect to another
   worker replays nothing — best effort, as the contract says). Presence heartbeats are NOTIFYed too and held in memory
   per process with a 45 s expiry; a process that started late learns presence within one heartbeat (20 s). Streams
   end after 15 minutes so revoked sessions don't linger; EventSource reconnects on its own. `Cache-Control:
no-transform` keeps compression from buffering the stream.
2. **Ingest stays one statement (ADR 0013).** `round_id` (the asked-for active round, else the project's only active
   round), `consent` and the replay asset row are part of the same CTE; the replay bytes are written to storage
   before it, like screenshots. A replay is kept only if the project records replays.
3. **PDF exports use a ~200-line writer of our own** (PDF 1.4, standard Helvetica, WinAnsi, text only) rather than
   pdfkit: no font files to resolve through Turbopack, no `serverExternalPackages` entry in `next.config.ts`, and
   escaping untrusted text is one small function (`pdfString`). Characters outside WinAnsi print as `?`.
4. **The viewer role is enforced once, in front of every dashboard route**, with an explicit list of personal-state
   writes a viewer may still make. `permissions.test.ts` walks the real route table, so a new mutating route is
   read-only for viewers unless someone adds it to the list. Tokens act with their owner's role, so a viewer's token
   can't write through `/api/v1` or `/mcp` either.
5. **Public packages (`@pinwren/sdk`, `@pinwren/mcp`, `@pinwren/cli`, MIT).** In the monorepo their entry points are
   the TypeScript source (like `@pinwren/core`), so the dashboard and the API use them without a build step; the
   published manifests come from `publishConfig` (dist ESM + CJS + `.d.ts`), which pnpm applies on publish. The SDK's
   types are **generated** from core's Zod schemas (`z.toJSONSchema` → a small printer) and checked by a test, so the
   published package has no runtime dependencies and no Zod types. The two binaries bundle the SDK so they run from a
   checkout too. Core's wire schemas are inlined into MIT packages exactly as the MIT widget already does.
6. **MCP over Streamable HTTP is stateless with JSON responses.** Each `/mcp` request builds a server whose SDK client
   calls `/api/v1` in-process, so scopes, roles and validation are the public API's. No sticky sessions are needed
   across workers or replicas. The token is checked before the MCP handshake so clients see `401` at connect time.
7. **Email queue throughput.** `notify.email` runs four local workers polling every second: one SMTP round trip at a
   time let replies to reporters wait minutes behind team notifications after a burst of reports.

## Consequences

- One more Postgres connection per process (the listener): size `max_connections` ≥ workers × (`DATABASE_POOL_MAX` +
  `PINWREN_JOBS_POOL_MAX` + 1) + headroom.
- `Last-Event-ID` resumption is per worker; across workers the dashboard refetches on reconnect.
- New public packages must be published with `pnpm publish` (npm would publish the source entry points). Release
  automation for them is not set up yet.
- Next.js's proxy caps request bodies at 10 MB; the full 10 MB replay limit needs `middlewareClientMaxBodySize`
  raised in `apps/web/next.config.ts`.
