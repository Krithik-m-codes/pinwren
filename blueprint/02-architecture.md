# 02 — Architecture

## 1. Guiding constraints

1. **Same code, three deployments.** Community self-host, Enterprise self-host and multi-tenant Cloud run the same build. Differences are configuration (`ANNOTA_MODE=selfhost|cloud`) plus the presence of a valid licence or cloud flag that unlocks `ee/` features.
2. **Boring, portable infrastructure.** Postgres is the only required service. Background jobs, real-time fan-out, rate limiting and caching all run on Postgres in self-host, with optional Redis in Cloud for scale.
3. **TypeScript end to end**, strict mode, shared Zod schemas as the single source of truth for API types.
4. **The widget is a separate product** with its own size, performance and compatibility budgets (see [05-widget-spec.md](05-widget-spec.md)).

## 2. Stack (decided)

| Layer | Choice | Why |
|---|---|---|
| Runtime | **Node.js 24 LTS** | LTS through 2028; native `fetch`, test runner, permission model. Bun compatibility kept, not required |
| Package manager / monorepo | **pnpm workspaces + Turborepo** | Fast, strict, cached builds |
| HTTP server | **Hono** (`@hono/node-server`) + **@hono/zod-openapi** | Tiny, Web-standard `Request/Response`, OpenAPI generated from Zod |
| Database | **PostgreSQL 16+** | One required dependency; FTS, JSONB, LISTEN/NOTIFY, RLS |
| ORM / migrations | **Drizzle ORM + drizzle-kit** | Typed SQL, migrations applied on boot |
| Jobs | **pg-boss** | Postgres-backed queue — no Redis in self-host |
| Real time | **SSE** + Postgres `LISTEN/NOTIFY` fan-out | Works behind every proxy; multi-instance safe |
| Auth | **Better Auth** (organisation, passkey, magic-link, OAuth; SSO/SCIM plugins for `ee/`) | Self-hostable, TypeScript-native, active |
| Object storage | Driver interface: **local FS** and **S3-compatible** (`aws4fetch`, no AWS SDK) | Free storage choice in every edition |
| Email | **nodemailer** (SMTP) + Resend/Postmark HTTP drivers; templates in **React Email** | Works with any provider |
| Dashboard | **React 19 + Vite + TanStack Router + TanStack Query + Tailwind CSS v4 + shadcn/ui (Base UI primitives) + Motion** | SPA served by the API container — no second server, no SSR needed behind login |
| Charts | Recharts (via shadcn charts) | Consistent with design system |
| Widget | **Preact + @preact/signals**, CSS in constructed stylesheets inside a closed Shadow DOM, built with **tsup/esbuild** | Small runtime, React-like DX |
| Screenshot | **SnapDOM** (`@zumer/snapdom`, MIT) with a fallback path (see 05) | Fast, accurate SVG/foreignObject capture |
| Annotation canvas | Custom canvas layer + **perfect-freehand** (MIT) | Small, touch-friendly |
| Replay | **rrweb** record (widget) + **rrweb-player** (dashboard) | Standard, MIT |
| Selectors | **@medv/finder** (MIT) + custom stability heuristics | Proven in SitePing |
| MCP | **@modelcontextprotocol/sdk** — Streamable HTTP at `/mcp` + `@annota/mcp` stdio package | Claude Code / Cursor compatible |
| Billing (Cloud) | **Stripe** Billing + Customer Portal + webhooks | Industry default |
| Validation | **Zod 4** shared between server, dashboard, widget (widget uses a tree-shaken subset or Valibot if size demands) | One schema source |
| Logging / telemetry | **pino** + **OpenTelemetry** (optional OTLP export) | Ops-friendly |
| Testing | **Vitest**, **Playwright**, **Testcontainers** (Postgres), **MSW** | See 12 |
| Lint / format | **Biome** | One fast tool |
| Marketing site (Cloud only) | **Astro** in `apps/www` | Static, fast, separate from product |

## 3. Monorepo layout

