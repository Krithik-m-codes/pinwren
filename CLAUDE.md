# Pinwren — agent instructions

Pinwren is a visual feedback and bug-reporting platform: an embeddable widget (anchored comment pins + annotated bug reports with console/network/replay) and a triage dashboard, shipped as AGPL self-host, commercial Enterprise (`ee/`) and multi-tenant Cloud from one codebase.

The full specification lives in `blueprint/` (files 00–14). `blueprint/14-feature-parity.md` is the checklist of every SitePing and BugPin feature Pinwren must match — flip a row's status in the same commit that ships it. When code and blueprint disagree, the blueprint wins unless an ADR in `docs/adr/` says otherwise.

## Commands

- `pnpm i` — install (also installs the git hooks: lint-staged on pre-commit, commitlint on commit-msg)
- `pnpm db:up` — local Postgres on 127.0.0.1:5433 (`docker/compose.dev.yml`)
- `pnpm --filter @pinwren/widget build` then `pnpm --filter @pinwren/web dev -- -p 3100` — dashboard + API (port 3000 is taken on the owner's machine)
- `node scripts/smoke.mjs http://localhost:3100` — end-to-end API checks (165); start the server with `PINWREN_TRUST_PROXY=true GITHUB_API_URL=http://127.0.0.1:4790 PINWREN_ADMIN_EMAILS=smoke-admin@example.com`
- `docker compose -f docker/compose.yml --env-file docker/.env up -d --build` — self-host stack
- `pnpm verify` — format:check + lint + typecheck + test + build (run before pushing)
- `pnpm format` / `pnpm format:check` — Prettier (Tailwind class sorting via prettier-plugin-tailwindcss)
- `pnpm lint` / `pnpm lint:fix` — ESLint 9 flat config (`eslint.config.mjs`): typescript-eslint strict type-checked, eslint-config-next, React Compiler rules, jsx-a11y. Disable a rule only per line with a reason: `// eslint-disable-next-line rule -- why`
- `pnpm typecheck` — `tsc` per package (the dashboard runs `next typegen` first for typed routes)
- `pnpm test` — Vitest unit tests (core, api, widget)
- `pnpm test:e2e` — Playwright: widget (port 5180, mocked API) then dashboard (port 3100, dev Postgres)
- `pnpm build` — all packages (Turborepo, cached)
- `pnpm db:generate` / `pnpm db:migrate` — Drizzle migrations

## Architecture rules

- Dashboard is Next.js 16 (App Router, Cache Components) with the Hono API from `packages/api` mounted at `/api` and `/w` (ADR 0012). Dashboard screens are client components calling `/api`; no server component reads cookies.

- `packages/*` never import `ee/` or `apps/`. `ee/*` imports only `packages/*`. `apps/server` reaches `ee/` only through `ee/index.ts` behind `requireEntitlement()`.
- Wire types come from Zod schemas in `packages/core` — never hand-write a request/response type.
- Every tenant query goes through `withOrg(orgId, tx => …)`; never query tenant tables with the bare DB handle.
- Postgres is the only required service. Do not add Redis, a queue broker or an object store as a hard dependency.
- The widget (`packages/widget`) must: stay inside a closed Shadow DOM, never throw into host code, meet the size budgets in `05-widget-spec.md`, lazy-load heavy parts, and keep `destroy()` a full teardown.
- No secret in the browser: the widget uses the public project key + origin allowlist; admin access is session-based.
- Integrations and notifications run as jobs; a failing integration must never block ingest.
- Settings an admin edits live in the database; environment variables override and lock them.

## Code style

- TypeScript strict (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`). No `any` without a comment, no `@ts-ignore`.
- Conventional Commits. One logical change per commit.
- UI: `packages/ui` components only — shadcn/ui on Base UI. No browser-native pickers/selects/date inputs.
- Every new screen ships empty, loading and error states, keyboard access and dark mode.
- Comments explain _why_; match surrounding density.
- Untrusted content (feedback text, names, URLs, metadata) is escaped/sanitised at every output: dashboard, emails, chat messages, issue bodies.

## Licensing rules

- MIT packages: `widget`, `widget-react`, `sdk-js`, `mcp`, `anchoring`, `capture`. Never add copyleft dependencies to them.
- **Never copy code from BugPin (AGPL-3.0)** or other copyleft projects. SitePing (MIT) code may be adapted — record it in `THIRD_PARTY_NOTICES.md`.
- Never move a feature from Community into `ee/`.

## Testing

Write tests with the code. Coverage ≥ 80 % for `packages/anchoring`, `packages/capture`, `packages/core`, `ee/licensing`, `ee/billing`. Every security mitigation has a test. Do not mark work done with failing or skipped tests.

## When the spec is silent

Choose the option that keeps self-hosting simple and the widget safe, record an ADR, and continue. Stop and ask only for irreversible or money-spending decisions.
