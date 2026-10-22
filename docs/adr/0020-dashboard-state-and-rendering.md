# ADR 0020 — Dashboard state (Redux Toolkit + RTK Query) and rendering (server/client split with Cache Components)

**Status:** accepted (supersedes the "client components with TanStack Query; no server component reads cookies"
part of ADR 0012; the Hono API mounted in Next.js stays)

## Context

Until wave 4 every dashboard screen was a client component: the session was checked in the browser (a blank
screen until it loaded), every layout opted out of instant-navigation validation (`export const instant =
false`), data came from TanStack Query and forms were hand-validated `useState`. For v1 the owner asked for
Redux Toolkit with RTK Query, Zod-validated forms with one form library, and real use of Next.js 16 — Cache
Components, server and client components, the React Compiler. Wave 4 also adds a real-time stream (SSE) whose
events must update whatever is on screen.

## Decision

1. **Store.** `makeStore()` builds a store per request on the server and once per browser session on the client
   (`StoreProvider` in the root layout, created in a `useState` initializer — a module-level store would be shared
   by all requests). The server-side store has no side effects (no listeners, no stream).
2. **RTK Query for every dashboard endpoint.** One `createApi` (`lib/store/api/base.ts`) with endpoints injected per
   domain (account → projects → feedback → rounds → admin, each building on the previous so the last one types
   everything). `fetchBaseQuery` against `extra.apiBase` with problem-details errors flattened to `{ status, code,
message }`. Tags: lists provide `{ type, id: "LIST" }` plus one tag per row; details `{ type, id }`. Feedback,
   notification, preference, project and round changes are optimistic (`updateQueryData` + `undo()` on failure);
   project PATCHes are queued per project, because the API merges each partial config into what it read and two
   in flight could lose one. Better Auth calls (members, invitations, roles) run as `queryFn`s; their Date objects
   are serialised to JSON so the state stays serialisable.
3. **Slices for UI state:** `inbox` (selection with shift-ranges, the open picker, the last change for `u`,
   density), `ui` (command palette, shortcuts help, filter sheet), `realtime` (connection status, last event id,
   presence, the "N new" queue, freshly arrived ids). Filters, the layout and the open item stay **in the URL** —
   shareable, back/forward, readable by the server — and change through the History API (`useUrlParams`), which
   Next.js keeps in sync with `useSearchParams` without a server round trip. Saved views are URLs plus `saved=<id>`.
4. **Side effects in the listener middleware** (`lib/store/listeners.ts`): `realtimeStarted` opens one
   EventSource; events are validated with core's Zod schemas and become cache updates — `feedback.created`
   refetches lists while the inbox is scrolled to the top, otherwise it queues behind the pill;
   `feedback.updated` patches every cached copy and refetches an open detail; `feedback.deleted` removes rows;
   `comment.created` bumps counts; `presence` fills `realtime.presence`. A stream the browser won't retry is
   reopened with exponential backoff (1 s → 30 s) and `?lastEventId=`; every reopen refetches the lists because
   `Last-Event-ID` replay is per worker (ADR 0018). Presence heartbeats (`presenceWatched`) run every 20 s while
   an item is open. All of it is unit-tested with a fake EventSource and a stubbed `fetch`.
5. **Server/client split.** Layouts and page frames are server components and part of the static shell (the
   sidebar chrome, navigation, skeletons). Everything that needs the session streams in behind `<Suspense>`:
   - `getSession()` is `use cache: private` (`cacheLife({ stale: 60 })`): per-session, never stored on the
     server, prefetchable; `requireViewer()` reads `/api/me` and redirects to sign-in or onboarding from the
     server. The proxy adds an optimistic redirect when there is no session cookie at all.
   - Server components read the API **in process** (`serverApi()`: `app.fetch` with the visitor's cookie, after
     `connection()`), so there is still one authorisation path. The inbox's first page, the project, rounds,
     projects, views, `me` and entitlements are fetched this way and handed to RTK Query with `<HydrateQueries>`
     (`upsertQueryEntries` while rendering, before any subscriber below exists — the Redux docs' App Router
     pattern), so the client does not fetch them again.
   - Org-level data that is identical for every member (branding, the workspace name) is `use cache` +
     `cacheTag("branding:<org>")`, read by the member's own org id. Saving branding calls a server action that
     re-reads the session and `updateTag`s it; its response re-renders the sidebar and theme.
   - Public pages (sign-in, sign-up) are fully static; the accept-invitation and onboarding frames are static with
     the session part streamed.
   - All `instant = false` opt-outs are gone; `next build` reports every app route as Partial Prerender.
6. **Hydration rules.** Each streamed boundary seeds what its client components read on first render (the
   session boundary seeds `me`, branding, entitlements, projects and views, since boundaries hydrate in any order).
   State that exists only in the browser (presence, new items) is rendered after `useMounted()`. Relative times
   and locale dates render through `<RelativeTime>` / `<LocalDate>` with `suppressHydrationWarning`.
7. **Forms: react-hook-form + Zod** via `useZodForm` (resolver from `@hookform/resolvers`), using core's request
   schemas directly, or picks/pipes of them with friendlier messages (`lib/form-schemas.ts`). Every `<form>` in the
   dashboard uses it; `useWatch` instead of `watch()` keeps forms React-Compiler-safe.
8. **Viewer role.** `useViewer().canWrite` hides mutations; `<ReadOnly>` provides a context the design-system
   switch/select/slider/checkbox read (and a disabled `<fieldset>` for native inputs), so whole settings screens
   become read-only without per-control conditions.

## Consequences

- First paint of a signed-in screen is the static shell (sidebar, skeletons) instead of a blank page, and the inbox
  arrives server-rendered with its data.
- A component that reads a query the nearest `<HydrateQueries>` doesn't seed renders its loading state on the
  server and fetches after hydration — correct, just not instant. New server-fetched data must be seeded at (or
  above) the boundary whose client components read it, or hydration will mismatch.
- RTK Query arguments are serialised for cache keys, so list arguments are built by one function on both sides
  (`lib/inbox-filters.ts`).
- The session's private cache can serve a stale role for up to a minute in a client's router cache; the API
  enforces roles on every request regardless.
