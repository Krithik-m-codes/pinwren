# ADR 0025 — Edition badge, update strip and support card

**Status:** accepted. Dismissals (per browser) are superseded by [ADR 0037](0037-server-dashboards-named-shared.md).

The dashboard shows which edition runs, tells instance admins when a release is out, and now and then asks them
to star or sponsor the project.

- **Edition is derived, not typed.** The pill next to the logo reads `edition` from `GET /api/me/entitlements`
  (`community`, `enterprise`, `cloud`), which the server already derives from `PINWREN_MODE` and the licence.
  Labels live in the catalogue (`edition.*`). Cloud shows no pill.
- **Update check is the existing one.** The daily `update.check` job (ADR 0016) stays the only outbound call: it
  reads `releases/latest` of `PINWREN_UPDATE_REPO`, sends no instance or user data, records errors silently
  (offline and air-gapped installs just keep the last result) and is off with `PINWREN_UPDATE_CHECK=false` or
  while any project uses privacy mode. A daily cadence is well under GitHub's 60 requests/hour unauthenticated
  limit, so it was not made hourly. `GET /api/me` returns `update` for instance admins only.
- **One operator switch.** `PINWREN_NUDGES=false` makes `/api/me` return `nudges: false` and no `update`, which
  hides the update strip, the sidebar update link and the support card. The edition pill stays. In
  `PINWREN_MODE=cloud` the answer is always false. No new route, so the tenant-route inventory is unchanged.
- **Support card rules.** Instance admins on a Community install only, after 14 days of use, never while snoozed
  (30 days after dismissing, 90 after clicking Star or Sponsor), never after "Don't ask again". It is a thin strip
  in the page flow, never a modal.
- **Dismissals are per browser.** State is one localStorage entry per user (`pinwren.nudges.v1.<userId>`), the
  same choice as dashboard layouts (ADR 0024) and the setup checklist: no table or migration for a courtesy
  prompt. Cost: a new browser asks again, and "days of use" counts from the first visit in that browser. Moving
  it to `user_preference` later only changes `lib/nudges/storage.ts`. Update dismissal is per release tag, so
  the next release shows the strip again.