```
annota/
├─ apps/
│  ├─ server/            # Hono API + serves dashboard static build + widget bundle + MCP endpoint
│  ├─ dashboard/         # React SPA (Vite)
│  ├─ www/               # Astro marketing + docs (Cloud only, not in self-host image)
│  └─ extension/         # (Phase 5) Chrome/Firefox extension for sites without the script
├─ packages/
│  ├─ core/              # Shared Zod schemas, types, constants, error codes (internal)
│  ├─ db/                # Drizzle schema, migrations, query helpers, RLS policies
│  ├─ widget/            # @annota/widget — the embeddable widget (MIT)
│  ├─ widget-react/      # @annota/react — <Annota/> component + hooks (MIT)
│  ├─ sdk-js/            # @annota/sdk — typed REST client (MIT)
│  ├─ mcp/               # @annota/mcp — stdio MCP server wrapping sdk-js (MIT)
│  ├─ anchoring/         # Anchor capture + re-attach engine, framework-free, unit-tested (MIT)
│  ├─ capture/           # Screenshot, console, network, replay buffers (MIT)
│  ├─ email/             # React Email templates + renderer
│  ├─ integrations/      # Slack, Discord, Teams, Telegram, ntfy, webhooks, GitHub, GitLab, Linear
│  ├─ storage/           # Storage driver interface + fs + s3 drivers
│  ├─ jobs/              # pg-boss setup + job definitions
│  ├─ ai/                # Provider-agnostic AI client (Anthropic, OpenAI-compatible, Ollama)
│  ├─ ui/                # Dashboard design system (shadcn-based components, tokens)
│  └─ config/            # Shared tsconfig, biome, vitest presets
├─ ee/                   # Commercial licence. Imports from packages/*, never the reverse
│  ├─ licensing/         # Licence verification, entitlements
│  ├─ sso/               # SAML/OIDC, SCIM, domain capture
│  ├─ audit/             # Audit log storage, export, SIEM stream
│  ├─ rbac/              # Custom roles
│  ├─ whitelabel/        # Custom domains, branding removal
│  ├─ jira/              # Jira integration
│  └─ billing/           # Stripe (Cloud only)
├─ docker/               # Dockerfile, compose files, entrypoint
├─ docs/
│  ├─ adr/               # Architecture decision records
│  └─ self-hosting/      # Admin docs (rendered by apps/www)
├─ e2e/                  # Playwright suites + fixture sites
├─ LICENSE               # AGPL-3.0 (applies to everything except ee/ and MIT packages)
├─ ee/LICENSE            # Commercial licence
└─ THIRD_PARTY_NOTICES.md
```

Dependency rule (enforced by a lint script): `apps/* → packages/*`, `ee/* → packages/*`, `apps/server → ee/*` **only through** `ee/index.ts` behind an entitlement check. `packages/*` never import `ee/` or `apps/`.

## 4. Runtime topology

### Self-host (Community / Enterprise)

```
Browser (host site) ──widget.js──▶  annota container ──▶ Postgres
                    ◀──REST/SSE──   ├─ Hono API (/api, /w = widget API, /mcp)
Team browser ───────dashboard────▶  ├─ Static dashboard (/)
                                    ├─ Static widget bundle (/widget.js, /w/*.js chunks)
                                    ├─ pg-boss workers (same process, configurable concurrency)
                                    └─ Storage driver → /data (volume) or S3
```

- One process by default. `ANNOTA_ROLE=all|web|worker` lets larger installs split web and worker replicas against the same database.
- Migrations run on boot behind an advisory lock (safe with multiple replicas).

### Cloud

```
Cloudflare (CDN for widget + assets, WAF) ─▶ web replicas (ANNOTA_ROLE=web) ─▶ Postgres (managed, PITR)
                                           └▶ worker replicas (ANNOTA_ROLE=worker)
                                              ├─ S3/R2 for assets
                                              └─ Redis (optional: rate limits, SSE fan-out at scale)
```

- Multi-tenant: shared schema, `org_id` on every tenant row, Postgres **row-level security** as defence in depth (the app sets `app.current_org` per transaction).
- Widget bundle served from a CDN domain (`cdn.annota.app/w/v1/widget.js`) with immutable versioned chunks.

