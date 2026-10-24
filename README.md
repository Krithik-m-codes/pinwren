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
[![Widget core: 33 KB gzip][badge-size]](#packages)
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

- **A launcher like SitePing's** — one button that opens **Hide/Show markers**, **Create new annotation**,
  **Comment on this page**, **Report a bug** and **Show sidebar**, with a badge counting open feedback.
- **Pinned comments** — click an element or drag a region, pick **Question**, **Change**, **Bug** or **Other**
  and press Ctrl+Enter. Numbered markers are coloured by type and preview their thread on hover. Pins are anchored to the element (CSS selector,
  XPath, test id, text and geometry), not to pixels, so they survive layout changes and redesigns. Comment
  on selected text and the quote is highlighted on the page.
- **Threads** — replies under each pin, a team badge on your replies, resolve and reopen from the page,
  deep links (`?pinwren=<id>`) that open the page with the thread showing, and re-pinning a moved pin.
- **Feedback sidebar** — open / resolved / bug counts, search, type and status filters, this page or all
  pages, **Mine**, sorting, grouping by page, select-all with bulk resolve or delete, and CSV/JSON export.
- **Private by default** — on a public website visitors see only their own feedback and the team's replies to
  it; review links and a "staging / client review" project show reviewers everyone's pins.
- **Bug reports** — viewport, full-page, single-element or screen-share capture, then draw, box, arrow,
  text, highlight, numbered steps, pixelate (irreversibly) and crop; drop, paste or browse up to three
  attachments. Optionally a screenshot with every comment, and a session replay of the last 30–120 seconds.
- **Diagnostics** — console messages and failed or slow requests (URLs redacted), browser, OS, viewport,
  locale and page timing, each configurable per project.
- **Never loses a report** — drafts survive reloads; reports sent while offline wait in an IndexedDB outbox
  and are retried with backoff.
- **Safe on your site** — closed Shadow DOM, no global CSS or JS, focus traps that give focus back, every
  error caught and logged. The core is about 33 KB gzip; the side panel, report form, capture engine and
  each language load only when needed.
- **Privacy mode** — masks every text field as a solid block in captures, drops timing data, truncates IP
  addresses and asks for consent. Password and card fields, and anything marked `data-pinwren-mask`, are
  always masked.
- **11 languages**, a configurable launcher, white-label branding, read-only mode, visibility rules (always,
  identified visitors, a query parameter, URL patterns or manual) and a JS API (`Pinwren.open()`,
  `Pinwren.on("submit", …)`, `Pinwren.identify()`, `Pinwren.setMetadata()`, `Pinwren.show()`/`hide()`,
  `Pinwren.destroy()`).

**In the dashboard**

- **Triage inbox** — list, detail and board views, filters, search, sorting and paging, labels, due dates,
  duplicates, a trash with restore, CSV/JSON/PDF export, bulk edits with undo, and keyboard shortcuts for
  everything (`j`/`k`, `e`, `s`, `p`, `a`, `l`, `x`, `u`, `/`, `g m`).
- **Page review** — every page with feedback, its pins laid over the captured screenshot.
- **Workflow** — statuses, priorities, assignees, internal and public comments with @mentions, following an
  item, an activity timeline.
- **Notifications, BugPin-style** — email through your own SMTP (**Settings › Email**, with a test send and
  a delivery log that can resend), **Notifications › General** (who on the team gets new-report emails, plus
  extra addresses), **Reporter** (confirmation, status, priority and assignment emails to the person who
  reported) and **Email templates**; a live bell, a notifications page, desktop notifications and
  hourly/daily digests.
- **Integrations** — two-way GitHub, GitLab and Linear issue sync (GitHub Enterprise and self-managed GitLab
  included; Jira Cloud with an Enterprise licence), Slack, Discord, Microsoft Teams, Telegram and ntfy
  channels, signed webhooks with a delivery log, scoped API tokens for `/api/v1`, and custom panel actions
  such as "Send to agent".
- **Accounts** — the first account is the admin; **Users › Add user** with Admin, Editor or Viewer roles, or
  invitations; password reset, email verification, two-factor sign-in, passkeys, email sign-in links and
  Google/GitHub sign-in.
- **Team** — several workspaces with a switcher, per-workspace branding (name, logo, accent), editable email
  templates, retention policies, CSV and JSON export, a full project export (JSON + files) and erasure of
  everything one reporter sent.
- **Operations** — one container plus Postgres; files on disk or in any S3-compatible bucket; settings in
  the UI that environment variables can override and lock; HTTPS enforcement; an update check.

## How it compares

|                                  | **Pinwren**               | Marker.io | BugHerd   | Userback  | BugPin            | SitePing               |
| -------------------------------- | ------------------------- | --------- | --------- | --------- | ----------------- | ---------------------- |
| Open source                      | ✅ AGPL-3.0, widget MIT   | —         | —         | —         | Open core, AGPL   | ✅ MIT                 |
| Self-hosted                      | ✅ Docker + Postgres      | —         | —         | —         | ✅                | ✅ inside your own app |
| Comments pinned to page elements | ✅                        | —         | ✅        | Partial   | —                 | ✅                     |
| Annotated screenshot bug reports | ✅                        | ✅        | ✅        | ✅        | ✅                | Partial (area capture) |
| Console and network capture      | ✅                        | ✅        | Partial   | ✅        | ✅                | ✅                     |
| Session replay                   | ✅ new in 0.1             | ✅        | —         | ✅        | —                 | —                      |
| Triage dashboard                 | ✅ built in               | ✅        | ✅        | ✅        | ✅                | ✅ React component     |
| GitHub / GitLab issue sync       | ✅ two-way                | ✅        | ✅        | ✅        | GitHub            | ✅                     |
| Jira, Linear and other trackers  | Linear; Jira (Enterprise) | ✅        | ✅        | ✅        | Via webhooks      | —                      |
| Price                            | Free to self-host         | Paid SaaS | Paid SaaS | Paid SaaS | Free to self-host | Free                   |

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

Then, all in the browser:

1. **Create the admin account.** Open `PINWREN_URL` and sign up. The first account on a new server is its
   administrator — there is no setup token to dig out of the logs. Keep the server private until you have
   done this (it listens on 127.0.0.1 by default).
2. **Set up email.** Settings › Email: enter your SMTP server (host, port, security, user, password, from
   address) and click **Send test email**. Environment variables (`SMTP_*`, `EMAIL_FROM` in
   `docker/.env`) still work and lock the fields they set.
3. **Create a project** for your site: its domain, and whether it is a public website (bug reports stay
   private) or a staging/client-review site (reviewers see each other's pins).
4. **Add the widget** from the project's **Install** tab (below), send a test report from your site, and
   watch it arrive in the inbox, the bell and the team's email. A checklist on the inbox tracks these steps.
5. **Add your team** under Settings › Users: create accounts directly or invite by email (Admin, Editor or
   Viewer).

The full walkthrough is in [`docs/self-hosting/getting-started.md`](docs/self-hosting/getting-started.md).
To put it on a VPS with a domain and HTTPS (Docker Compose or a Portainer stack, nginx + Let's Encrypt, backups,
upgrades), follow [`docs/self-hosting/deploy.md`](docs/self-hosting/deploy.md); to host this project's website and docs,
[`docs/self-hosting/website.md`](docs/self-hosting/website.md).
In production, put a TLS reverse proxy (Caddy, Traefik, nginx) in front: allow request bodies of at least
48 MB (screenshots, attachments and a 10 MB session replay) and let it compress the widget with brotli —
ready-made configs are in [`docs/self-hosting/reverse-proxy.md`](docs/self-hosting/reverse-proxy.md). Data lives in two volumes: `pinwren-db` (Postgres) and `pinwren-data`
(uploaded files). Every variable in `docker/.env` reaches the app; each is described in
[`docker/.env.example`](docker/.env.example), [`apps/web/.env.example`](apps/web/.env.example) and
[`blueprint/08-self-hosting.md`](blueprint/08-self-hosting.md).

### Add the widget to your site

Paste the snippet from the project's **Install** tab before `</body>` (the tab also has Next.js, Google Tag
Manager, npm and React versions, prefilled with your key and server address, and a `npx pinwren doctor`
command that checks the setup from your terminal):

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
import { identify, init, on } from "@pinwren/widget"; // a tiny loader: the widget comes from your server

init({ projectKey: "pk_…", endpoint: "https://feedback.example.com" });
identify({ name: "Ada Lovelace", email: "ada@example.com" });
on("submit", ({ number }) => console.log(`Feedback #${number} sent`));
```

In React, `npm install @pinwren/react` and render `<Pinwren projectKey="pk_…" endpoint="https://feedback.example.com" />`
once near the root of your app.

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
| `apps/www`        | `@pinwren/www`    | AGPL-3.0 | The website: landing page, docs (Fumadocs) and the live demo with an in-memory API    |
| `packages/api`    | `@pinwren/api`    | AGPL-3.0 | Hono API: auth, dashboard and widget routes, jobs, email, webhooks, trackers, storage |
| `packages/core`   | `@pinwren/core`   | AGPL-3.0 | Zod schemas and wire types, origin matching, security helpers                         |
| `packages/db`     | `@pinwren/db`     | AGPL-3.0 | Drizzle schema and SQL migrations (Postgres)                                          |
| `packages/widget` | `@pinwren/widget` | MIT      | The embeddable widget, on npm: `widget.js` (≈33 KB gzip) plus lazily loaded chunks    |
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

### The website (`apps/www`)

The public site — landing page, documentation and the live demo — is its own Next.js app. It needs no
database: the demo talks to an in-memory API in the app's route handlers, and the docs live as MDX in
`apps/www/content/docs`. Before every dev, build and typecheck, `scripts/prepare.mjs` generates the environment
reference from `packages/api/src/env.ts`, the changelog page from `CHANGELOG.md`, and copies the built widget
from `packages/widget/dist` for the demo.

```bash
pnpm --filter @pinwren/widget build    # once, for the demo
pnpm --filter @pinwren/www dev         # http://localhost:3200
pnpm --filter @pinwren/www test:e2e    # Playwright on :3200 (builds and starts the site if it isn't running)
docker build -f apps/www/Dockerfile -t pinwren-www . && docker run --rm -p 3200:3000 pinwren-www
```

Hosting the demo publicly: it's anonymous and in memory, so it is capped — 2,000 sandboxes, 6 MiB each, 192 MiB
in total (`DEMO_MAX_*`), with per-visitor and per-address write limits. Request headers are not trusted by
default, so every visitor shares one rate-limit bucket. Set `DEMO_TRUST_PLATFORM_IP_HEADER` when the platform
sets a client-IP header it controls (e.g. `x-vercel-forwarded-for` on Vercel), or `PINWREN_TRUST_PROXY` to the
number of proxies in front of the site (X-Forwarded-For is then read from the right).

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
[badge-size]: https://img.shields.io/badge/widget%20core-33%20KB%20gzip-informational
[badge-ts]: https://img.shields.io/badge/TypeScript-strict-3178c6
[badge-prs]: https://img.shields.io/badge/PRs-welcome-brightgreen
