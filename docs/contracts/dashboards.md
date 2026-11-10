# Dashboards API contract

Design: [ADR 0029](../adr/0029-server-dashboards-named-shared.md). All routes are dashboard-session routes under
`/api` (not `/api/v1`), mounted behind the session and viewer guards. Errors are problem details (`code`, `title`).

## Dashboards

A dashboard is `{ id, scope, name, layout, shared, defaultRoles, ownerId, ownerName, mine, createdAt, updatedAt }`.
`scope` is `home`, `inbox`, `projects`, `project` or `notifications`. `layout` is `{ v: 1, days: 7|14|30|90,
slots: [{ id, w, h }] }`: `id` is `group.name` (for example `kpi.active`), `w` one of 3, 4, 6, 8, 12, `h` one of 1, 2, 3.
Malformed, repeated or beyond-40 slots are dropped before storing; a wrong envelope or range is a 400.

| Route                                | Who                                 | Notes                                                                                                       |
| ------------------------------------ | ----------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `GET /api/dashboards?scope=`         | any member                          | Own dashboards first, then the workspace's shared ones.                                                     |
| `POST /api/dashboards`               | any member; `shared` needs an Admin | `{ scope, name, layout, shared?, defaultRoles? }` → 201. 409 `DASHBOARD_EXISTS` (name) / `DASHBOARD_LIMIT`. |
| `PATCH /api/dashboards/:id`          | owner; Admin for a shared one       | `{ name?, layout?, shared?, defaultRoles? }`. Unsharing clears the role defaults. 404 when not visible.     |
| `DELETE /api/dashboards/:id`         | owner; Admin for a shared one       | 204.                                                                                                        |
| `POST /api/dashboards/:id/duplicate` | any member who can see it           | `{ name? }` → 201, a personal copy (`<name> copy`, `copy 2`, …).                                            |

`defaultRoles` (`admin`, `editor`, `viewer`) may be set on shared dashboards only; a role is held by at most one
shared dashboard per scope (setting it moves it).

## Per person

| Route                                     | Notes                                                                                                                                                                                                                                                             |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET/PATCH /api/me/workspace-preferences` | `{ preferences: { dashboardDefaults: { <scope>: id }, pinnedProjectIds: [] } }`. PATCH takes either field; `null` clears a default. A default must name a visible dashboard of that scope (404 / 400), pins must be live projects of the workspace (404, max 12). |
| `GET/PATCH /api/me/ui-state`              | `{ uiState: { startPage: inbox\|dashboard\|my-work\|null, nudges: { firstSeen, dismissedUpdate, supportSnoozedUntil, supportOptOut } } }`. PATCH merges the keys it names.                                                                                        |

## Stats filters

`GET /api/stats` and `GET /api/v1/stats` accept `projectId`, `labelId`, `assigneeId` (`me`, `none` or a member id),
`days` and an explicit `from` / `to` (`YYYY-MM-DD`, UTC, inclusive, ≤ 366 days; `to` needs `from`). The response's `days`
is the length of the window; `series` ends on `to`.
