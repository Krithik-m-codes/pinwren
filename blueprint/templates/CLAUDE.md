# Annota — agent instructions

Annota is a visual feedback and bug-reporting platform: an embeddable widget (anchored comment pins + annotated bug reports with console/network/replay) and a triage dashboard, shipped as AGPL self-host, commercial Enterprise (`ee/`) and multi-tenant Cloud from one codebase.

The full specification lives in the blueprint folder (`annota-blueprint/`, files 00–13). When code and blueprint disagree, the blueprint wins unless an ADR in `docs/adr/` says otherwise.

## Commands

- `pnpm i` — install
- `pnpm dev` — server + dashboard + widget watch (needs `DATABASE_URL`; `pnpm db:up` starts a local Postgres container)
- `pnpm build` — all packages (Turborepo, cached)
- `pnpm lint` / `pnpm lint:fix` — Biome + dependency-boundary check
- `pnpm typecheck`
- `pnpm test` — unit + component + integration (Testcontainers; Docker required)
- `pnpm test:e2e` — Playwright (`--project=smoke` for the quick set)
- `pnpm size` — widget bundle budgets
- `pnpm db:generate` / `pnpm db:migrate` — Drizzle migrations
- `pnpm openapi` — regenerate `apps/server/openapi.json` (commit the diff)

## Architecture rules

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
- Comments explain *why*; match surrounding density.
- Untrusted content (feedback text, names, URLs, metadata) is escaped/sanitised at every output: dashboard, emails, chat messages, issue bodies.

## Licensing rules

- MIT packages: `widget`, `widget-react`, `sdk-js`, `mcp`, `anchoring`, `capture`. Never add copyleft dependencies to them.
- **Never copy code from BugPin (AGPL-3.0)** or other copyleft projects. SitePing (MIT) code may be adapted — record it in `THIRD_PARTY_NOTICES.md`.
- Never move a feature from Community into `ee/`.

## Testing

Write tests with the code. Coverage ≥ 80 % for `packages/anchoring`, `packages/capture`, `packages/core`, `ee/licensing`, `ee/billing`. Every security mitigation has a test. Do not mark work done with failing or skipped tests.

## When the spec is silent

Choose the option that keeps self-hosting simple and the widget safe, record an ADR, and continue. Stop and ask only for irreversible or money-spending decisions.
