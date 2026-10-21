<div align="center">

<!-- Logo placeholder: add docs/assets/logo.svg (and a -dark variant), then replace this comment with a
     <picture> element. -->

<h1>Pinwren</h1>

**Pinned feedback and annotated bug reports for any website — self-hosted.**

One script tag adds a widget where clients and teammates pin comments on exact page elements, Figma-style,
or send an annotated screenshot with console errors, failed requests and browser details. Everything lands
in a keyboard-first triage inbox you run yourself.

[![CI][badge-ci]][ci]
[![CodeQL][badge-codeql]][codeql]
[![Licence: AGPL-3.0][badge-agpl]](#licence)
[![npm: @pinwren/widget][badge-npm]][npm]
[![Widget core: 26 KB gzip][badge-size]](#packages)
[![TypeScript: strict][badge-ts]](tsconfig.base.json)
[![PRs welcome][badge-prs]](CONTRIBUTING.md)

[Website][site] · [Quickstart](#quickstart) · [Architecture](#architecture) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

</div>

<!-- Screenshot placeholder: add docs/assets/screenshot.png (the widget on a page next to the inbox) and
     embed it here. -->

> **Status: v0.1 — early.** The core loop (pin, report, triage, sync to your tracker) works and is covered by
> unit, Playwright and end-to-end API tests. Expect rough edges and breaking changes before 1.0. The full
> product spec and roadmap live in [`blueprint/`](blueprint/README.md).

## Features

**On your website (the widget)**

- **Pinned comments** — click an element or drag a region. Pins are anchored to the element (CSS selector,
  XPath, test id, text and geometry), not to pixels, so they survive layout changes and redesigns. Comment
  on selected text and the quote is highlighted on the page.
- **Threads** — replies under each pin, a team badge on your replies, resolve and reopen from the page,
  deep links (`?pinwren=<id>`) that open the page with the thread showing.
- **Bug reports** — viewport, full-page, single-element or screen-share capture, then draw, box, arrow,
  text, pixelate (irreversibly) and crop; drop, paste or browse up to three attachments.
- **Diagnostics** — console messages and failed or slow requests (URLs redacted), browser, OS, viewport,
  locale and page timing, each configurable per project.
- **Never loses a report** — drafts survive reloads; reports sent while offline wait in an IndexedDB outbox
  and are retried with backoff.
- **Safe on your site** — closed Shadow DOM, no global CSS or JS, focus traps that give focus back, every
  error caught and logged. The core is about 26 KB gzip; the side panel, report form, capture engine and
  each language load only when needed.
- **Privacy mode** — masks every text field as a solid block in captures, drops timing data, truncates IP
  addresses and asks for consent. Password and card fields, and anything marked `data-pinwren-mask`, are
  always masked.
- **11 languages**, a configurable launcher, white-label branding, read-only mode and a JS API
  (`Pinwren.open()`, `Pinwren.on("submit", …)`, `Pinwren.identify()`, `Pinwren.destroy()`).

**In the dashboard**

- **Triage inbox** — list, detail and board views, filters and search, bulk edits with undo, and keyboard
  shortcuts for everything (`j`/`k`, `e`, `s`, `p`, `a`, `x`, `u`, `/`).
- **Page review** — every page with feedback, its pins laid over the captured screenshot.
- **Workflow** — statuses, priorities, assignees, internal and public comments, an activity timeline, email
  and in-app notifications.
- **Integrations** — two-way GitHub and GitLab issue sync (token-based, works with GitHub Enterprise and
  self-managed GitLab), signed webhooks with Slack and Discord formats plus a delivery log, scoped API
  tokens for `/api/v1`, and custom panel actions such as "Send to agent".
- **Team** — workspaces, invitations and roles, per-workspace branding (name, logo, accent), editable email
  templates, retention policies, CSV and JSON export.
- **Operations** — one container plus Postgres; files on disk or in any S3-compatible bucket; settings in
  the UI that environment variables can override and lock; HTTPS enforcement; an update check.

## How it compares

|                                  | **Pinwren**              | Marker.io | BugHerd   | Userback  | BugPin            | SitePing               |
| -------------------------------- | ------------------------ | --------- | --------- | --------- | ----------------- | ---------------------- |
| Open source                      | ✅ AGPL-3.0, widget MIT  | —         | —         | —         | Open core, AGPL   | ✅ MIT                 |
| Self-hosted                      | ✅ Docker + Postgres     | —         | —         | —         | ✅                | ✅ inside your own app |
| Comments pinned to page elements | ✅                       | —         | ✅        | Partial   | —                 | ✅                     |
| Annotated screenshot bug reports | ✅                       | ✅        | ✅        | ✅        | ✅                | Partial (area capture) |
| Console and network capture      | ✅                       | ✅        | Partial   | ✅        | ✅                | ✅                     |
| Session replay                   | Planned                  | ✅        | —         | ✅        | —                 | —                      |
| Triage dashboard                 | ✅ built in              | ✅        | ✅        | ✅        | ✅                | ✅ React component     |
| GitHub / GitLab issue sync       | ✅ two-way               | ✅        | ✅        | ✅        | GitHub            | ✅                     |
| Jira, Linear and other trackers  | Via webhooks and actions | ✅        | ✅        | ✅        | Via webhooks      | —                      |
| Price                            | Free to self-host        | Paid SaaS | Paid SaaS | Paid SaaS | Free to self-host | Free                   |

Competitor columns reflect their public documentation as of October 2026 and change often; if a cell is
wrong, please [open an issue][issues]. "Partial" means the feature exists with notable limits or only on
some plans.

## Quickstart

### Self-host with Docker

You need Docker with Compose. The stack is the Pinwren container plus Postgres 17.

```bash
git clone https://github.com/Krithik-m-codes/pinwren.git && cd pinwren
cp docker/.env.example docker/.env   # set PINWREN_URL, PINWREN_SECRET, POSTGRES_PASSWORD
docker compose -f docker/compose.yml --env-file docker/.env up -d --build
```

Each release also publishes a multi-arch image (amd64, arm64) to `ghcr.io/krithik-m-codes/pinwren`: set
`PINWREN_IMAGE=ghcr.io/krithik-m-codes/pinwren:<version>` in `docker/.env` and leave out `--build`.

Open `PINWREN_URL`, create your account and workspace, and add a project for your site with its allowed
origins. In production, put a TLS reverse proxy (Caddy, Traefik, nginx) in front and allow request bodies of
at least 12 MB for screenshots. Data lives in two volumes: `pinwren-db` (Postgres) and `pinwren-data`
(uploaded files). Every setting is documented in [`apps/web/.env.example`](apps/web/.env.example) and
[`blueprint/08-self-hosting.md`](blueprint/08-self-hosting.md).

### Add the widget to your site

Paste the snippet from the project's **Install** tab before `</body>`:

```html
<script src="https://feedback.example.com/widget.js" data-project="pk_…" async></script>
```

The widget only talks to your Pinwren server, identifies itself with the project's public key, and is
accepted only from the origins you allowed — no secret ever reaches the browser. To bundle it with your app
instead, install it from npm and start it on the client:

```bash
npm install @pinwren/widget
```

```js
import "@pinwren/widget"; // browser only: defines window.Pinwren

Pinwren.init({ projectKey: "pk_…", endpoint: "https://feedback.example.com" });
Pinwren.identify({ name: "Ada Lovelace", email: "ada@example.com" });
Pinwren.on("submit", ({ number }) => console.log(`Feedback #${number} sent`));
```

## Architecture

```
 your website                           your server (one container)                     storage
┌──────────────────┐   /w/*  (public   ┌──────────────────────────────────────────┐   ┌──────────────┐
│ widget.js        │   key + origin)   │ Next.js 16 dashboard (App Router)        │   │ Postgres     │
│  closed Shadow   │ ────────────────▶ │  └─ Hono API mounted at /api and /w      │──▶│  data, auth, │
│  DOM, lazy       │                   │     Better Auth sessions, rate limits    │   │  job queue   │
│  chunks          │ ◀─ chunks, i18n ─ │     pg-boss jobs: email, webhooks, issue │   └──────────────┘
└──────────────────┘                   │     sync, retention, update check        │   ┌──────────────┐
                                       │  node:cluster workers                    │──▶│ disk or S3   │
 dashboard (browser) ──── /api ──────▶ └──────────────────────────────────────────┘   └──────────────┘
```

- **One required service.** Postgres holds data, sessions, rate-limit windows and the pg-boss job queue; no
  Redis, broker or object store is needed
  ([ADR 0012](docs/adr/0012-nextjs-dashboard-with-embedded-hono-api.md),
  [ADR 0014](docs/adr/0014-background-jobs-and-wave-1-backend.md)).
- **Wire types come from Zod schemas** in `packages/core`, shared by the API, the dashboard and the widget.
- **Tenant isolation:** every query on workspace data is scoped to its organisation. Integrations run as
  retried jobs, so a failing tracker never blocks ingest.
- **The dashboard** is client components calling `/api` through React Query, compiled with the React
  Compiler, with Cache Components and typed routes.

Decisions are recorded in [`docs/adr/`](docs/adr) and the
[blueprint's decision log](blueprint/02-architecture.md).

## Packages

| Path              | Package           | Licence  | What it is                                                                            |
| ----------------- | ----------------- | -------- | ------------------------------------------------------------------------------------- |
| `apps/web`        | `@pinwren/web`    | AGPL-3.0 | Next.js 16 dashboard; mounts the API at `/api` and `/w`                               |
| `packages/api`    | `@pinwren/api`    | AGPL-3.0 | Hono API: auth, dashboard and widget routes, jobs, email, webhooks, trackers, storage |
| `packages/core`   | `@pinwren/core`   | AGPL-3.0 | Zod schemas and wire types, origin matching, security helpers                         |
| `packages/db`     | `@pinwren/db`     | AGPL-3.0 | Drizzle schema and SQL migrations (Postgres)                                          |
| `packages/widget` | `@pinwren/widget` | MIT      | The embeddable widget, on npm: `widget.js` (≈26 KB gzip) plus lazily loaded chunks    |
| `docker`          | —                 | AGPL-3.0 | Dockerfile, self-host compose file, development database                              |
| `loadtest`        | —                 | AGPL-3.0 | k6 scenario and sizing notes ([results](loadtest/README.md))                          |

## Development

You need Node 22.12+, pnpm 12 (`corepack enable`) and Docker for the development database.

```bash
pnpm install
pnpm db:up                                   # Postgres on 127.0.0.1:5433
cp apps/web/.env.example apps/web/.env.local # then set PINWREN_SECRET
pnpm --filter @pinwren/widget build          # widget.js into apps/web/public
pnpm --filter @pinwren/web dev -- -p 3100    # dashboard + API; migrations run on start
```

| Command                                        | What it does                                                          |
| ---------------------------------------------- | --------------------------------------------------------------------- |
| `pnpm verify`                                  | Format check, lint, typecheck, unit tests and build — run before a PR |
| `pnpm format` / `pnpm format:check`            | Prettier, with Tailwind class sorting                                 |
| `pnpm lint` / `pnpm lint:fix`                  | ESLint: typescript-eslint strict, Next.js, React Compiler, a11y       |
| `pnpm typecheck`                               | `tsc` in every package (strict, `exactOptionalPropertyTypes`)         |
| `pnpm test`                                    | Vitest unit tests (core, api, widget)                                 |
| `pnpm test:e2e`                                | Playwright: the widget (port 5180) and the dashboard (port 3100)      |
| `node scripts/smoke.mjs http://localhost:3100` | End-to-end API checks against a running server                        |

Try the widget on the demo page: allow `localhost:5173` in a project, run `node scripts/demo-server.mjs`,
then open `http://localhost:5173/?key=<project key>&host=http://localhost:3100`.

## Contributing

Issues and pull requests are welcome — please read [CONTRIBUTING.md](CONTRIBUTING.md) first. Commits follow
[Conventional Commits](https://www.conventionalcommits.org) (a git hook checks them) and releases are cut by
release-please from those messages. Everyone taking part agrees to the [Code of Conduct](CODE_OF_CONDUCT.md).
Report security issues privately, as described in [SECURITY.md](SECURITY.md).

## Licence

Pinwren uses two licences:

- **The server and dashboard** — everything except `packages/widget` — are licensed under the
  [GNU Affero General Public License v3.0](LICENSE). You may use, modify and self-host them freely,
  including commercially. If you modify Pinwren and let other people use it over a network, you must offer
  them the source code of your modified version under the same licence.
- **The widget** (`packages/widget`, published as `@pinwren/widget`) is [MIT-licensed](packages/widget/LICENSE),
  so embedding it in your website or product places no obligations on your own code.

<!-- Links: the repository, website and npm package are defined once here. -->

[site]: https://pinwren.dev
[issues]: https://github.com/Krithik-m-codes/pinwren/issues
[ci]: https://github.com/Krithik-m-codes/pinwren/actions/workflows/ci.yml
[codeql]: https://github.com/Krithik-m-codes/pinwren/actions/workflows/codeql.yml
[npm]: https://www.npmjs.com/package/@pinwren/widget
[badge-ci]: https://github.com/Krithik-m-codes/pinwren/actions/workflows/ci.yml/badge.svg?branch=main
[badge-codeql]: https://github.com/Krithik-m-codes/pinwren/actions/workflows/codeql.yml/badge.svg?branch=main
[badge-agpl]: https://img.shields.io/badge/licence-AGPL--3.0-blue
[badge-npm]: https://img.shields.io/npm/v/@pinwren/widget?label=%40pinwren%2Fwidget
[badge-size]: https://img.shields.io/badge/widget%20core-26%20KB%20gzip-informational
[badge-ts]: https://img.shields.io/badge/TypeScript-strict-3178c6
[badge-prs]: https://img.shields.io/badge/PRs-welcome-brightgreen
