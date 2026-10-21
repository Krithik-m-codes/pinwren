# Changelog

All notable changes to Pinwren are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/) (pre-1.0: minor versions may break).

From the first release on, release-please adds a section per version from the Conventional Commits on
`main`; the widget's own changes are also listed in [`packages/widget/CHANGELOG.md`](packages/widget/CHANGELOG.md)
once it is published.

## [Unreleased]

The first public release, 0.1.0. Pinwren was developed privately as "Annota" and renamed before publishing.

### Added

- **Widget** (`@pinwren/widget`, MIT): one script tag; closed Shadow DOM; core ≈26 KB gzip with the side
  panel, report form, capture engine and each locale loaded on demand.
  - Comments pinned to elements or regions, anchored by CSS selector, XPath, test id, text and geometry;
    comments on selected text with the quote highlighted; threads with team replies; resolve and reopen;
    deep links (`?pinwren=<id>`); a side panel with filters, search and CSV/JSON export.
  - Bug reports with viewport, full-page, element or screen-share capture; an editor with draw, box, arrow,
    text, pixelate, crop, undo and redo; up to three attachments; console and network diagnostics, browser
    environment and page timing; drafts that survive reloads; an offline outbox with retries.
  - Privacy mode (text fields masked in captures, no timing data, coarse user agent, consent notice), built-in
    masks for passwords and card fields, and `data-pinwren-mask`.
  - Launcher options, white-label branding, read-only mode, right-click to comment, 11 languages, and the
    `Pinwren` JS API (`init`, `open`, `close`, `on`, `identify`, `destroy`).
- **Dashboard and API** (AGPL-3.0): Next.js 16 dashboard with the Hono API mounted at `/api` and `/w`.
  - Triage inbox with list, detail and board views, filters, bulk edits with undo, and keyboard shortcuts;
    page review with pins over screenshots; statuses, priorities, assignees, internal and public comments,
    activity timeline.
  - Workspaces, invitations and roles; email and in-app notifications; editable email templates; branding;
    retention policies; instance security settings; update check.
  - Two-way GitHub and GitLab issue sync, signed webhooks (generic, Slack, Discord) with a delivery log,
    scoped API tokens for `/api/v1`, and custom panel actions.
- **Self-hosting**: one Docker image (dashboard, API, widget bundles, migrations) plus Postgres; files on
  disk or S3-compatible storage; `node:cluster` workers; pg-boss background jobs on Postgres.
- **Project tooling**: Prettier and ESLint (typescript-eslint strict type-checked, Next.js, React Compiler
  and accessibility rules) replacing Biome; strict TypeScript with `exactOptionalPropertyTypes` in every
  package; the React Compiler (native Rust implementation) and typed routes in the dashboard; CI, CodeQL,
  OpenSSF Scorecard, dependency review, release-please, and multi-arch Docker images on GHCR with SBOM and
  provenance.

[Unreleased]: https://github.com/Krithik-m-codes/pinwren/commits/main
