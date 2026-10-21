# Wave 3 contract — parity gaps

Shared by the **admin agent** (owns `packages/core`, `packages/db`, `packages/api`, `apps/web`) and the **widget agent**
(owns `packages/widget`). Builds on `wave-1.md`. Change this file in the same edit if you must change the contract.

## 1. Panel actions (F-016)

`WidgetConfig.panelActions` (new, default `[]`, max 5):

```ts
type PanelAction = {
  id: string;                       // stable slug, [a-z0-9-]{1,32}
  label: string;                    // ≤ 40 chars
  kind: "link" | "webhook";
  url: string;                      // https?:// only. For "link": may contain {id} {number} {url} {projectSlug}
                                    // placeholders, URL-encoded on substitution. For "webhook": a fixed URL.
  icon: "link" | "ticket" | "bot" | "external" | null;   // default null
  visibleTo: "everyone" | "team";   // "team" = dashboard only; widget never renders team actions
};
```

- **link** — the widget (thread card) and the dashboard (item detail) open the substituted URL in a new tab
  (`rel="noopener noreferrer"`).
- **webhook** — dashboard only in this wave (`visibleTo` forced to `"team"` by the server for webhook kind).
  `POST /api/feedback/:id/actions/:actionId` → server POSTs the feedback JSON (same payload as the
  `feedback.updated` webhook) signed with the project's action secret (`Annota-Signature: v1=…`, as in wave 1),
  10 s timeout, and returns `{ ok: boolean, status: number, message: string | null, error: string | null }` where
  `message` is the receiver's JSON `{ "message": "…" }` if present (≤ 200 chars, shown as a toast) and `error`
  says why a run failed (`HTTP 500`, `timed out after 10 s`; `status` is 0 when the receiver was unreachable).
  Logged in `activity` (`type: "action_run"`). Payload envelope: `{ id, event: "action.run", apiVersion, createdAt,
  data: { feedback, action: { id, label }, actor } }`. Secret: `GET /api/projects/:id/action-secret` (org admins,
  created on first use), `POST /api/projects/:id/action-secret/rotate`.
- **`/w/config` only carries `kind: "link"`, `visibleTo: "everyone"` actions** (added in wave 3, admin side): team
  links and webhook URLs never reach the page. `substituteActionUrl(template, { id, number, url, projectSlug })` is
  exported from `@annota/core` for the widget; `GET /w/config` returns `project: { name, slug, publicRead }` so the
  widget can fill `{projectSlug}`. `GET /api/feedback/:id` returns all actions as `panelActions` plus
  `feedback.projectSlug`.

## 2. Branding / white-label (F-094)

`GET /w/config` gains `branding: { hidePoweredBy: boolean; dialogAccent: string | null; logoUrl: string | null }`
(project-level; defaults `false`, `null`, `null`; stored in `project.widget_branding`, edited with
`PATCH /api/projects/:id { widgetBranding }`, schema `widgetBranding` / `parseWidgetBranding` in `@annota/core`). The widget hides "Powered by Annota" when `hidePoweredBy`, uses
`dialogAccent` for primary buttons in cards/modals when set, and may show `logoUrl` (an absolute URL: https, or this instance's public
`/api/brand-assets/<id>` — **not** `/api/assets/…`, which needs a session)
in the report modal header. Org-level branding for the dashboard and emails (name, logo, accent) lives under
`/api/branding` and is the admin agent's concern only.

## 3. Privacy mode (F-021)

`WidgetConfig.privacyMode: boolean` (default `false`). When true the server also forces `consent.enabled = true`
and `capture.console` to `"errors"` at most, and the widget must: mask **all** text inputs and textareas in
screenshots (draw solid blocks — see §4), skip `metadata.performance`, and not send `navigator.userAgent` beyond
browser/OS family. The server truncates stored IPs and disables outbound update checks/telemetry.
Server side (built): `/w/config` already returns the forced values (`consent.enabled: true`, `capture.console` ≤
`"errors"`), and ingest re-applies the rules for older widgets (drops non-error console entries and
`metadata.performance`, reduces `environment.userAgent` to `"<browser> on <os>"` families).

## 4. Masking renders as solid blocks

Masked elements (built-ins, `data-annota-mask`, `capture.maskSelectors`, privacy mode inputs) must appear in
screenshots as solid neutral blocks of the element's size, not blank space. `[data-annota-ignore]` stays removed.

## 5. Export (F-018)

Widget panel button "Export": downloads the visible comments of the current page (or all pages the visitor can
read, if the panel is in "all pages" mode) as CSV or JSON, built **client-side** from `GET /w/feedback` data
(no new endpoint). Columns: number, kind, status, title, body, author, created, page URL, deep link
(`<page url>?annota=<id>`).
