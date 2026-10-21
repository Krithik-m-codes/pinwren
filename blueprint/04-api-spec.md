# 04 — API specification

All endpoints are defined with `@hono/zod-openapi`; the OpenAPI 3.1 document is served at `/api/openapi.json` and rendered at `/api/docs` (Scalar). Request/response schemas live in `packages/core` and are shared with the dashboard, widget and SDK.

## 1. Surfaces

| Prefix | Caller | Auth | CORS |
|---|---|---|---|
| `/w/*` | Widget in a visitor's browser | Public project key (`X-Annota-Key`) + `Origin` allowlist, optional review-link token, optional signed identity | Reflect allowed origins only |
| `/api/*` | Dashboard SPA | Session cookie (`HttpOnly`, `SameSite=Lax`, `Secure`) + CSRF token header for mutations | Same-origin only |
| `/api/v1/*` | Public REST API, SDK, MCP | `Authorization: Bearer ann_…` scoped API token | None (server-to-server) |
| `/mcp` | AI agents (Streamable HTTP MCP) | Bearer API token | None |
| `/api/integrations/:provider/webhook` | GitHub, GitLab, Linear, Jira, Slack, Stripe | Provider signature | None |
| `/healthz`, `/readyz`, `/metrics` | Ops | none / none / bearer `ANNOTA_METRICS_TOKEN` | — |

Error format everywhere (RFC 9457 problem details):
```json
{ "type": "https://annota.dev/errors/origin-not-allowed", "title": "Origin not allowed",
  "status": 403, "code": "ORIGIN_NOT_ALLOWED", "detail": "…", "requestId": "…" }
```

## 2. Widget API (`/w`)

| Method & path | Purpose |
|---|---|
| `GET /w/config/:projectKey` | Widget configuration (theme, modes, capture settings, locale strings version, permissions for this visitor) — ETag + `Cache-Control: max-age=60` |
| `POST /w/uploads` | Create an upload: body `{ kind, contentType, bytes, sha256 }` → `{ uploadId, method: 'PUT', url, headers }` (presigned S3 URL, or `/w/uploads/:id/content` for FS driver) |
| `PUT /w/uploads/:id/content` | FS driver upload target (streamed, size-checked, content-type sniffed) |
| `POST /w/feedback` | Create feedback (schema below) → `201 { feedback }`; `200` with the existing record on `clientId` replay |
| `GET /w/feedback` | List pins for `url` / `urlPattern` (if `public_read` or review token) — paginated, light projection |
| `GET /w/feedback/:id` | One item with public thread |
| `POST /w/feedback/:id/comments` | Public reply (guest or identified) |
| `PATCH /w/feedback/:id` | Resolve/reopen — only if project allows visitors to resolve **and** the visitor is the reporter (by `clientId` proof) or holds a review token with that permission |
| `GET /w/assets/:assetId` | Short-lived signed redirect to an asset (or streamed from FS) |

### `POST /w/feedback` body (abridged)
```ts
{
  clientId: string,                 // UUIDv7, idempotency
  kind: 'comment'|'bug'|'idea'|'question',
  title?: string, body: string,     // ≤ 10 000 chars
  priority?: Priority,
  page: { url: string, title?: string, urlPattern?: string },
  anchor?: AnchorBundle,            // required for kind=comment pins; optional for bugs
  pin?: { xPct: number, yPct: number, region?: { wPct: number, hPct: number } },
  environment: Environment,         // browser, os, viewport, dpr, locale, tz, referrer
  metadata?: Record<string, JsonValue>,   // ≤ 16 KB
  reporter?: { name?: string, email?: string, externalId?: string, identityToken?: string },
  diagnostics?: { console?: ConsoleEntry[], network?: NetworkEntry[], errors?: ErrorEntry[] },
  uploads?: { screenshot?: string, annotatedScreenshot?: string, annotationLayer?: string,
              replay?: string, attachments?: string[] },
  roundId?: string,
}
```

Validation limits: total JSON ≤ 1 MB (diagnostics truncated client-side first), screenshot ≤ 8 MB, replay ≤ 10 MB gzip, attachments ≤ 10 MB each, ≤ 5 attachments.

### Rate limits (defaults, configurable)
- `POST /w/feedback`: 10/min per IP per project, 500/hour per project.
- `POST /w/uploads`: 30/min per IP.
- Exceeding returns `429` with `Retry-After`; the widget queues and retries.

## 3. Dashboard API (`/api`) — resource list

Auth via Better Auth routes at `/api/auth/*`.

