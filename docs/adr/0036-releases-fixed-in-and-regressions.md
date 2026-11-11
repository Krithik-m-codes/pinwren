# ADR 0036 — Releases, "fixed in" and regression detection

**Status:** accepted

## Context

Sentry and Luciq track which release a problem was fixed in and warn when it comes back. Pinwren resolved items with
no memory of the version that fixed them, so a bug that returned two releases later looked like any new report. We want
projects to record their releases (by hand or from CI), say which release fixed an item (to the team, the reporter and
the client), and flag a new report that looks like a resolved one, without weakening the Cloud tenant boundary
(`docs/security/cloud-tenant-isolation.md`) or slowing ingest.

## Decision

1. **Storage (migration `0016`).** One tenant table, `project_release` (direct `org_id`, the `pinwren_tenant` policy,
   composite `(id, org_id)` unique key and a composite foreign key to `project`; unique per project on `lower(version)`).
   `feedback` gains `fixed_in_release_id` and `regression_of_id` (each with a single-column foreign key that sets null on
   delete **and** a composite `(…, org_id)` foreign key, like `duplicate_of_id`), `fixed_in_next_release`,
   `regression_confidence`, `regression_signals`, and the comparison columns `sig_path`, `sig_anchor`, `sig_errors`
   (a GIN index on the last). `project` gains `detect_regressions` (default on) and `auto_reopen_regressions` (default off).
2. **Releases are recorded, never inferred.** A person or CI posts them (`POST /api/projects/:id/releases` for the
   dashboard, `POST /api/v1/projects/:id/releases` with the new `releases:write` token scope). The same version again
   updates the row, so a CI re-run is safe. The widget's `data-release` / `Pinwren.setMetadata({ release })` is stored in
   the report's `metadata` and **does not create a release**: the public widget key must not be able to write rows a team
   then sees. Only a short, space-free label is read back (`reportedRelease` in `@pinwren/core`).
3. **"Fixed in" belongs to the resolution.** Only a `resolved` item can name a release of its own project, or promise
   `fixedInNextRelease`. Leaving `resolved` by any path (dashboard, widget, rule, tracker) clears both. The next release
   recorded after a promise adopts the promised items and writes a timeline row; nothing is emailed at that moment.
4. **Regression detection is a flag, computed after commit.** The dispatcher calls `detectRegression` for a new bug
   report (inside a savepoint, errors logged, never failing the job). It stores the report's signature, then compares it
   with the project's resolved bugs on two signals: **the same element on the same page** (path + `pinwrenAnchor` /
   `testId` / `id` / CSS selector) or **a shared console error** (first line normalised for URLs, positions, ids and
   numbers, then hashed; noise such as `Script error.` is ignored). Resolved bugs that predate the columns are signed on
   demand, 100 at a time. The AI duplicate check feeds the same flag when its candidate is a resolved bug.
5. **The release moves the confidence, never creates the flag.** Score: error 50, element 40, both +10, a report from the
   fixing release or later +20, from an earlier one −40; flagged from 40, "likely" from 70. Releases are ordered as
   dotted versions when both parse, else by deploy time; unknown stays neutral.
6. **Flagging changes little by default.** It sets the flag and writes a timeline row on both items, emits
   `feedback.regression_detected` (webhooks, the bell and a team email through the existing channels, and the automation
   event `regression_detected`). Reopening the original is a per-project opt-in; it is attributed to "Pinwren"
   (`activity.actor_kind = 'system'`) and, like a rule's change, does not push a reopen to a linked tracker issue.
7. **Surfaces.** Project settings › Releases; the "Fixed in" picker beside the status; badges and a banner on the item;
   an inbox filter and row tag; dashboard widgets "Regressions" and "Fixed per release" (`dashboard-stats.ts`,
   `services/stats.ts`, opt-in); "Fixed in v1.4" on the guest portal, share links and the reporter's status email.
   The widget reads `data-release` in the report chunk: the core script is at its size budget.

## Consequences

- Six new routes (four on the dashboard API, two on `/api/v1`) are `tenant` routes with a `foreign tenant` case each, and
  workspace B's release is part of the isolation fixture, so every foreign call proves it changes nothing.
- A report without a recorded release still works; the comparison simply has no release signal.
- Detection looks at resolved bugs only, so a comment, an idea or a "won't fix" never becomes an "original".
- Existing custom reporter-status email templates do not show "Fixed in" until they add `{{fixedIn}}`.
- Comments filed through the widget carry `metadata.release` only when the host calls `setMetadata`; `data-release` is
  read when a bug report is built.
