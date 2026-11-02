# ADR 0024 — Customisable dashboards (home page and overview strips)

**Status:** accepted

The dashboard grew a home page (`/dashboard`) and a collapsible overview strip on the inbox, projects, a project
and notifications. The pattern comes from the DocuSigner v2 dashboard builder (see
`docs/superpowers/specs/2026-11-02-v2-dashboards-design.md`), cut down to what a triage tool needs.

- **One aggregate endpoint.** `GET /api/stats?days=&projectId=` returns every number a widget shows (totals, by
  status/kind/priority/project, a zero-filled daily series, recent activity). One request per screen feeds all
  widgets, so moving, resizing or adding a widget never refetches. It reads only the caller's organisation
  (`orgId` on every query; a foreign `projectId` matches nothing) and is inventoried as a `tenant` route. The
  Zod shapes live in `@pinwren/core` (`dashboard-stats.ts`). The stream invalidates the `Stats` tag.
- **A catalogue, not a builder.** Widgets are fixed components named in `lib/dashboard/catalog.ts` (KPI tiles,
  charts, lists). A layout is an ordered list of `{ id, w, h }` on a 12-column grid, one instance per widget.
  Unknown or misplaced entries are dropped when a stored layout is read, so releases can add and remove widgets.
- **Per-browser persistence.** A layout is stored in localStorage per user and screen, like the inbox view
  settings. No table or migration. A layout equal to the role default is not stored, so later changes to the
  defaults reach people who never customised. Moving it to `user_preference` later only changes
  `lib/dashboard/storage.ts`.
- **Role defaults.** Admins start with the workspace view (unassigned, projects); editors and viewers with their
  own work. Customising is always allowed, including for Viewers: it changes only their own browser.
- **No chart library.** Three SVG shapes (area, donut, bars) cover every widget, with text equivalents.