## 5. Key request flows

### 5.1 Widget submit (report)

1. Widget loads `GET /w/config/:projectKey` (cached 60 s, ETag) → theme, capture settings, permissions, locale.
2. User captures and annotates. Assets (screenshot PNG/WebP, replay gzip, attachments) are uploaded **first** via `POST /w/uploads` → returns upload IDs (direct-to-S3 presigned PUT when S3 driver is used; streamed to disk for the FS driver).
3. `POST /w/feedback` with JSON (anchor bundle, form fields, metadata, console/network buffers, upload IDs, `clientId`).
4. Server validates origin against project allowlist, rate limits (per IP + per project key, Postgres token bucket), validates payload, inserts in one transaction, enqueues jobs: `notify`, `integrations.sync`, `ai.enrich` (if enabled), `thumbnails`.
5. Responds `201` with the public feedback record; `NOTIFY feedback_created` → SSE to dashboards.

### 5.2 Re-render pins

`GET /w/feedback?projectKey&url&urlPattern` (only when project allows public read or the visitor holds a review-link token) → pins with anchor bundles → anchoring engine places markers client-side.

### 5.3 Integrations (two-way)

Outbound via jobs with retries (exponential, max 24 h), delivery log rows. Inbound via provider webhooks (`/api/integrations/:provider/webhook`, signature verified) → map external status to Annota status.

## 6. Configuration model

- **Environment variables** for infrastructure only (database, storage, SMTP, secrets, URLs, licence path). See [templates/env.example](templates/env.example).
- **Database settings** for everything an admin changes in the UI (branding, notification defaults, integrations). Environment variables, when set, **override** and lock the matching UI field (shown as "Managed by environment").
- Secrets stored in the DB (integration tokens, SMTP password set via UI) are encrypted with AES-256-GCM using `ANNOTA_ENCRYPTION_KEY` (key rotation supported via key IDs).

## 7. Editions & entitlements

```ts
// packages/core/src/entitlements.ts (shape only)
type Entitlement =
  | 'sso' | 'scim' | 'audit_log' | 'custom_roles' | 'white_label'
  | 'jira' | 'legal_hold' | 'siem_stream' | 'priority_support';
interface EntitlementSet { plan: PlanId; features: Set<Entitlement>; limits: PlanLimits; }
```

- Self-host without licence → `community` set (no `ee` entitlements, no limits).
- Self-host with valid licence → entitlements from the licence file.
- Cloud → entitlements from the org's Stripe subscription.
- Every gated server route uses `requireEntitlement('sso')`; the dashboard reads `/api/me/entitlements` to show an upgrade card instead of a broken screen.

## 8. Decision log (ADRs to create in `docs/adr/` during WP-00)

| ADR | Decision | Alternatives rejected |
|---|---|---|
| 0001 | Postgres only (no SQLite) | Dual-dialect SQLite+PG doubles migration/test cost; Postgres in compose is trivial |
| 0002 | Hono + static SPA instead of Next.js | Next.js adds a second runtime model, heavier image, harder self-host |
| 0003 | pg-boss instead of BullMQ/Redis | Keeps self-host to one dependency |
| 0004 | SSE instead of WebSockets | Proxy-friendly, simpler auth, enough for one-way updates |
| 0005 | Better Auth instead of Lucia/Auth.js/Keycloak | Org + SSO + passkeys in one TS library, self-hostable |
| 0006 | Preact widget with closed Shadow DOM | Vanilla is slower to build; React too heavy |
| 0007 | SnapDOM for capture | html2canvas re-implements CSS and lags modern features |
| 0008 | AGPL core + commercial `ee/` + MIT SDKs | FSL (fewer contributors accept it), MIT (no protection from hosted clones) |
| 0009 | Ed25519 offline licence files | Phone-home activation alienates air-gapped customers |
| 0010 | RLS as defence in depth in Cloud | App-level filtering alone is one bug away from a cross-tenant leak |
| 0011 | Clean-room reimplementation; SitePing (MIT) code may be adapted, BugPin (AGPL) may not | — |
