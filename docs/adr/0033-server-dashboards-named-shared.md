# ADR 0033 — Server-side dashboards: named, shared, filterable

**Status:** accepted. Supersedes the "per-browser persistence" part of ADR 0024 and the "dismissals are per
browser" part of ADR 0025.

ADR 0024 kept dashboard layouts in localStorage and ADR 0025 did the same for the update strip and support card;
the start page was a cookie. All three were listed as follow-ups: they do not follow a person to another browser,
a layout cannot be shared, and there was one dashboard per screen. This ADR moves them to the database and adds
named dashboards, dashboards shared with the workspace, role defaults and a dashboard-wide filter bar.

## Data

Migration `0017` adds two tables and one column. Both tables are **direct-ownership tenant tables**: `org_id`,
the `pinwren_tenant` row policy, listed in `tenant-inventory.ts`, hashed by the isolation snapshot.

- `dashboard` — `id`, `org_id`, `owner_id`, `scope` (`home`, `inbox`, `projects`, `project`, `notifications`),
  `name`, `layout` (jsonb, the same `{ v: 1, slots, days }` as before), `shared`, `default_roles`. Names are unique
  per workspace, owner and screen, ignoring case. A check constraint ties `default_roles` to `shared`.
- `workspace_preference` — `(org_id, user_id)`: `dashboard_defaults` (`{ scope: dashboard id }`) and
  `pinned_project_ids`. A person's choices are per workspace because ids are workspace data: a member of two
  workspaces keeps two sets, and neither can name the other's rows.
- `user_preference.ui_state` (jsonb) — the start page and the nudge dismissals. `user_preference` is an
  **identity** table (one row per account, no `org_id`; it already holds the language and the digest settings),
  so account-wide interface state belongs there and not in an org-scoped table.

There is deliberately no composite foreign key from `workspace_preference` to `dashboard`: a default naming a
dashboard that was deleted or unshared is ignored when read (and not returned), which is simpler than cascading
and cannot block a delete.

## Rules

- **Visibility.** A dashboard is visible to its owner and, when `shared`, to the workspace. Everything else is a 404. Only the owner may change or delete a personal dashboard; an Admin may also change or delete a shared one.
- **Publishing is an Admin act.** `shared` and `default_roles` need an owner or admin role; viewers keep personal
  dashboards (the route is on the viewer allow-list) but cannot publish. Others get read-only access and
  `POST /api/dashboards/:id/duplicate` ("Duplicate to my dashboards") to make an editable copy.
- **Role defaults replace the built-in ones.** A shared dashboard may be the starting point for `admin`,
  `editor` and/or `viewer`. A role has at most one such dashboard per screen: giving it to one takes it from the
  others. The order that decides what opens is: the `?dash=` link, the person's chosen default, their first own
  dashboard, the role's published default, the built-in layout (`resolveActive`, unit-tested). Like before, people
  who never saved a layout keep following the defaults.
- **Validation is on the server** (`dashboardLayout` in `@pinwren/core`): malformed, repeated or over-cap slots
  (40) are dropped, sizes and range must be on the grid, names are 1–60 characters, 25 dashboards per person and
  screen, 25 shared per workspace and screen, 12 pinned projects. The widget catalogue stays in the dashboard
  app because it carries translation keys, so the server accepts any well-formed `group.name` id and the app drops
  ids it does not know when it reads a layout. That keeps a rollback or a newer client from destroying a stored
  layout, and a retired widget disappears on its own.
- **Offline and migration.** Edits go straight to the server (optimistically). The last layout shown is cached in
  localStorage and used while the list has not loaded or the server cannot be reached; the old per-browser layout
  is imported once as "My dashboard" (when the account has none) and then removed. Whether a strip is folded stays
  a per-device choice.
- **Start page and nudges** use `/api/me/ui-state`. `/` still redirects from a cookie (it must answer before
  anything loads); the cookie is kept equal to the account's choice by `UiStateSync`, and a browser without one asks
  the account on the server. A choice made on a device before this change is pushed up to the account. The
  nudge timing rules of ADR 0025 are unchanged; "days of use" now counts from the first visit on the account.

## Filters

`GET /api/stats` (and `/api/v1/stats`) accept `labelId`, `assigneeId` (`me`, `none` or a member id) and an
explicit `from`/`to` (UTC dates, inclusive, at most 366 days) next to `projectId` and `days`. The label and assignee
filters apply to every item query (totals, breakdowns, series, pages, environments, timing, reporters, the project
list and the activity feed); review rounds follow only the project. All SQL still names `org_id`, so a foreign
project or label matches nothing. The home dashboard keeps the filters and the open dashboard in the URL
(`?project=&label=&assignee=&from=&to=&dash=`) so a view can be linked; the overview strips have no filter bar.

## Other changes

- A 401 from the API on a signed-in screen shows "Your session expired" once and goes to
  `/sign-in?next=<this page>`, so the person comes back to the same dashboard and filters.
- Projects can be pinned (per person and workspace) and appear first in the sidebar.

## Not changed

No `/api/v1` routes were added: dashboards are an interface feature, so the routes are session-only and
inventoried as tenant (or identity) routes with isolation cases. The SDK and the MCP `get_stats` tool gain the new
filters. Funnel and gauge charts and a per-card editor are still not built.
