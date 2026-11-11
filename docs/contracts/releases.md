# Releases, "fixed in" and regressions: API contract

Design: `docs/adr/0029-releases-fixed-in-and-regressions.md`. Schemas: `packages/core/src/releases.ts` (releases,
version ordering, regression signals and scoring), `schemas.ts` (`feedbackUpdate`, `feedbackListQuery`,
`projectUpdate`, the new webhook event and token scope), `api-types.ts` and `dashboard-stats.ts`.

All six routes are `tenant` routes with a `finite` database lifetime in `tenant-route-inventory.json`, each with a
`foreign tenant` case in `cloud-routes-db.test.ts` (workspace B's project or release answers 404 and changes no row).

## Releases

| Method and path                      | Auth                       | Body                                                  | Answer                                       |
| ------------------------------------ | -------------------------- | ----------------------------------------------------- | -------------------------------------------- |
| `GET /api/projects/:id/releases`     | session, any role          |                                                       | `{ releases: Release[] }`, newest deploy     |
| `POST /api/projects/:id/releases`    | session, `projects.manage` | `ReleaseCreate`                                       | `201` or `200 { release, created, adopted }` |
| `PATCH /api/releases/:id`            | session, `projects.manage` | `{ commit?, deployedAt?, notes? }` (version is fixed) | `{ release }`                                |
| `DELETE /api/releases/:id`           | session, `projects.manage` |                                                       | `204`; items fixed in it lose the link       |
| `GET /api/v1/projects/:id/releases`  | token, `feedback:read`     |                                                       | `{ releases: Release[] }`                    |
| `POST /api/v1/projects/:id/releases` | token, `releases:write`    | `ReleaseCreate`                                       | `201` or `200 { release, created, adopted }` |

```ts
type ReleaseCreate = {
  version: string; // 1..100 chars of letters, digits and . - _ + / @ ~ (no spaces); unique per project, any case
  commit?: string | null; // the SHA or ref, up to 64 chars
  deployedAt?: string | null; // ISO 8601 with offset; omitted = now
  notes?: string | null; // up to 5000 chars
};
type Release = {
  id: string;
  projectId: string;
  version: string;
  commit: string | null;
  notes: string | null;
  deployedAt: string;
  createdAt: string;
  fixedCount: number; // live items fixed in it
  regressionCount: number; // live regressions whose `metadata.release` is this version
};
```

Posting a version that exists updates only the fields the request names and answers `200 { created: false }`, so a CI
job can run twice. A new version answers `201` and `adopted` counts the items that were resolved as "fixed in the next
release" and now name this release. A viewer's token is refused (`403 READ_ONLY_ROLE`), a token without
`releases:write` gets `403 INSUFFICIENT_SCOPE`, a project of another workspace `404`, more than 1000 releases in one
project `409 RELEASE_LIMIT`.

## Fixed in

`PATCH /api/feedback/:id` (and `/api/v1/feedback/:id`) accepts two more fields:

| Field                | Meaning                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------- |
| `fixedInReleaseId`   | A release **of the item's project**; `null` clears. `400 INVALID_RELEASE` for any other id. |
| `fixedInNextRelease` | `true` promises the fix for the next recorded release; `false` clears the promise.          |

Both need the item to be `resolved` now or in the same request (`400 FIXED_IN_NEEDS_RESOLVED`); naming a release and
`fixedInNextRelease: true` together is `400 INVALID_FIXED_IN`. Any status other than `resolved` clears both. The change
is one timeline row (`fixedIn_changed`: `{ from: { version, next }, to: { version, next } }`).

`GET /api/feedback` and `/api/v1/feedback` take `regression=true|false` and `fixedInReleaseId=<uuid>`. List rows carry
`release`, `fixedInReleaseId`, `fixedInVersion`, `fixedInNextRelease`, `regressionOfId`, `regressionOfNumber` and
`regressionConfidence`. The item detail adds `feedback.fixedInRelease`, `feedback.release`, `feedback.regressionOf`
(`{ id, number, title, status, signals, score }`) and `regressions` (newer reports flagged against it).

Public surfaces show only the version: the guest portal (`fixedInVersion`, `fixedInNextRelease`), share links (report
and round items) and the reporter status email (`{{fixedIn}}`: "Fixed in v1.4." or "The fix will ship in the next
release."). Webhook payloads carry `release`, `fixedInRelease`, `fixedInNextRelease` and `regressionOf` on `feedback`.

## Regressions

A new `bug` report is compared with the project's resolved bugs after it is saved (ADR 0029 §4–5). `PATCH
/api/projects/:id` takes `detectRegressions` (default `true`) and `autoReopenRegressions` (default `false`).

A flag sets `regressionOfId`, `regressionConfidence` (`possible` or `likely`) and `regressionSignals`, writes
`regression_detected` on the report and `regression_reported` on the original, and emits the domain event
`feedback.regression_detected` (subscribable as a webhook event and as the notification type of the same name; the
automation event is `regression_detected`). With `autoReopenRegressions` the original is also set to `open`
(`status_changed` with `via: "regression"`, actor "Pinwren") and loses its fix.

## Dashboard statistics

`GET /api/stats` (and `/api/v1/stats`) gain `regressions: { total, open, items[] }` and `releases[]`
(`{ id, version, projectId, projectName, deployedAt, fixed, regressions }`, newest eight). Both are org-scoped in
`services/stats.ts`; a `projectId` of another workspace matches nothing.

## Widget

`data-release="1.4.2"` on the script tag sends `metadata.release` with **bug reports**. `Pinwren.setMetadata({ release })`
does the same for reports and comments and wins over the attribute. The server reads it back only when it is a short
label without spaces (`reportedRelease`).
