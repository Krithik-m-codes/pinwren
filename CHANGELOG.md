# Changelog

All notable changes to Pinwren are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/) (pre-1.0: minor versions may break).

From the first release on, release-please adds a section per version from the Conventional Commits on
`main`; the widget's own changes are also listed in [`packages/widget/CHANGELOG.md`](packages/widget/CHANGELOG.md)
once it is published.

## [0.3.0](https://github.com/Krithik-m-codes/pinwren/compare/v0.2.0...v0.3.0) (2026-10-31)


### Features

* add cloud billing with Dodo Payments in test mode ([#28](https://github.com/Krithik-m-codes/pinwren/issues/28)) ([7e013ea](https://github.com/Krithik-m-codes/pinwren/commit/7e013ea5a4945c4b4d03013d1d23c0037e0beafb))
* add launcher theme and favicon branding ([#21](https://github.com/Krithik-m-codes/pinwren/issues/21)) ([9979e69](https://github.com/Krithik-m-codes/pinwren/commit/9979e69afdd7c5a55a5dcfd023b10fdd0e6ca0ec))
* enforce cloud tenant isolation ([#27](https://github.com/Krithik-m-codes/pinwren/issues/27)) ([793a472](https://github.com/Krithik-m-codes/pinwren/commit/793a4728c5e35bbb6fca450b65dfe2251201cfb5))
* **guest:** add capability-based feedback portal ([#19](https://github.com/Krithik-m-codes/pinwren/issues/19)) ([4291864](https://github.com/Krithik-m-codes/pinwren/commit/4291864ef208ef4dd7a443464d91fcec6e6e81c4))
* **web:** dashboard translation system, language preference and picker ([13a448f](https://github.com/Krithik-m-codes/pinwren/commit/13a448fb0c9e03ae32b84452dcb2b82c86cec933))
* **web:** translate the dashboard into ten more languages ([530a09d](https://github.com/Krithik-m-codes/pinwren/commit/530a09d1c3a44fdd00b7a1c18208f4cd24f3deb3))
* **www:** add the Product Hunt badge to the site footer ([a76b992](https://github.com/Krithik-m-codes/pinwren/commit/a76b992d077f398f9ec5a9d39e40c86c70356953))
* **www:** add the Tool Index badge to the site footer ([0908d06](https://github.com/Krithik-m-codes/pinwren/commit/0908d0654ef8864b18f410df5d515609c3f55689))


### Bug Fixes

* **ci:** isolate the release feed and fresh-install assertions ([5f5bb7b](https://github.com/Krithik-m-codes/pinwren/commit/5f5bb7b2c96edd2f2ed921dbd48b52bc3cb9ba43))
* harden release readiness and repair onboarding ([f6c091e](https://github.com/Krithik-m-codes/pinwren/commit/f6c091e232d5624eb440ef6bcee5d31d38e8088b)), closes [#16](https://github.com/Krithik-m-codes/pinwren/issues/16)

## [0.2.0](https://github.com/Krithik-m-codes/pinwren/compare/v0.1.0...v0.2.0) (2026-10-26)


### Features

* **widget:** screenshot quality setting and a "Reduce capture quality" switch ([ca31591](https://github.com/Krithik-m-codes/pinwren/commit/ca315911a06644b01cd3363488d90aff169c3a6e))

## 0.1.0 (2026-10-26)


### Features

* **ai:** document AI triage, forward its settings, fix what the model is shown ([5cb16c4](https://github.com/Krithik-m-codes/pinwren/commit/5cb16c4155e452e0af4a876b2c385afab2df435b))
* **ai:** triage and enrichment implementation ([#13](https://github.com/Krithik-m-codes/pinwren/issues/13)) ([6f1b4fb](https://github.com/Krithik-m-codes/pinwren/commit/6f1b4fb161cc6892922c8280c3c80cc9c83cdfc8))
* **api:** Hono API with Better Auth, dashboard routes and public widget routes ([4ecf132](https://github.com/Krithik-m-codes/pinwren/commit/4ecf1320b8683c43f5a8a89658816473d98d6cad))
* **api:** wave 4 — realtime, rounds, views, replay, identity, viewer role, licences, SDK/MCP/CLI ([64f16fa](https://github.com/Krithik-m-codes/pinwren/commit/64f16fa0bafeec111a0d4a0d93479e85e04f4d41))
* **api:** wave-1 backend — widget contract, email, notifications, webhooks, API tokens, S3 ([308a3c4](https://github.com/Krithik-m-codes/pinwren/commit/308a3c48800c4db226ec5aaa99aa852b1611d359))
* **brand:** add the Pinwren logo, icons, social preview and brand guide ([9c34f11](https://github.com/Krithik-m-codes/pinwren/commit/9c34f112f0ce6f839dacf40fdf3c78f5a0668af2))
* complete v1 — BugPin admin model, SitePing widget UX, email and notifications ([b2016b7](https://github.com/Krithik-m-codes/pinwren/commit/b2016b71d09a8b54dcb4c3d0c11902cc93f5789c))
* **core,db:** shared schemas, origin matching, Postgres schema and migrations ([fb37415](https://github.com/Krithik-m-codes/pinwren/commit/fb37415f9ac8bfe2d68dd680cc0151f4eb599771))
* **docker:** self-host image and compose; smoke test and demo site ([08bacdc](https://github.com/Krithik-m-codes/pinwren/commit/08bacdc94eddfacb039d85afe914be05b6232ae7))
* **license:** add production licence key pinwren-2026 ([d4c461f](https://github.com/Krithik-m-codes/pinwren/commit/d4c461f4153bbd18367868e6570382142bc3a667))
* wave-3 admin parity — trackers, panel actions, branding, privacy, templates, security ([8ba1b3e](https://github.com/Krithik-m-codes/pinwren/commit/8ba1b3ec51e6a9043668fa3f42eed9c040701b41))
* **web:** dashboard for every wave-2 feature ([1a7836a](https://github.com/Krithik-m-codes/pinwren/commit/1a7836a4fcacd6c4b77f0268e9e12dc14ad2dd2c))
* **web:** Next.js dashboard — auth, onboarding, inbox, projects, settings ([98a3dbb](https://github.com/Krithik-m-codes/pinwren/commit/98a3dbbf44f2b2df4d064fc85236b5980b9629ac))
* **web:** rebrand the dashboard and emails with the new logo and palette ([79599e3](https://github.com/Krithik-m-codes/pinwren/commit/79599e38655f454ee3797c532cde2adcc831d8a6))
* **web:** v1 dashboard — Redux Toolkit, server-rendered shell, wave-4 screens ([1f173d2](https://github.com/Krithik-m-codes/pinwren/commit/1f173d2336d888e049c64e5f79e9d6d4263f5f1d))
* **widget:** default to the Pinwren orange accent and the new mark ([41effc0](https://github.com/Krithik-m-codes/pinwren/commit/41effc043bfb0088b7e57c168871e9816bffad6d))
* **widget:** embeddable widget with pinned comments, bug reports and screenshot editor ([f7ea760](https://github.com/Krithik-m-codes/pinwren/commit/f7ea760cb1c7cbaf8cd50f62046962980fd9d724))
* **widget:** Figma-style comments and full bug-report parity ([3854011](https://github.com/Krithik-m-codes/pinwren/commit/3854011c7bef35ed6e30e701a5f6b1b03b1b0d0e))
* **widget:** v1 chunks, session replay, identity, visibility and @pinwren/react ([0102b1c](https://github.com/Krithik-m-codes/pinwren/commit/0102b1cc399840040bea3cafa992ff8997805315))
* **widget:** wave-3 parity — lazy panel/report chunks, actions, branding, privacy, export ([e92f829](https://github.com/Krithik-m-codes/pinwren/commit/e92f829534e27737bc1ed74794b5ab6098644009))
* **www:** marketing site, live demo and documentation ([f1f93ed](https://github.com/Krithik-m-codes/pinwren/commit/f1f93edf560ab225c399633986c18925d7e3dac7))
* **www:** rebrand the website and docs with the new logo and palette ([3f2b429](https://github.com/Krithik-m-codes/pinwren/commit/3f2b429a83913775def4c6534584255ba11ff992))


### Bug Fixes

* **ai:** guard outbound calls, scope translations, apply through the update path ([6d9e867](https://github.com/Krithik-m-codes/pinwren/commit/6d9e867760390f21e5c8702815fde0a38346772c))
* cap report metadata, align the body limit, publish every package ([7d8a8fe](https://github.com/Krithik-m-codes/pinwren/commit/7d8a8fe2a2806ebfe6219de02ac21492c22cca1a))
* lock project settings saves; generate route types before lint ([2a6c8f4](https://github.com/Krithik-m-codes/pinwren/commit/2a6c8f4d36cd7bdc9c668cae1f943a14ec081950))
* make realtime resume, session lifetime and the sign-in limiter work across workers ([a6af078](https://github.com/Krithik-m-codes/pinwren/commit/a6af0782548335c796d37e1a183881a36c277245))
* **security:** close the CodeQL alerts (ReDoS, regex anchor, JSON-LD escape, demo page) ([ebb0ecc](https://github.com/Krithik-m-codes/pinwren/commit/ebb0ecc613127166ba5a597b5f6c51be7239a157))
* **security:** pre-release hardening from the independent review ([2400367](https://github.com/Krithik-m-codes/pinwren/commit/240036717db121b42fa38e4b32415fc5d6ac5559))
* **types:** add react and react-dom types to root devDependencies ([fd41850](https://github.com/Krithik-m-codes/pinwren/commit/fd41850a66a10e757ad88229c61f3237fedd9a91))
* **www:** route hero pill button to self-hosting docs ([aa91f94](https://github.com/Krithik-m-codes/pinwren/commit/aa91f94846b1bc501b088b6d89a1fc0cd2281561))


### Performance

* **api:** remove hot-row lock waits and run cluster workers ([e46b63b](https://github.com/Krithik-m-codes/pinwren/commit/e46b63b0dbffa4818278caec515d17abc69546a4))

## [Unreleased]

The first public release, 0.1.0. Pinwren was developed privately as "Annota" and renamed before publishing.

### Added

- **Widget** (`@pinwren/widget`, MIT): one script tag; closed Shadow DOM; core ≈33 KB gzip with the side
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

### First run, install and projects

- **The first account is the admin.** A new server sends you to "Create the admin account"; that account
  configures SMTP, security and the licence from the dashboard right away. The one-time setup token and the
  `/setup` claim page are gone (ADR 0021 amendment). `PINWREN_ADMIN_EMAILS` still adds more admins.
- **Get started checklist** on the inbox, driven by the server's real state: admin account, email set up, a
  test email sent, widget connected, first report received, a teammate added. Dismissible.
- **Install tab**: snippets for HTML, Next.js, Google Tag Manager, npm (`@pinwren/widget`) and React
  (`@pinwren/react`), built from `PINWREN_URL` (with a hint when the dashboard is opened on another address);
  a "Verify from your terminal" `npx pinwren doctor` command; test-report steps once connected; refused sites
  listed ("Blocked a request from … 2 min ago") with **Allow**; a warning while no site is allowed.
- **What is this site for?** when creating a project: a public website keeps bug reports private; a staging or
  client-review site shows reviewers each other's pins (`preset` on `POST /api/projects`). New projects open
  on their Install tab. Creating projects is an Admin permission.
- **Review links**: a page link with a token that shows the widget to a client or reviewer, with an expiry,
  last-used time and revoke.
- **Project export** (JSON + every file, as a zip built in the background) and **erase everything one reporter
  sent** (dry run first, recorded without the address) on Project › Privacy & data.
- "Email the reporter" moved to the project's Widget tab, next to a link to the reporter email settings.
- The command palette lists every settings page you can open (same rules as the settings menu); the account
  menu has **Profile & settings**.
- The Licence page shows what a licence switches on today (white-label and Jira Cloud sync) apart from the **Coming soon**
  Enterprise features; licences naming those keep working.
- Docker: every variable in `docker/.env` now reaches the app (`env_file`, Compose v2.24+);
  `docker/.env.example` has commented blocks for SMTP, S3 storage and HTTPS. New
  `docs/self-hosting/getting-started.md` walks from install to the first emailed report.

[Unreleased]: https://github.com/Krithik-m-codes/pinwren/commits/main
