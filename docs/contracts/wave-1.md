# Wave 1 contract — widget ↔ API

Shared by the widget agent (owns `packages/widget`) and the backend agent (owns `packages/api`, `packages/db`,
`packages/core`). Types live in `packages/core` (backend agent writes them first); the widget imports them from
`@pinwren/core`. If you must change this contract, change this file in the same edit and say so in your report.

## 1. Widget config — `GET /w/config`

Response (server fills defaults; never missing keys):

```ts
{
  project: { name: string; publicRead: boolean },
  widget: WidgetConfig,      // zod schema `widgetConfig` in packages/core, with `.default()`s
  capture: CaptureConfig,    // zod schema `captureConfig` in packages/core
}

type WidgetConfig = {
  launcher: {
    position: "bottom-right" | "bottom-left" | "top-right" | "top-left";  // default bottom-right
    offset: { x: number; y: number };                                     // px, default 20/20
    shape: "round" | "pill";                                              // default round
    label: string | null;                                                 // pill text, default "Feedback"
    icon: "pin" | "comment" | "bug";                                      // default pin
    accent: string;                                                       // hex, default "#5b5bd6"
    tooltip: string | null;                                               // default "Give feedback"
    hidden: boolean;                                                      // only open via JS API / shortcut
  };
  modes: { comment: boolean; bug: boolean };                              // both true
  shortcuts: boolean;                                                     // "C" comment, "B" bug, Esc — default true
  rightClickComment: boolean;                                             // F-015, default false
  readOnly: boolean;                                                      // F-017, default false
  visitorsCanResolve: boolean;                                            // default true
  consent: { enabled: boolean; text: string | null; privacyUrl: string | null };  // F-019, default disabled
};

type CaptureConfig = {
  console: "off" | "errors" | "warnings" | "all";    // default "warnings"
  network: "off" | "failures";                       // default "failures"
  screenshotOnComment: boolean;                      // default false (bug reports always offer one)
  maskSelectors: string[];                           // extra selectors to hide in screenshots
};
```

## 2. Create feedback — `POST /w/feedback`

Body: `widgetFeedbackCreate` (existing) plus:

- `anchor.pin` may carry `wPct`/`hPct`: a **region** comment. Semantics: `xPct`,`yPct` = top-left corner of the
  selected region as % of the anchor element's box; `wPct`,`hPct` = region size as % of that box. A plain
  click-pin omits `wPct`/`hPct` and `xPct`,`yPct` is the click point.
- `attachments?: { name: string; contentType: string; dataUrl: string }[]` — max 3, each ≤ 5 MB decoded,
  image/png|jpeg|webp|gif or application/pdf; stored as `feedback_asset` kind `attachment`. (Widget UI for this is
  wave 2; the API ships now.)

Errors: `400 INVALID_SCREENSHOT`, `400 INVALID_ATTACHMENT` (bad type, bytes that don't match the declared type
— magic-byte check —, `contentType` differing from the data URL, > 5 MB; `title` names the attachment), `403 READ_ONLY`
when `widget.readOnly` is on, `429 RATE_LIMITED` (per IP per minute: project setting `widgetRateLimitPerMin`, default
`WIDGET_RATE_LIMIT_PER_MIN`=10).

Response `201`: `{ feedback: { id, number, reporterToken } }`. `reporterToken` is random (32 bytes, base64url),
returned once; the server stores only its SHA-256. Idempotent replay (`200`) returns the same shape **without**
`reporterToken`.

## 3. List pins — `GET /w/feedback?url=<page url>[&include=closed]`

Each item:

```ts
{ id, number, kind, status, priority, title: string | null, body: string /* ≤500 chars */,
  anchor: AnchorBundle | null, createdAt, reporterName: string | null, replyCount: number }
```

Open/in-progress/in-review only unless `include=closed`. Max 100.

## 4. Thread — `GET /w/feedback/:id/comments`, `POST /w/feedback/:id/comments`

