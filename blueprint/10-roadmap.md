# 10 — Roadmap

Durations assume one developer working with an AI build agent full-time. Each phase ends with a **release gate**: all exit criteria met, CI green, a tagged release, and a written changelog. Work-package IDs (`WP-xx`) map 1:1 to prompts in [11-build-prompts.md](11-build-prompts.md).

## Current status — 2026-11-16

The roadmap is **not complete**. The current evidence and actionable remaining-work checklist live in
[docs/roadmap-status.md](../docs/roadmap-status.md). The phase tables below specify scope and original
milestone targets; their version numbers are not statements about current package releases.

| Phase / packages   | Implementation status                                                                                       | Remaining work                                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 0: WP-00–03        | Foundations implemented                                                                                     | Maintain release checks                                                                                          |
| 1: WP-04–13        | Core self-host loop implemented                                                                             | Full doctor diagnostics, backup automation and release/real-service validation; fresh-install CI currently fails |
| 2: WP-14–20, WP-30 | Collaboration implemented, including standalone guest portal, interactive Slack and launcher theming        | Real-account/site validation; Jira Data Center remains unsupported                                               |
| 3: WP-21           | Tenant isolation, provisioning, cross-tenant tests and Cloud sign-up implemented; sign-up closed by default | Remaining worker/multi-instance findings, operator rehearsals and deployed CDN/disable evidence                  |
| 3: WP-22           | Dodo Payments Free/Pro, checkout/portal, usage limits and dunning implemented in test mode                  | Live setup, Business/add-ons and downgrade gaps; Dodo supersedes Stripe via ADR 0023                             |
| 3: WP-23           | Licence verification, entitlements, signing tool and admin/grace UI implemented                             | Operational key/issuance and release validation                                                                  |
| 3: WP-24           | Not implemented                                                                                             | SSO/SCIM, audit log/export, custom roles                                                                         |
| 3: WP-25           | White-label and Jira Cloud implemented                                                                      | Custom domains and legal hold; planned SIEM/support follow-ups                                                   |
| 3: WP-26           | Marketing site, pricing, docs and changelog implemented                                                     | Keep availability and release claims tied to actual deployment/publication                                       |
| 4: WP-27           | AI provider layer, summaries, triage, repro, translation and candidate duplicate checks implemented         | Automatic embedding/pgvector duplicate clustering                                                                |
| 4: WP-28           | Cluster workers, Postgres realtime/limits, operator backup docs and historical k6 tests implemented         | Helm, read replicas, optional Redis, backup/restore CI and fresh capacity evidence                               |
| 4: WP-29           | Accessibility checks exist, including website CI                                                            | Product-wide accessibility/performance evidence, dashboard Lighthouse ≥95 and VPAT                               |
| 5                  | Deferred, demand-driven                                                                                     | Extension, mobile SDKs, public feedback board and design-frame comparison                                        |

Later shipped additions include named/shared server-persisted dashboards and filters, custom fields,
release/regression tracking, additional tracker adapters, screen recording/voice, AI labels/automation,
agent hand-off/repro tests, report sharing and client sign-off. See the
[feature-parity inventory](14-feature-parity.md) and [remaining checklist](../docs/roadmap-status.md).

