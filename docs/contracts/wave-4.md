# Wave 4 contract — v1 completion

Shared by four agents working in parallel:

| Agent         | Owns                                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **backend**   | `packages/core`, `packages/db`, `packages/api`, new `packages/sdk`, new `packages/mcp`, new `packages/cli`, `scripts/smoke.mjs` |
| **widget**    | `packages/widget`, new `packages/react`                                                                                         |
| **site**      | new `apps/www` (marketing site + docs + demo)                                                                                   |
| **dashboard** | `apps/web` (starts after backend lands; reads §1–§6)                                                                            |

Change this file in the same edit if you must change the contract, and say so in your report.

## 1. Real-time — `GET /api/stream` (SSE)

Session-authenticated. Query `projectIds=<id,id>` (optional; default all projects of the active org).
Events (`event:` field), each `data:` is JSON:

| event              | data                                                                  |
| ------------------ | --------------------------------------------------------------------- |
| `feedback.created` | `{ id, projectId, number, kind, status, priority, title, createdAt }` |
| `feedback.updated` | `{ id, projectId, changes: Record<string, unknown> }`                 |
| `feedback.deleted` | `{ id, projectId }`                                                   |
| `comment.created`  | `{ id, feedbackId, projectId, visibility, authorName }`               |
| `presence`         | `{ feedbackId, users: { id, name, image }[] }`                        |
| `ping`             | `{}` every 25 s                                                       |

Fan-out across cluster workers with Postgres `LISTEN/NOTIFY` (channel `pinwren_events`, payload ≤ 7 KB — send ids,
clients refetch details). `Last-Event-ID` resumes from an in-memory ring of the last 500 events per worker (best
effort). Presence: `POST /api/presence { feedbackId | null }` heartbeat every 20 s, expires after 45 s.

## 2. Review rounds (F-055) and saved views

- `review_round` table per blueprint 03. `GET/POST /api/projects/:id/rounds`, `GET/PATCH/DELETE /api/rounds/:id`
  (`{ name, dueAt, status: "active"|"closed" }`), `GET /api/rounds/:id/export?format=csv|pdf` (PDF rendered
  server-side without headless Chrome — e.g. `pdfkit` or `@react-pdf/renderer`).