GET items: `{ id, body, createdAt, authorName: string | null, team: boolean }` (public comments only).
POST body `{ body, author?: { name?, email? } }` → `201 { comment: { id, body, createdAt, authorName, team: false } }`.
POST shares the report rate limit and returns `403 READ_ONLY` when `widget.readOnly` is on.

## 5. Resolve / reopen from the page — `PATCH /w/feedback/:id`

Body `{ status: "resolved" | "open" }`. Allowed when **either** `widget.visitorsCanResolve` is true (and the project
has `publicRead` on and `widget.readOnly` off — visitors can't act on what they can't see) **or** the request carries
header `x-pinwren-reporter-token` matching that feedback (works regardless of those settings). Writes an `activity`
row (`type: "status_changed"`, `actor_kind: "guest"`, `data: { from, to, via: "reporter" | "visitor" }`).
`403 RESOLVE_NOT_ALLOWED` otherwise. Returns `{ feedback: { id, status } }` (also when the status was already the
requested one — no activity row then). `409 CONFLICT` if the status changed concurrently. CORS allows `PATCH` and
the `x-pinwren-reporter-token` header. `REPORTER_TOKEN_HEADER` is exported from `@pinwren/core`.

## 6. Errors

Problem-details JSON (existing). Widget shows `title` to the user.

## 7. Types exported by `@pinwren/core` (backend, done)

`widgetConfig`, `captureConfig` (Zod, every field defaulted — `widgetConfig.parse({})` is the full default),
`WidgetConfig`, `CaptureConfig`, `WidgetConfigInput`/`CaptureConfigInput` (partial input), `parseWidgetConfig()` /
`parseCaptureConfig()` (lenient: invalid stored fields fall back to defaults, never throw), `mergeConfig()`,
`widgetAttachment`, `ATTACHMENT_CONTENT_TYPES`, `MAX_ATTACHMENTS`, `MAX_ATTACHMENT_BYTES`,
`widgetFeedbackStatusUpdate`, `REPORTER_TOKEN_HEADER`.

## 8. Dashboard API added in wave 1 (for the dashboard agent)

All under `/api`, session cookie, problem-details errors. Request schemas are in `@pinwren/core`.

