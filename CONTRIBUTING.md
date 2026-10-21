# Contributing to Pinwren

Thanks for helping. Bug reports, fixes, translations, docs and features are all welcome. This guide covers
how the repository is laid out, how to run it, and what a pull request needs to be merged.

- Questions and ideas: [GitHub Discussions](https://github.com/Krithik-m-codes/pinwren/discussions)
- Bugs and feature requests: [issues](https://github.com/Krithik-m-codes/pinwren/issues/new/choose)
- Security problems: **never** in public — see [SECURITY.md](SECURITY.md)

Everyone taking part agrees to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

For anything bigger than a small fix, open an issue (or comment on an existing one) first, so we can agree
on the approach before you spend time on it. The product spec lives in [`blueprint/`](blueprint/README.md);
[`blueprint/14-feature-parity.md`](blueprint/14-feature-parity.md) lists what is built and what is planned,
and architectural decisions are recorded in [`docs/adr/`](docs/adr). If your change contradicts the
blueprint, say so in the issue — it may need a new ADR.

Good first contributions: issues labelled
[`good first issue`](https://github.com/Krithik-m-codes/pinwren/labels/good%20first%20issue), widget
translations (`packages/widget/src/locales/`), and docs.

## Setup

You need Node 22.12+ (see `.nvmrc`), pnpm 12 (`corepack enable` picks the version from `package.json`),
and Docker for the development database.

```bash
git clone https://github.com/<you>/pinwren.git && cd pinwren
pnpm install                                 # also installs the git hooks
pnpm db:up                                   # Postgres 17 on 127.0.0.1:5433
cp apps/web/.env.example apps/web/.env.local # set PINWREN_SECRET (openssl rand -base64 48)
pnpm --filter @pinwren/widget build          # widget bundles into apps/web/public
pnpm --filter @pinwren/web dev -- -p 3100    # dashboard + API on http://localhost:3100
```

Migrations run when the server starts. Sign up at `/sign-up`; the first account becomes the instance admin.

## Repository layout

| Path              | What lives there                                                                               |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| `apps/web`        | Next.js 16 dashboard (App Router). Screens are client components calling `/api`.               |
| `packages/api`    | Hono API mounted by the dashboard at `/api` (dashboard, `/api/v1`) and `/w` (widget).          |
| `packages/core`   | Zod schemas — the single source of every request and response type.                            |
| `packages/db`     | Drizzle schema and generated SQL migrations.                                                   |
| `packages/widget` | The embeddable widget: plain TypeScript and DOM, built with esbuild into `widget.js` + chunks. |
| `docker`          | Dockerfile and compose files.                                                                  |
| `scripts`         | `smoke.mjs` (end-to-end API checks), the demo site and its server.                             |

A few rules hold everywhere (the full list is in [`CLAUDE.md`](CLAUDE.md)):

- Wire types come from the Zod schemas in `packages/core`; never hand-write a request or response type.
- Every query on workspace data goes through the organisation scope; never query tenant tables bare.
- Postgres is the only required service — no Redis, queue broker or object store as a hard dependency.
- The widget stays inside its closed Shadow DOM, never throws into the host page, lazy-loads heavy parts
  and keeps `destroy()` a complete teardown.
- Untrusted content (feedback text, names, URLs, metadata) is escaped at every output: dashboard, emails,
  chat messages, issue bodies.
- Dashboard UI uses the shadcn/ui components on Base UI in `apps/web/src/components/ui` — no
  browser-native pickers or selects — and every screen has empty, loading and error states, keyboard
  access and dark mode.

## Checks

`pnpm verify` runs what CI's first job runs: Prettier, ESLint, TypeScript, unit tests and the build.

| Command                  | What it checks                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------- |
| `pnpm format`            | Formats everything with Prettier (Tailwind classes are sorted too)                  |
| `pnpm lint` / `lint:fix` | ESLint — typescript-eslint strict type-checked, Next.js, React Compiler rules, a11y |
| `pnpm typecheck`         | `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` in every package |
| `pnpm test`              | Vitest unit tests in `packages/core`, `packages/api`, `packages/widget`             |
| `pnpm test:e2e`          | Playwright: the widget against a mocked API (port 5180), then the dashboard (3100)  |

The dashboard suite needs the development database and starts `next dev -p 3100` itself (or reuses one that
is already running). For the API, `node scripts/smoke.mjs http://localhost:3100` runs end-to-end checks
against a running server — start it with `PINWREN_TRUST_PROXY=true GITHUB_API_URL=http://127.0.0.1:4790
PINWREN_ADMIN_EMAILS=smoke-admin@example.com` so the fake GitHub and the admin checks line up.

Lint rules are there to be followed, not silenced. If a rule is wrong for one line, disable it for that line
with a reason: `// eslint-disable-next-line rule-name -- why this is safe`. Unused or reasonless disables
fail the lint.

### Tests

Write tests with the code: unit tests next to the module (`*.test.ts`), Playwright specs in `e2e/`. Every
security mitigation has a test. Don't mark work done with failing or skipped tests.

## Commits and pull requests

We use [Conventional Commits](https://www.conventionalcommits.org): `type(scope): summary`, for example
`feat(widget): pin comments to selected text` or `fix(api): reject webhook URLs on private networks`.
Types: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`, `revert`. Scopes are
usually `widget`, `web`, `api`, `core`, `db` or `docker`. Mark breaking changes with `!` and a
`BREAKING CHANGE:` footer.

The `commit-msg` hook checks the format, and the `pre-commit` hook runs ESLint and Prettier on staged files.
Pull requests are squash-merged, so the **PR title** becomes the commit on `main` — a workflow checks it too.

A pull request should:

1. do one thing, with a title in the format above;
2. pass `pnpm verify`, and the Playwright suite for the parts it touches;
3. include tests, and screenshots (light and dark) for visible changes;
4. update docs, `.env.example` and the blueprint's feature-parity status when behaviour changes.

For database changes, edit `packages/db/src/schema` and run `pnpm db:generate`; commit the generated SQL and
make sure it is safe to apply to a live instance (no long locks on large tables, no data loss without a
migration path).

## Releases

[release-please](https://github.com/googleapis/release-please) reads the commits on `main` and keeps a
release PR open for each component: the app (tags `vX.Y.Z`, which publish the Docker image to GHCR) and
`@pinwren/widget` (tags `widget-vX.Y.Z`, which publish to npm with provenance). Merging that PR is the
release. You never bump versions or edit `CHANGELOG.md` by hand for a release.

## Licensing of contributions

The repository is AGPL-3.0, except `packages/widget`, which is MIT. By opening a pull request you agree that
your contribution is licensed under the licence of the files it changes.

- Never add a copyleft dependency to `packages/widget` — it must stay embeddable anywhere.
- Never copy code from AGPL projects such as BugPin, even though Pinwren's server is AGPL too. Code adapted
  from MIT projects (for example SitePing) keeps its copyright notice and is listed in a root
  `THIRD_PARTY_NOTICES.md` (create it with the first such contribution).
- `dependency-review` fails a pull request that adds a dependency with a known vulnerability or an
  incompatible licence.
