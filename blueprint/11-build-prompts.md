# 11 — Build prompts

One prompt per work package (WP). Run them **in order**, each in a session that has read the whole blueprint. Every prompt implicitly includes the **standard footer** below — don't repeat it, but always follow it.

> **Standard footer (applies to every WP)**
> 1. Re-read the blueprint sections cited in the prompt before starting.
> 2. Write tests alongside code (see 12). Do not mark the WP done with failing or skipped tests.
> 3. Run the full gate: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e --project=smoke` (+ any WP-specific gate).
> 4. Update docs touched by the change (`docs/`, READMEs, OpenAPI descriptions, env.example).
> 5. If you made a decision the spec didn't cover, add an ADR in `docs/adr/`.
> 6. Commit with Conventional Commits, one commit per logical change.
> 7. Finish with a short report: built / deferred / decisions / follow-ups.

---

## Phase 0 — Foundations

### WP-00 — Repository scaffold
```
Create the Pinwren monorepo exactly as laid out in 02-architecture.md §3.
- pnpm workspaces + Turborepo; Node 24 (.nvmrc, engines); TypeScript strict (shared tsconfig in packages/config:
  strict, exactOptionalPropertyTypes, noUncheckedIndexedAccess, verbatimModuleSyntax).
- Biome for lint+format; Vitest workspace config; Playwright config with a "smoke" project; Changesets.
- LICENSE (AGPL-3.0) at root, ee/LICENSE (commercial placeholder text clearly marked for legal review),
  MIT LICENSE files in packages/widget, widget-react, sdk-js, mcp, anchoring, capture. THIRD_PARTY_NOTICES.md.
