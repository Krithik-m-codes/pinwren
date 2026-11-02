# v2 dashboards — what Pinwren takes from the DocuSigner v2 UI

Reference: `docusigner_frontend`, branch `v2-ui` (`src/components/instances/dashboard/builder/*`,
`(dashboard)/layout/command*`, `(dashboard)/period-selector`, `(dashboard)/report/*`). Read only.

## How the DocuSigner dashboard works

- `DashboardShell` / `DashboardHeader`: a named dashboard per page, switcher with favourites and a default,
  "system" board that forks on edit, create/rename/duplicate/delete, share.
- `CustomGrid` + `CardBody` + `catalog`: a 12-column grid of cards (`s/m/l/f` sizes), 13 card types (KPI, bar,
  hbar, line, area, pie, donut, funnel, gauge, table, leaderboard, activity, note), each card with its own
  measure, grouping, date range, comparison, filters, palette.
- `CardEditor`: per-card editor with live preview; `FilterBar`: dashboard-wide chips.
- `store.ts`: all boards in localStorage per page, normalised on read.
- Shell: command palette (`command.tsx`), period selector, notification bell, menu switcher.

## Mapping

| DocuSigner pattern                                          | Pinwren                                                                                         |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 12-column card grid, sizes, move earlier/later              | **Built.** 12 columns, widths 3/4/6/8/12, heights 1-3 rows, drag and drop plus buttons.         |
| Card catalogue, "Add component"                             | **Built.** Sheet listing widgets by group (numbers, charts, lists) that fit the screen.         |
| Edit mode, remove, resize, reset                            | **Built.** Customise / Done, per-widget controls, Reset to default.                             |
| localStorage persistence, normalise on read                 | **Built.** Per user and screen; role defaults; drops unknown widgets (ADR 0024).                |
| KPI tile with comparison to previous period                 | **Built.** "New reports" shows the delta against the previous range.                            |
| Charts (line/area, donut, bars)                             | **Built** as dependency-free SVG: trend, status donut, bars by type/priority/project.           |
| Table / leaderboard / activity cards                        | **Built.** Projects table, recent activity, "needs attention" list.                             |
| Period selector                                             | **Built** as a range menu (7/14/30/90 days) stored with the layout.                             |
| Command palette                                             | Already present; added Dashboard and "Customise dashboard".                                     |
| Overview on sub-pages                                       | **Built.** Collapsible strip on inbox (collapsed by default), projects, project, notifications. |
| Multiple named dashboards, favourites, share, "system" fork | Not built: one layout per screen is enough for triage. Revisit with shared dashboards.          |
| Per-card editor (measure, group, filters, palette, goal)    | Not built: widgets are fixed; the inbox filters already cover ad-hoc slicing.                   |
| Funnel, gauge, pie, text note                               | Not built: no data in Pinwren needs them yet.                                                   |
| Dashboard-wide filter bar                                   | Not built: the strip follows the page (project) it sits on; the range is the one filter.        |
| Server-side persistence                                     | Deferred: per-browser now; `user_preference` column later (storage.ts is the seam).             |

## Data

`GET /api/stats` (tenant-scoped, one request per screen). See ADR 0024.

## Screens

- `/dashboard` — the home dashboard, role defaults (Admin: unassigned, projects table; others: my work, needs
  attention). New first entry in the sidebar; "/" still lands on the inbox so existing flows are unchanged.
- Inbox, projects, project, notifications — the same component as a compact strip (`scope`), one row of tiles.
- Not done: settings overview (settings are configuration; no data of its own to chart yet).
