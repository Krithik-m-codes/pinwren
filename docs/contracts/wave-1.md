# Wave 1 contract — widget ↔ API

Shared by the widget agent (owns `packages/widget`) and the backend agent (owns `packages/api`, `packages/db`,
`packages/core`). Types live in `packages/core` (backend agent writes them first); the widget imports them from
`@annota/core`. If you must change this contract, change this file in the same edit and say so in your report.

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

## 5. Resolve / reopen from the page — `PATCH /w/feedback/:id`

Body `{ status: "resolved" | "open" }`. Allowed when **either** `widget.visitorsCanResolve` is true **or** the
request carries header `x-annota-reporter-token` matching that feedback. Writes an `activity` row
(`actor_kind: "guest"`). `403 RESOLVE_NOT_ALLOWED` otherwise. Returns `{ feedback: { id, status } }`.

## 6. Errors

Problem-details JSON (existing). Widget shows `title` to the user.