- Copy templates/CLAUDE.md from the blueprint to the repo root and templates/env.example to .env.example.
- docs/adr/0001…0011 from the decision log in 02 §8 (context, decision, consequences).
- A dependency-boundary check script (fails if packages/* import ee/ or apps/, or ee/ imports apps/).
- GitHub Actions: install (cached), lint, typecheck, unit, integration (Postgres service), e2e smoke, size-limit
  (placeholder), boundary check, licence check (no GPL/AGPL deps inside MIT packages).
- SECURITY.md, CONTRIBUTING.md (CLA note), CODE_OF_CONDUCT.md, .editorconfig, Renovate config.
Acceptance: `pnpm i && pnpm build && pnpm test` passes on a clean clone; CI green.
```

### WP-01 — Core schemas and database
```
Implement packages/core and packages/db per 03-data-model.md and 04-api-spec.md.
- packages/core: Zod 4 schemas for every wire type in 04 (AnchorBundle, Environment, Feedback create/read,
  Comment, diagnostics entries, problem-details errors, entitlements, plan ids/limits), enums, error codes,
  URL normalisation util (tested), UUIDv7 helper.
- packages/db: Drizzle schema for every table in 03 (except Better Auth-owned tables, which WP-02 generates),
  enums, indexes, generated tsvector column, RLS policies (migration SQL) with a `withOrg(orgId, tx => …)`
  helper that sets app.current_org per transaction, per-project feedback number allocation (row lock),
  migration runner with pg advisory lock, seed script (demo org/project/feedback).
- Testcontainers-based integration harness: fresh Postgres per test file, migrations applied once.
- Tests: RLS prevents cross-org reads when enabled; number allocation is gap-free under concurrency (50 parallel
  inserts); URL normalisation table tests.
```

### WP-02 — Server skeleton and auth
```
Build apps/server per 02 and 04.
- Hono app with @hono/zod-openapi; route modules per resource; OpenAPI at /api/openapi.json and Scalar UI at
  /api/docs; RFC 9457 problem-details error handler; request IDs; pino logging (redaction of secrets);
  config loader that validates env with Zod and prints a precise error per missing/invalid variable.
- /healthz (liveness), /readyz (DB + storage check), /metrics (Prometheus, token-protected).
- Better Auth: email+password (argon2id), magic link, passkeys, Google/GitHub OAuth (enabled only if env set),
  organisation plugin mapped to our org table; sessions in Postgres; CSRF double-submit for /api mutations;
  security headers per 09 §4.
- Encryption helper (AES-256-GCM with key ids) for secrets at rest.
- pg-boss initialised (packages/jobs) with graceful shutdown; PINWREN_ROLE=all|web|worker.
- Serve the dashboard static build at / with SPA fallback and immutable caching for hashed assets.
- Tests: auth flows (integration), CSRF rejection, problem-details shape, config validation messages.
```

### WP-03 — Design system and dashboard shell
```
Build packages/ui and apps/dashboard per 06-dashboard-ux.md.
- Tailwind v4 with CSS-variable tokens for light/dark (06 §1), Inter + JetBrains Mono self-hosted (no CDN).
- shadcn/ui components on Base UI primitives, wrapped in packages/ui: Button, Input, Textarea, Select, Combobox,
  DatePicker, ColorPicker, FileDrop, Dialog, Sheet, Popover, DropdownMenu, Tooltip, Tabs, Toast (with undo),
  Badge, Avatar(+group), Skeleton, EmptyState, DataList (virtualised), CommandPalette, Kbd, StatusIcon,
  PriorityIcon. No native browser pickers anywhere.
- Dashboard: TanStack Router (file-based) + TanStack Query; auth screens (sign in, sign up, magic link, passkey,
  forgot password); app layout (sidebar, org switcher, top bar, ⌘K); empty Inbox; Settings > Profile.
- Theme toggle (system/light/dark), density toggle, keyboard shortcut registry + `?` overlay.
- Storybook (or Ladle) for packages/ui with a11y addon; axe checks in Playwright smoke.
Acceptance: Phase 0 exit criteria in 10-roadmap.md.
```

---

## Phase 1 — Self-host MVP

### WP-04 — Projects, keys, origins, install flow
```
Implement projects (03 `project`, 04 Projects endpoints, 06 §3.5).
- CRUD, slug, public key generation (pk_live_/pk_test_ + 24 random chars), rotate key with overlap window.
- Origin allowlist editor: hostname patterns with `*.` wildcard and optional port; validation + preview of
  which example URLs match; matcher util in packages/core shared with the server (unit-tested).
- Install page: snippet tabs (HTML, React/Next, Vue/Nuxt, WordPress, Webflow, Shopify, GTM) and live
  verification via SSE (temporary until WP-14: a polling endpoint is acceptable, mark TODO(WP-14)).
- Project settings pages for widget_config and capture_config with Zod-validated forms.
```

### WP-05 — Anchoring engine
```
Implement packages/anchoring per 01 F-030–F-032 and 05 §5. Framework-free TypeScript, no DOM globals at
import time, pure functions where possible.
- capture(element, point|region|textRange, options) → AnchorBundle.
- Stable selector generator (use @medv/finder with custom attribute/class filters; heuristics in 05 §5).
- resolve(bundle, document) → { element, confidence, strategy } | { orphaned: true }, with the scoring in F-031.
- Text similarity (normalised Levenshtein/Jaro-Winkler on ≤120 chars), structural similarity, geometry proximity.
- Position helpers: pin % → page coordinates; observers helper for resize/scroll/mutation with throttling.
- Fixture suite in e2e/anchoring: 10 realistic pages × 30 scripted mutations (class rename, wrapper insert,
  reorder, text edit, breakpoint change, hydration re-render). Report re-attach rate; CI fails below 90 %.
Study SitePing's packages/widget/src/dom (MIT, local fork at E:\Shubpy\SitePing) for ideas; adapt with
attribution only if you copy code.
```

### WP-06 — Widget core (comment mode)
```
Build packages/widget per 05-widget-spec.md §§1–5, 8, 9 (capture/replay come later).
- Loader (<3 KB) + core (Preact + signals) in closed Shadow DOM under <pinwren-root>; constructed stylesheets.
- Launcher, menu, picking (hover outline, Shift=parent, arrow-key DOM walk, touch long-press), region select,
  text-selection comment, composer (markdown-lite, attachments placeholder until WP-07), pins rendering with
  numbered markers, side panel (list/filter/thread/reply), deep link ?pinwren=<id>.
- Visibility rules (F-012), public JS API with pre-load queue (05 §8), identify/metadata stubs.
- i18n scaffolding (en only now; message catalogue keys).
- Global error guard; destroy() fully restores the page.
- Fixture sites (plain HTML, Next.js App Router, Vue/Nuxt, SvelteKit, Astro, hostile-CSS page, CSP-strict page)
  under e2e/fixtures; Playwright tests for the comment flow on each (against a mocked API via MSW until WP-07).
- size-limit budgets from 05 §2 enforced in CI.
```

### WP-07 — Widget API, ingest and storage
```
Implement /w/* from 04 §2 and packages/storage (FS + S3 drivers via aws4fetch, presigned PUT for S3,
streamed PUT for FS, signed GET redirects), F-096, F-010.
- Origin check, rate limits (Postgres token bucket table), payload validation, clientId idempotency,
  transactional insert (feedback + page upsert + assets claim + activity), job enqueue (notify, thumbnails).
- Upload lifecycle: create → upload → claim on submit → expire job.
- Asset serving with security headers from 09.
- Widget: real API client with offline IndexedDB queue + retry/backoff; switch E2E tests from MSW to the real
  server (Testcontainers Postgres).
- Tests: origin spoofing rejected, oversize rejected, idempotent replay returns same record, rate limit 429.
```

### WP-08 — Inbox and item detail
```
Implement F-050 (without realtime) and F-051 per 06 §3.1–3.2.
- List with virtualisation, grouping, filter chips, search (Postgres FTS), cursor pagination, sort.
- Detail drawer: header pickers (status, priority, assignees, labels, due date), screenshot viewer placeholder
  until WP-09, environment/metadata tabs, anchor tab, timeline (comments public/internal + activity),
  composer with mentions.
- Bulk actions bar; keyboard map from 06 §5; optimistic updates with undo toast.
- "Open on page" builds the deep link.
- Playwright: triage flow keyboard-only.
```

### WP-09 — Capture, annotation editor, bug report mode
```
Implement packages/capture (screenshot part) and widget bug mode per 05 §6 and F-003/F-004.
- Masking pass, SnapDOM capture (viewport/element/full page), WebP/PNG encode, cross-origin asset retry via
  /w/proxy (server: allowlisted hosts, SSRF protections from 09), placeholder fallback, screen-share fallback.
- Annotation editor (lazy chunk): arrow, rect, ellipse, highlighter, pen (perfect-freehand), text, step markers,
  blur/pixelate, crop, undo/redo, colours, stroke, touch; output flattened image + JSON vector layer.
- Report form; optimistic upload while typing.
- Dashboard: screenshot viewer with layer toggle, zoom/pan.
- E2E: capture on fixture pages incl. a cross-origin image page and an iframe page; perf check < 1.5 s.
```

### WP-10 — Diagnostics capture
```
Implement console, network and error buffers (05 §7, F-005, F-006) in packages/capture with reversible wrappers,
safe serializer, redaction rules; attach on submit; project-level configuration honoured.
Dashboard Console and Network tabs (filter by level/status, copy as cURL with redaction, timestamps relative
to submit). Transparency test suite for fetch/XHR wrappers (streams, abort, keepalive, Request objects,
credentials, redirects).
```

### WP-11 — Notifications and email
```
Implement F-054 and F-070: packages/email (React Email templates: new feedback, assigned, mentioned, status
changed, reply to reporter, digest, invitation, magic link, test email), drivers (SMTP via nodemailer, Resend,
Postmark), instance settings UI with "Send test email" and env-override locking, per-user per-project
preferences, in-app notification centre, digest job (hourly/daily). Reporter emails default OFF per project.
Every email has a plain-text part, List-Unsubscribe for digests, and is rendered in the recipient's locale.
```

### WP-12 — Packaging and self-host experience
```
Implement 08-self-hosting.md: multi-arch Dockerfile (bundled server, non-root, read-only rootfs), compose files
(base, caddy, traefik, minio, external-db), install.sh, setup wizard with PINWREN_SETUP_TOKEN, `pinwren doctor`
CLI, backup job (pg_dump + storage sync to S3) with restore docs, upgrade/downgrade protection.
CI: build image, run e2e smoke against the built image, publish to GHCR on tags with SBOM + cosign.
Acceptance: fresh VM → install.sh → first report in < 5 minutes (scripted test in CI with compose).
```

### WP-13 — Hardening and alpha release
```
Go through 09-security-and-privacy.md item by item and close every Phase-1-relevant mitigation; add tests
proving each. Run the full E2E matrix, anchoring suite, size budgets, axe checks. Write docs: self-hosting,
widget install, configuration reference, privacy & masking guide. Tag v0.1.0-alpha with changelog.
```

---

## Phase 2 — Collaboration & integrations

### WP-14 — Real time
```
SSE endpoint /api/stream with Postgres LISTEN/NOTIFY fan-out (multi-instance safe), auth per project
membership, heartbeat, reconnect with Last-Event-ID. Dashboard: live list updates, "N new" pill, presence
avatars on items (ephemeral presence table or in-memory with NOTIFY). Replace WP-04 polling.
```

### WP-15 — Board, pages, rounds, views, duplicates
```
Implement F-052, F-053, F-055, F-056 (basic) and saved views per 06 §3.3–3.4. Rounds export to CSV and PDF
(server-side PDF via a lightweight renderer — no headless Chrome dependency in the image).
```

### WP-16 — Webhooks and chat integrations
```
packages/integrations: provider interface (configure, test, deliver, optional inbound). Generic webhooks with
HMAC signing, retries schedule and auto-disable (04 §5), delivery log UI with redeliver. Slack (OAuth app,
channel picker, Block Kit message with screenshot thumbnail, interactive assign/resolve buttons via signed
interaction endpoint), Discord, Microsoft Teams (workflow webhooks), Telegram bot, ntfy. Escaping of
untrusted content per 09. Failures never block ingest.
```

### WP-17 — Issue tracker sync
```
GitHub (GitHub App: install flow, repo picker, issue create with embedded screenshot + context, label mapping,
two-way status via webhooks), GitLab (OAuth + webhooks), Linear (OAuth + webhooks). Link table, conflict rules
(last-writer-wins with activity log entries), per-project auto-sync rules (e.g. all bugs with priority ≥ high).
```

### WP-18 — Public API, SDK and MCP
```
API tokens (argon2id-hashed, scopes, prefix display), /api/v1 per 04 §4 with Idempotency-Key, @pinwren/sdk
generated types from OpenAPI + hand-written ergonomic client, MCP server per 04 §6 (Streamable HTTP at /mcp and
stdio package @pinwren/mcp), docs with Claude Code and Cursor setup snippets. E2E: an MCP client lists, reads and
resolves an item.
```

### WP-19 — Session replay
```
Replay buffer in packages/capture (rrweb record, rolling 30–120 s, masking defaults, CompressionStream gzip,
memory cap), lazy chunk, consent hook, per-project toggle; dashboard player (rrweb-player) with timeline markers
synced to console/network panes. Perf test on reference SPA: CPU overhead < 3 %.
```

### WP-20 — i18n, guests, review links, React package
```
Locales en, es, fr, de, pt-BR, it, ja, hi for widget + emails (+ dashboard en first, structure for more).
Guest portal (06 §7), review links (03 review_link) that enable the widget via token, signed identity
(HMAC identify), @pinwren/react package with <Pinwren/> and useAnnota(). Tag v0.5.0-beta.
```

---

## Phase 3 — Cloud & monetisation

### WP-21 — Cloud mode
```
PINWREN_MODE=cloud: enforce RLS on every tenant query path, cross-tenant test suite that calls every endpoint
as another org and expects 404/403, org signup flow, CDN widget delivery with versioned paths, remote kill
switch for widget versions, per-org rate limits, Redis optional adapter for rate limiting and SSE fan-out.
```

### WP-22 — Billing
```
ee/billing with Stripe: plans from 07 §3 defined in code and synced by script, Checkout, Customer Portal,
webhooks (idempotent), usage counters and limit enforcement (soft/hard), dunning banners and downgrade rules,
billing settings page, upgrade cards wherever a limit or entitlement blocks an action.
```

### WP-23 — Licensing (self-host Enterprise)
```
ee/licensing per 07 §4: Ed25519 verification with key ids, entitlement resolution, grace/read-only behaviour,
admin licence page (upload, details, expiry countdown), seat counting, and tools/sign-license (CLI that signs a
payload with a private key from env/KMS; never committed). Tests for tampered, expired, wrong-key licences.
```

### WP-24 — Enterprise identity and governance
```
SSO via Better Auth SSO plugin (SAML 2.0 + OIDC), domain verification and capture, enforced SSO, SCIM 2.0
(users, groups), audit log (append-only, filters, CSV/JSONL export, SIEM webhook stream), custom roles with
permission matrix. All behind requireEntitlement().
```

### WP-25 — White-label, Jira, legal hold
```
Custom widget/CDN domain and dashboard domain (Cloud: automated TLS via the edge; self-host: docs), branding
removal and theming for widget, emails, guest portal; Jira Cloud + Data Center integration; legal hold flag
that suspends retention deletes.
```

### WP-26 — Website and docs
```
apps/www (Astro): landing, features, pricing (from the same plan definitions), self-hosting docs, widget docs,
API reference (from OpenAPI), MCP guide, changelog, comparison pages (honest, sourced). Tag v1.0.0.
```

---

### WP-30 — Widget parity extras (SitePing + BugPin)
```
Close every ⬜ row in 14-feature-parity.md that names WP-30: right-click comments (F-015), panel actions (F-016),
read-only mode (F-017), widget export (F-018), "Mine" filter, focus-trap/modal handling. Then re-check the whole
parity file: every row is ✅, explicitly deferred with a reason, or assigned to a later WP. Flip statuses in the same
commit and add a test per ✅ row.
```

---

## Phase 4 — AI, scale, polish

### WP-27 — AI features
```
packages/ai provider layer (Anthropic, OpenAI-compatible, Ollama) with per-org config, cost/usage logging,
audit entries. Features F-110–F-114 as jobs triggered on ingest (opt-in per project); pgvector for embeddings
(optional extension; feature hidden if unavailable). Never send screenshots/replay unless enabled.
```

### WP-28 — Scale & ops
```
Helm chart, read-replica routing, k6 load tests with published capacity numbers, backup/restore drill in CI,
OpenTelemetry traces across ingest → jobs → integrations.
```

### WP-29 — Quality pass
```
Accessibility audit (axe clean, manual screen-reader pass on widget + dashboard), Lighthouse ≥ 95 on dashboard
routes, VPAT draft, performance profiling of widget on low-end Android, docs polish. Tag v1.1.0.
```
