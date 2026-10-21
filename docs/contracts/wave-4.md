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