At upstream `0762e93`, both PostgreSQL isolation jobs and most CI gates passed, but the fresh-install
journey failed. The sign-in layout cause is fixed locally (9/9 fresh-install checks), and an independent
Cloud source review is recorded with queue/worker findings and remediation in progress. All ten required
checks passed on `10cb468` (PR #81); offline queue provisioning is implemented in the follow-up under
[ADR 0041](../docs/adr/0041-offline-cloud-job-queues.md), with its own CI verification still required. Implemented features do not by themselves close phase release gates or establish
production Cloud availability. See the checklist for the exact run and outstanding validation.

## Phase 0 — Foundations (≈ 2 weeks)

| WP    | Deliverable                                                                                                                                           |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| WP-00 | Monorepo scaffold, tooling, CI, ADRs 0001–0011, licences, CLAUDE.md                                                                                   |
| WP-01 | `packages/core` schemas + `packages/db` (Drizzle schema, migrations, RLS, test harness with Testcontainers)                                           |
| WP-02 | `apps/server` skeleton: Hono, config loader, logging, health, error model, OpenAPI, Better Auth (email/password, magic link, passkey), sessions, CSRF |
| WP-03 | `packages/ui` design system + `apps/dashboard` shell: routing, auth screens, layout, command palette, theme, empty states                             |

**Exit:** a user can sign up, create an org, see an empty inbox, in light/dark, at 375 px and 1440 px; CI runs lint, typecheck, unit, integration and one Playwright smoke test.

## Phase 1 — Self-host MVP (≈ 6 weeks) → `v0.1.0-alpha`

| WP    | Deliverable                                                                                              | Features                          |
| ----- | -------------------------------------------------------------------------------------------------------- | --------------------------------- |
| WP-04 | Projects, public keys, origin allowlist, snippet + live verification                                     | F-090 (partial), 3.5              |
| WP-05 | `packages/anchoring` with fixture mutation suite                                                         | F-030, F-031, F-032               |
| WP-06 | Widget loader + core: launcher, comment mode, composer, pins, panel                                      | F-001, F-002, F-009, F-011, F-012 |
| WP-07 | Widget API + ingest + storage drivers (FS, S3) + uploads                                                 | 04 §2, F-096, F-010               |
| WP-08 | Inbox list, detail drawer, statuses, priorities, assignees, labels, comments (public/internal), activity | F-050, F-051                      |
| WP-09 | Capture (SnapDOM + masking + proxy + fallback) + annotation editor + bug report mode                     | F-003, F-004                      |
| WP-10 | Console, network, error capture + dashboard panes                                                        | F-005, F-006                      |
| WP-11 | Email (SMTP/Resend) + in-app notifications + preferences + digests                                       | F-054, F-070                      |
| WP-12 | Docker image, compose variants, setup wizard, `pinwren doctor`, backups                                  | 08                                |
| WP-13 | Hardening: rate limits, security headers, sanitisation, E2E matrix, size budgets, docs                   | 09, 12                            |

**Exit:** `docker compose up` → first pinned comment and first bug report (with screenshot, annotations, console, network) visible in the inbox within 5 minutes; emails delivered via SMTP; anchoring suite ≥ 90 %; widget budgets met; no known high-severity security issues.

## Phase 2 — Collaboration & integrations (≈ 6 weeks) → `v0.5.0-beta`

| WP    | Deliverable                                                                                 | Features                                |
| ----- | ------------------------------------------------------------------------------------------- | --------------------------------------- |
| WP-14 | Real-time SSE + presence                                                                    | F-050 (realtime)                        |
| WP-15 | Board, Pages, Review rounds, Saved views, bulk actions, duplicate (basic)                   | F-052, F-053, F-055, F-056              |
| WP-16 | Webhooks (signed, retries, delivery log) + Slack, Discord, Teams, Telegram, ntfy            | F-071–F-075                             |
| WP-17 | GitHub, GitLab, Linear two-way sync                                                         | F-076–F-078                             |
| WP-18 | API tokens, public REST API, `@pinwren/sdk`, MCP server (HTTP + stdio)                      | F-080, F-081                            |
| WP-19 | Session replay (record buffer + player + timeline sync)                                     | F-007                                   |
| WP-20 | i18n (8 locales), guest portal, review links, identify/metadata API, `@pinwren/react`       | F-008, F-012, F-013, 06 §7              |
| WP-30 | Widget parity extras: right-click comments, panel actions, read-only, export, "Mine" filter | F-015–F-018, [14](14-feature-parity.md) |

**Exit:** every SitePing and BugPin row in [14-feature-parity.md](14-feature-parity.md) is ✅ or explicitly deferred; an agency can run a full client review round with guests and review links, route to Slack and GitHub, and a developer can fix an item end-to-end from Claude Code via MCP.

## Phase 3 — Cloud & monetisation (≈ 6 weeks) → `v1.0.0`

| WP    | Deliverable                                                                                                     | Features            |
| ----- | --------------------------------------------------------------------------------------------------------------- | ------------------- |
| WP-21 | Cloud mode: multi-tenancy hardening, RLS enforcement, cross-tenant test suite, CDN widget delivery, kill switch | 02 §4               |
| WP-22 | Dodo Payments billing, plans, limits, usage counters, dunning (ADR 0023 supersedes Stripe)                      | F-097, 07 §5        |
| WP-23 | `ee/licensing`: licence verification, entitlements, admin UI, grace behaviour; licence-signing tool             | F-098, 07 §4        |
| WP-24 | SSO (SAML/OIDC), SCIM, enforced SSO, audit log + export, custom roles                                           | F-091, F-092, F-093 |
| WP-25 | White-label + custom domains, Jira integration, legal hold                                                      | F-094, F-079, F-095 |
| WP-26 | `apps/www`: marketing site, pricing page, docs (self-hosting, widget, API, MCP), changelog                      | —                   |

**Exit:** a paying Cloud customer can sign up, subscribe, hit and lift limits; a self-host customer can install a licence and use SSO; external pentest done with no open high findings.

## Phase 4 — AI, scale and polish (≈ 4 weeks) → `v1.1`

| WP    | Deliverable                                                                                                                       |
| ----- | --------------------------------------------------------------------------------------------------------------------------------- |
| WP-27 | AI provider layer + auto title/summary, severity, duplicate clustering (embeddings via pgvector), reproduction steps, translation |
| WP-28 | Helm chart, read-replica support, optional Redis, backup/restore drill in CI, load test (k6) to documented capacity               |
| WP-29 | Performance & accessibility pass (axe clean, Lighthouse ≥ 95 dashboard), VPAT draft                                               |

## Phase 5 — Reach (later, demand-driven)

- Browser extension (comment/report on any site without the script, for team members).
- Native mobile SDKs (React Native first).
- Public feedback/roadmap board add-on.
- Figma/design-file comparison (pin a comment against a design frame).

## Release & versioning policy

- SemVer. Pre-1.0 minors may break the self-host config with migration notes.
- Every release: changelog, upgrade notes, Docker image, widget CDN version, npm packages (release-please, ADR 0017).
- Security fixes back-ported to the latest two minors.

## Risk register

| Risk                                                                        | Impact                          | Mitigation                                                                         |
| --------------------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------- |
| Screenshot fidelity on complex sites (cross-origin assets, canvas, iframes) | Reports look wrong → trust loss | Proxy for assets, placeholders, screen-share fallback, fixture suite of hard pages |
| Anchoring drift on heavy SPAs                                               | Pins in wrong place             | Confidence scoring, "moved?" UI, re-pin, explicit `data-pinwren-anchor` docs       |
| Widget breaks a customer site                                               | Churn, reputation               | Isolation, error guard, size budgets, framework E2E matrix, remote kill switch     |
| Spam on public endpoints                                                    | Cost, noise                     | Rate limits, challenge, pause intake                                               |
| AGPL scares some enterprises                                                | Lost deals                      | Commercial licence for Enterprise customers covers the whole codebase              |
| Scope creep (analytics, roadmaps)                                           | Delays                          | Non-goals in 00, phase gates                                                       |