- Feedback gains `roundId`; `PATCH /api/feedback/:id { roundId }`; list filter `roundId`.
- Widget: `GET /w/config` gains `activeRound: { id, name } | null` (the project's active round, if exactly one);
  `POST /w/feedback` accepts `roundId` and the server defaults it to the active round.
- Saved views: `GET/POST /api/views`, `PATCH/DELETE /api/views/:id` — `{ name, filters: FeedbackListQuery, layout:
"list"|"board", shared: boolean }`.

## 3. Session replay (F-007)

- `POST /w/feedback` accepts `replay?: { dataUrl: "data:application/gzip;base64,…", durationMs: number,
events: number }` (≤ 10 MB decoded) — stored as `feedback_asset` kind `replay`. The widget records with rrweb
  (lazy `widget-replay.js`), masks all inputs, keeps a rolling 30–120 s buffer, gzips with `CompressionStream`.
- `CaptureConfig.replay: { enabled: boolean (default false); seconds: number (30..120, default 60) }`.
- Dashboard plays it with `rrweb-player` from `GET /api/assets/:id` (gzip JSON array of rrweb events).

## 4. Identity, URL patterns, visibility, roles

- **Signed identity**: `Pinwren.identify({ id, name, email }, { signature })` where `signature` =
  hex HMAC-SHA256(project identity secret, `id`). Server verifies; verified reporters get `reporter_guest.verified =
true` and the dashboard shows a check mark. Secret: `GET /api/projects/:id/identity-secret`, rotate endpoint.
- **URL patterns**: widget sends `page.urlPattern` (from `Pinwren.setPageScope({ urlPattern })` or `data-url-pattern`);
  pins list accepts `urlPattern=` and matches feedback by pattern when given.
- **Visibility (SitePing parity)**: `WidgetConfig.visibility: { environments: "all" | "non-production";
minViewportWidth: number (default 0) }` — widget-side only; `forceShow` via `data-force-show` / init option.
- **Viewer role**: members with role `viewer` may read everything but not mutate (403 `READ_ONLY_ROLE`) — enforce in
  the API for every mutating dashboard route.

## 5. Public SDK, MCP, CLI

- `packages/sdk` → `@pinwren/sdk` (MIT): typed client for `/api/v1` (list/get/update feedback, comments, rounds),
  Bearer token, ESM + CJS, generated types from the Zod schemas.
- `packages/mcp` → `@pinwren/mcp` (MIT): stdio MCP server (`npx @pinwren/mcp`, env `PINWREN_URL`, `PINWREN_TOKEN`)
  **and** Streamable HTTP at `/mcp` in the app (Bearer token). Tools: `list_projects`, `search_feedback`,
  `get_feedback`, `get_reproduction_context`, `update_feedback`, `add_comment`, `resolve_feedback`.
- `packages/cli` → `@pinwren/cli` (MIT): `pinwren init` (asks URL + project key, prints/inserts the snippet for
  HTML/Next/Vite projects), `pinwren doctor` (checks a URL: health, widget config for a key + origin, version),
  `pinwren status` (lists projects + open counts via token).

## 6. Consent record, unsubscribe, licences

- Consent: `POST /w/feedback` accepts `consent: { version: string; acceptedAt: string }`; stored on the feedback.
- Reporter emails carry a signed one-click unsubscribe link (`/api/unsubscribe?token=`) + `List-Unsubscribe`
  headers; suppression list table.
- **Enterprise licence (F-098)**: Ed25519-signed licence file per blueprint 07 §4 (`PINWREN_LICENSE_FILE` or upload
  in Settings › Licence), entitlements resolved server-side, `GET /api/me/entitlements`; white-label (hiding
  "Powered by", custom email branding) requires `white_label`; nothing else is gated in v1. A `tools/sign-license`
  script signs payloads with a private key from env (never committed); tests use a throwaway key pair.

## 7. Widget chunks (rebuild)

`widget.js` (core ≤ 30 KB gzip) loads on demand: `widget-panel.js`, `widget-report.js`, `widget-editor.js`
(annotation editor, split out of capture), `widget-capture.js` (SnapDOM only, target ≤ 75 KB), `widget-replay.js`
(rrweb record), `widget-i18n-<locale>.js`. All chunk URLs are content-hashed (`widget-panel.<hash>.js`) with a small
manifest inlined into `widget.js` so CDNs can cache them immutably; `widget.js` itself stays un-hashed with
`Cache-Control: max-age=300`.

## 8. Widget implementation notes (widget agent, built)

- **Files** (§7): `widget.js` + `widget-<chunk>.<10-hex>.js` / `widget-i18n-<code>.<10-hex>.js`, written to
  `packages/widget/dist/` and `apps/web/public/` (stale hashed files are deleted on every build);
  `dist/manifest.json` lists names and sizes. Chunks load from the directory `widget.js` was served from (so a
  CDN copy works with `data-endpoint` pointing at the API). **Headers for the web app**: `/widget.js` →
  `Cache-Control: public, max-age=300`; `/widget-*.<hash>.js` (regex `^/widget-[\w-]+\.[0-9a-f]{10}\.js$`) →
  `Cache-Control: public, max-age=31536000, immutable`; both `Content-Type: text/javascript; charset=utf-8`
  and `Access-Control-Allow-Origin: *` (scripts are loaded cross-origin by customer sites); serve brotli/gzip.
- **Identity** (§4): `POST /w/feedback` sends `reporter: { name?, email?, externalId: <id>, signature? }`
  (signature only with an id, lower-case hex). Replies (`POST /w/feedback/:id/comments`) send the same fields
  in `author`; the server may ignore them there.
- **Consent** (§6): `version` is computed by the widget as `1-<8 hex>` (FNV-1a of the notice text — `(built-in
text)` when null — and the privacy URL), so a changed notice is asked for again; `acceptedAt` is the ISO time
  of acceptance. Sent on every submission after acceptance, never when the notice is disabled.
- **Replay** (§3): rrweb **2.1.7** events (`@rrweb/record`), so the dashboard needs rrweb-player / rrweb 2.x.
  Checkout every 10 s; the buffer keeps whole segments covering at least `seconds`. Frozen when the bug report
  opens, gzipped on send; the reporter can switch it off. Off in privacy mode unless the host page sets
  `allowReplayInPrivacyMode` (init option / `data-allow-replay-in-privacy-mode`); then all text is masked too.
- **Visibility** (§4): see `packages/widget/src/visibility.ts` for the production-host definition.

## 9. Backend implementation notes (backend agent, built)

Clarifications and the few additions made while building §1–§6. Request/response schemas are in `@pinwren/core`
(`realtime.ts`, `rounds.ts`, `license.ts`, `api-types.ts`, `url-pattern.ts`).

- **Stream (§1)**: on connect the server sends `retry: 3000` and an immediate `ping`, then the `Last-Event-ID` backlog
  and a `presence` snapshot. Event ids are `<worker>.<seq>`; ids from another worker replay nothing. `presence` data
  also carries `projectId`; `feedback.updated` `changes` is field → `{ from, to }` (values dropped with
  `truncated: true` above the 7 KB cap). Streams close after 15 min so the session is re-checked; EventSource
  reconnects with `Last-Event-ID`. Presence is one location per user (the latest heartbeat wins); `POST /api/presence`
  → `{ ok: true }`, `404` for an unknown item. `?projectIds=` with a project of another org → `404`.
- **Rounds (§2)**: round = `{ id, projectId, name, dueAt, status, closedAt, createdBy, createdAt, updatedAt, counts:
{ total, open, closed } }` (`{ round }` / `{ rounds }`, active first). Closing sets `closedAt`; deleting a round keeps
  its items (`roundId` → null). `PATCH /api/feedback/:id { roundId }` to a round of another project → `400
INVALID_ROUND`. Ingest: an explicit `roundId` is used only if it is an _active_ round of the project; otherwise the
  single active round (if exactly one), else none (never an error). Exports: `attachment` downloads; CSV is RFC 4180
  with a BOM, formula-looking cells prefixed with `'`; PDF is a text-only A4 document (own writer, Helvetica, no
  fonts to bundle). Views = `{ id, name, filters, layout, shared, ownerId, owner: { id, name }, mine, createdAt,
updatedAt }` (`{ view }` / `{ views }`); `filters` is `viewFilters` (the list query without paging, no defaults).
  Shared views can be edited/deleted by their owner or org admins (`403` otherwise); others' personal views are `404`.
- **List filters (new)**: `GET /api/feedback` and `/api/v1/feedback` also take `priority`, `roundId`, `assigneeId`,
  `page` (substring of the page URL) and `since` (ISO); list items add `roundId` and `hasReplay`.
- **Replay (§3)**: stored only when the project's `capture.replay.enabled` is on (otherwise silently dropped); bad
  bytes or > 10 MB → `400 INVALID_REPLAY`. Assets carry `meta: { durationMs, events }`. **Open:** Next.js's proxy
  truncates request bodies at 10 MB (`middlewareClientMaxBodySize`), so a 10 MB replay (≈ 13.4 MB as base64 JSON)
  needs `apps/web/next.config.ts` to raise that limit (e.g. `"32mb"`); until then requests over 10 MB fail as `400`.
- **Identity (§4)**: the widget sends `reporter: { name?, email?, externalId, signature? }` on `POST /w/feedback` and the
  same in `author` on `POST /w/feedback/:id/comments`; the server stores `{ name, email, externalId, verified }`
  (never the signature). Pins add `reporterVerified` and `pageUrl`; widget comments add `authorVerified`.
  `GET /api/projects/:id/identity-secret` → `{ secret }` (`idsec_…`, org admins, created on first read),
  `POST …/identity-secret/rotate` → `{ secret }`; projects add `hasIdentitySecret`.
- **URL patterns (§4)**: `GET /w/feedback?urlPattern=` matches pages reported with that exact pattern **or** whose path
  matches it: `:name` = one segment, `*` = anything; origin, query and hash are ignored; trailing slash optional
  (`urlPatternMatches()` / `urlPatternRegexSource()` in core). `url` is ignored when `urlPattern` is given.
- **Viewer (§4)**: Better Auth knows the `viewer` role (invite with `role: "viewer"`). Writes a viewer may still make:
  notifications read, notification preferences, presence, own API tokens, personal (non-shared) views, and
  `/api/admin/*` (instance admin is a separate permission). A viewer's API token is read-only on `/api/v1` and `/mcp`.
- **Public API additions (§5)**: `GET /api/v1/token` (who the token acts as: `{ token, user, orgId, role }`),
  `GET /api/v1/projects` (with `openCount`; `feedback:read` covers it), `GET /api/v1/feedback/:id/reproduction`
  (`{ feedbackId, markdown, steps, failingRequests, errors, replay }`), `GET /api/v1/assets/:id`,
  `GET /api/v1/projects/:id/rounds`, `GET|PATCH /api/v1/rounds/:id`. `GET /api/health` adds `version`.
  `/mcp` is stateless Streamable HTTP with JSON responses (no sessions, works across workers); no or bad token →
  `401` with `WWW-Authenticate: Bearer`.
- **Consent (§6)**: stored as given on `feedback.consent` and returned in the item detail.
- **Unsubscribe (§6)**: `GET /api/unsubscribe?token=` shows a confirmation page (link scanners must not unsubscribe
  anyone); `POST` to the same URL (the page's button, or RFC 8058 one-click from the mail client) unsubscribes.
  Suppression is per organisation and checked when each reporter email is _sent_, so queued mail is stopped too.
  Reporter emails carry an "Unsubscribe" footer link plus `List-Unsubscribe` / `List-Unsubscribe-Post`.
- **Licence (§6)**: `GET /api/me/entitlements` → `entitlementsResponse` (`edition`, `status: none|valid|grace|expired|
invalid`, `features`, `readOnly`, `license`, `error`, `seats`). Instance admins: `GET|POST|DELETE /api/admin/license`
  (`POST { license: "<.lic text>" }`; invalid/tampered/unknown key → `400 INVALID_LICENSE`; `PINWREN_LICENSE_FILE` set →
  `409 LICENSE_LOCKED`), answering `{ license: { …entitlements, source: "file"|"upload"|null, details } }`.
  **White-label**: `widgetBranding.hidePoweredBy` is still saved without the entitlement but `/w/config` reports it
  `false` (existing projects keep their setting; it takes effect once a licence with `white_label` is installed). After
  the grace period the configured value keeps applying but changing it → `403 LICENSE_READ_ONLY`. Emails: without
  `white_label` a custom product name gets "· Powered by Pinwren" in the footer; with it, the footer is only "Sent by
  <name>". Nothing else is gated.
