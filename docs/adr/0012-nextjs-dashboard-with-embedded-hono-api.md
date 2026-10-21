# ADR 0012 — Next.js dashboard with the Hono API mounted inside it

**Status:** accepted (supersedes ADR 0002 "Hono + static SPA instead of Next.js")

## Context

The blueprint chose a Vite SPA served by a standalone Hono server. The owner asked for the dashboard to
be built in Next.js. We still want one container for self-hosting and an API that the widget, the SDK and
the MCP server can call independently of the dashboard.

## Decision

- `apps/web` is a Next.js 16 App Router app (`output: "standalone"`, Cache Components on).
- The whole HTTP API stays a single Hono app in `packages/api`. Next mounts it through two catch-all route
  handlers: `app/api/[[...route]]` and `app/w/[[...route]]`. Next adds no API logic of its own.
- Dashboard screens are client components that call `/api` with TanStack Query; the session is read on the
  client (Better Auth) and re-verified by the API on every request. No server component reads cookies, so
  the static shell prerenders and Cache Components rules stay simple.
- Migrations run from `instrumentation.ts` (Node runtime only) under an advisory lock.
- The widget bundles are built by `packages/widget` and served from `apps/web/public`.

## Consequences

- One image, one process, one port — the self-host story from the blueprint is unchanged.
- `packages/api` can still run on its own (any Fetch-API server) if the API ever needs to scale separately.
- Pages prerender as static shells; data always comes from the API, so there is a single authorization path.