| Resource | Endpoints |
|---|---|
| Me | `GET /api/me`, `GET /api/me/entitlements`, `PATCH /api/me/preferences` |
| Orgs | `GET/POST /api/orgs`, `GET/PATCH /api/orgs/:id`, members & invitations (Better Auth org plugin) |
| Projects | `GET/POST /api/projects`, `GET/PATCH/DELETE /api/projects/:id`, `POST /api/projects/:id/rotate-key`, `GET /api/projects/:id/snippet` |
| Feedback | `GET /api/feedback` (filters, cursor pagination, sort), `GET/PATCH/DELETE /api/feedback/:id`, `POST /api/feedback/bulk` (status/assign/label/delete), `POST /api/feedback/:id/duplicate-of`, `POST /api/feedback/:id/sync/:integrationId` |
| Comments | `GET/POST /api/feedback/:id/comments`, `PATCH/DELETE /api/comments/:id` |
| Activity | `GET /api/feedback/:id/activity` |
| Labels, rounds, views | CRUD under `/api/projects/:id/labels`, `/rounds`, `/api/views` |
| Pages | `GET /api/projects/:id/pages`, `GET /api/pages/:id` |
| Notifications | `GET /api/notifications`, `POST /api/notifications/read` |
| Integrations | `GET/POST /api/integrations`, `PATCH/DELETE /api/integrations/:id`, `POST /api/integrations/:id/test`, OAuth callbacks |
| Webhooks | CRUD `/api/webhooks`, `GET /api/webhooks/:id/deliveries`, `POST /api/webhook-deliveries/:id/redeliver` |
| API tokens | CRUD `/api/tokens` (secret shown once) |
| Review links | CRUD `/api/projects/:id/review-links` |
| Settings (instance) | `GET/PATCH /api/admin/settings`, `POST /api/admin/settings/test-email` (self-host admins) |
| Licence (ee) | `GET /api/admin/license`, `POST /api/admin/license` (upload) |
| Audit (ee) | `GET /api/audit` (filters, export CSV/JSONL) |
| Billing (Cloud) | `GET /api/billing`, `POST /api/billing/checkout`, `POST /api/billing/portal` |
| Export / GDPR | `POST /api/projects/:id/export`, `POST /api/gdpr/erase` |
| Real time | `GET /api/stream?projectIds=…` (SSE: `feedback.created/updated`, `comment.created`, `presence`) |

## 4. Public REST API (`/api/v1`)

Mirrors the read/write feedback, comments, labels, projects (read) endpoints with token scopes: `feedback:read`, `feedback:write`, `comments:write`, `projects:read`, `webhooks:manage`. Cursor pagination (`?cursor=&limit=` ≤ 100). Idempotency-Key header honoured on POST.

## 5. Outbound webhooks

Events: `feedback.created`, `feedback.updated`, `feedback.status_changed`, `feedback.assigned`, `feedback.deleted`, `comment.created`, `review_round.closed`.

Headers: `Annota-Event`, `Annota-Delivery`, `Annota-Timestamp`, `Annota-Signature: v1=<hex HMAC-SHA256(secret, timestamp + "." + body)>`. Receivers must reject timestamps older than 5 minutes. Payloads are versioned (`"apiVersion": "2026-11-01"`).

Retries: 1 m, 5 m, 30 m, 2 h, 6 h, 12 h (then mark failed, alert admins). Endpoint auto-disabled after 3 days of continuous failure.

## 6. MCP server

Exposed at `/mcp` (Streamable HTTP) and as `npx @annota/mcp` (stdio, reads `ANNOTA_URL` + `ANNOTA_TOKEN`).

| Tool | Description |
|---|---|
| `list_projects` | Projects the token can see |
| `search_feedback` | Filters: project, status, kind, assignee, label, text, page, since; returns compact rows |
| `get_feedback` | Full item: body, thread, anchor (CSS selector + XPath + text), environment, metadata, console/network excerpt, asset URLs (signed, short-lived) |
| `get_reproduction_context` | Ordered steps derived from replay events + failing requests + errors, as Markdown |
| `update_feedback` | Status, priority, assignee, labels |
| `add_comment` | Internal note or public reply |
| `resolve_feedback` | Resolve with a resolution note (e.g. commit SHA / PR URL) |

Resources: `annota://project/{id}/open` (open items digest). Prompts: `triage_inbox`, `fix_feedback` (instructs the agent to locate the element via the selector in the repo, reproduce, fix, and resolve with the PR link).

## 7. Versioning & compatibility

- Widget ↔ server protocol carries `X-Annota-Widget: <semver>`; the server accepts the current and previous major. Old widgets get a soft "update available" log, never a hard failure.
- Public API is date-versioned; breaking changes only in a new `/api/v2`.