| Endpoint                                                                     | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET/PATCH /api/projects/:id`                                                | Response `project.widgetConfig` / `captureConfig` are **complete** (defaults filled). PATCH accepts partial `widgetConfig` / `captureConfig` (deep-merged into the stored config, then validated as a whole → `400 INVALID_WIDGET_CONFIG` / `INVALID_CAPTURE_CONFIG` with the failing path in `title`), plus `retentionDays` (1–3650 or null = keep forever), `notifyReporter` (bool), `widgetRateLimitPerMin` (1–1000 or null = instance default). The last three are project columns. |
| `GET /api/feedback/:id`                                                      | Adds `assignees: [{ id, name, email, image }]`; assets carry `bytes`, `name`; comments carry `editedAt`; activity carries `actorKind`, and `assigneeIds_changed` rows add `data.fromUsers` / `data.toUsers` (`[{ id, name }]`). `reporterTokenHash` is never returned.                                                                                                                                                                                                                  |
| `GET /api/feedback`                                                          | Items add `attachmentCount`; `hasScreenshot` counts screenshots only.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `PATCH /api/feedback/:id`                                                    | `assigneeIds` must be org members (`400 INVALID_ASSIGNEE`).                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `PATCH /api/comments/:id`                                                    | `{ body }`, author only (`403`). Sets `editedAt`.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `DELETE /api/comments/:id`                                                   | Author or org owner/admin. `204`; writes a `comment_deleted` activity row.                                                                                                                                                                                                                                                                                                                                                                                                              |
| `GET /api/assets/:id`                                                        | Attachments get `Content-Disposition` (`attachment` for PDFs, `inline` for images).                                                                                                                                                                                                                                                                                                                                                                                                     |
| `GET /api/invitations`                                                       | Pending, unexpired invitations of the active org: `{ invitations: [{ id, email, role, status, expiresAt, createdAt, inviter: { id, name, email } }] }`. Create/cancel/accept through Better Auth (`/api/auth/organization/invite-member`, `cancel-invitation`, `accept-invitation`). The invitation email links to **`/accept-invitation/<id>`** — the dashboard must provide that page (sign in/up, then call `accept-invitation` and `set-active`).                                   |
| `GET /api/notifications[?unread=1&limit=]`                                   | `{ items: [{ id, type, feedbackId, data: { projectId, projectName, number, title, actorName?, status?, commentId? }, readAt, createdAt }], unreadCount }`. Types: `feedback.created`, `feedback.assigned`, `feedback.status_changed`, `comment.created`.                                                                                                                                                                                                                                |
| `POST /api/notifications/read`                                               | `{ ids: [...] }` or `{ all: true }` → `{ updated }`.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `GET /api/notification-preferences`                                          | One row per project: `{ projectId, projectName, newFeedback, assigned, replies, statusChanges, email }` (defaults all `true`).                                                                                                                                                                                                                                                                                                                                                          |
| `PUT /api/notification-preferences`                                          | `{ projectId, ...any of the five booleans }` → `{ preference }`.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `GET/POST /api/webhooks`, `GET/PATCH/DELETE /api/webhooks/:id`               | Org owner/admin only. Create `{ name?, url, kind: generic                                                                                                                                                                                                                                                                                                                                                                                                                               | slack          | discord, events[], projectId?, active? }`→`201 { webhook, secret }`(generic only; **shown once**). Slack/Discord URLs come back masked.`webhook.failingSince` set while failing; auto-disabled (`active: false`) after 3 days. |
| `POST /api/webhooks/:id/rotate-secret`                                       | `{ secret }` once.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `POST /api/webhooks/:id/test`                                                | Sends a `ping` now; `{ delivery }`.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `GET /api/webhooks/:id/deliveries`                                           | `{ deliveries: [{ id, eventId, event, attempt, status: pending                                                                                                                                                                                                                                                                                                                                                                                                                          | success        | retrying                                                                                                                                                                                                                       | failed, responseCode, responseBody, error, durationMs, nextRetryAt, createdAt }] }` — one row per attempt. |
| `POST /api/webhook-deliveries/:id/redeliver`                                 | Re-sends now (same event id); `{ delivery }`.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `GET/POST /api/tokens`, `DELETE /api/tokens/:id`                             | Own tokens. Create `{ name, scopes: (feedback:read                                                                                                                                                                                                                                                                                                                                                                                                                                      | feedback:write | comments:write)[], expiresInDays? }`→`201 { token: { id, name, prefix, scopes, lastUsedAt, expiresAt, createdAt }, secret }` (**shown once**).                                                                                 |
| `GET/PATCH /api/admin/settings/email`, `POST /api/admin/settings/email/test` | Instance admins only (`PINWREN_ADMIN_EMAILS`, else the first user): `{ email: { host, port, user, secure, from, passwordSet, locked: {field: bool}, configured } }`. PATCH fields (`password` write-only; null clears); env-locked fields → `409 SETTING_LOCKED`. Test → `{ sent: true, to }` or `{ sent: false, skipped, reason }` (never an HTTP error).                                                                                                                              |

Public API (`Authorization: Bearer ann_…`): `GET /api/v1/feedback`, `GET/PATCH /api/v1/feedback/:id`,
`POST /api/v1/feedback/:id/comments` — same shapes as the dashboard routes; `401 INVALID_TOKEN`,
`403 INSUFFICIENT_SCOPE`.

Webhook payloads (generic): `{ id, event, apiVersion: "2026-11-01", createdAt, data: { feedback, comment?, changes?, actor } }`,
headers `Pinwren-Event`, `Pinwren-Delivery` (event id, stable across retries), `Pinwren-Timestamp`,
`Pinwren-Signature: v1=<hex HMAC-SHA256(secret, timestamp + "." + body)>`.
