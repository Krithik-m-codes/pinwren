# 00 — Vision and scope

## One-liner

**Pinwren lets anyone point at a live website and say "this is wrong" — and gives the team everything they need to fix it.**

## The problem

Website feedback today is split across two tool families, and teams usually pay for both:

| Family                         | Examples                                     | Good at                                                                               | Bad at                                                                                  |
| ------------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **Visual review / commenting** | SitePing, BugHerd, Feedbucket, Ruttl, Pastel | Clients pin comments on exact page elements; threads; review rounds                   | Weak technical context (no logs, no replay); most are SaaS-only                         |
| **Bug reporting**              | BugPin, Marker.io, Jam, Gleap, Usersnap      | Annotated screenshots, console and network logs, browser metadata, issue-tracker sync | Comments are not anchored to the DOM; little client-review workflow; expensive per seat |

Self-hostable options are either narrow (SitePing: anchored comments only, no Docker image; BugPin: bug reports only, S3 and other features locked behind an Enterprise licence; BugDrop: GitHub-only) or ship heavy dependency stacks (FasterFixes: Next.js + Inngest + R2 + Resend).

## The product

One widget and one inbox covering both jobs:

1. **Comment mode (review).** Hover, click or drag-select any element and leave a pinned comment. The pin is anchored to the DOM (survives layout changes and responsive breakpoints), threaded, assignable and resolvable. Clients see each other's pins (configurable), so review rounds converge.
2. **Report mode (bug).** One click captures the viewport, opens an annotation editor (arrow, rectangle, highlight, pen, text, blur), and attaches console errors, failed network requests, browser/device metadata and, optionally, the last 30–60 s of session replay.
3. **Inbox (triage).** Linear-grade, keyboard-first inbox. Statuses, priorities, assignees, labels, duplicates, saved views, "open on page" deep links that re-render the pin on the live site.
4. **Routing.** Email, Slack, Discord, Teams, Telegram, ntfy, signed webhooks, GitHub/GitLab/Linear/Jira issue sync, and an **MCP server** so AI coding agents (Claude Code, Cursor) can read, reproduce and resolve feedback.

## Target users

| Persona                                             | Need                                                                 | Edition they usually land on         |
| --------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------ |
| **Agency / freelancer**                             | Client review rounds on staging sites, no client logins, white-label | Cloud Pro / Business, or self-host   |
| **Product & QA team**                               | In-app bug reports with technical context, tracker sync              | Cloud Business, Enterprise self-host |
| **Indie / OSS developer**                           | Free, self-hosted, low ops                                           | Community self-host                  |
| **Regulated org (health, gov, finance, education)** | Data never leaves their infra, SSO, audit                            | Enterprise self-host                 |

## Market research summary

Pricing and feature claims below come mostly from vendor and competitor pages (see [13-references.md](13-references.md)); re-check before using them in marketing.

| Product     | Model                | Price signal                                                      | Notable                                                     |
| ----------- | -------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------- |
| Marker.io   | SaaS                 | Starter ~$39–59/mo (3 users), Team ~$149–199/mo                   | Console, network, session replay, Jira two-way sync on Team |
| BugHerd     | SaaS                 | From ~$50/mo (5 members), ~$150/mo to avoid the browser extension | Agency-focused review                                       |
| Feedbucket  | SaaS                 | Pro ~$39–49/mo, Business ~$72–89/mo                               | Cheap two-way PM sync                                       |
| Userback    | SaaS                 | Only real free tier (2 projects, 7-day expiry); ~$7–23/seat       | Per-seat pricing                                            |
| Gleap       | SaaS                 | Team ~$149/mo, unlimited seats                                    | Replay, mobile SDKs, AI agent that opens PRs                |
| Jam         | SaaS + extension     | ~$14/creator seat                                                 | Developer-side recordings                                   |
| BugPin      | Open-core, AGPL + EE | Free self-host; S3 etc. Enterprise                                | SQLite, single container, small adoption                    |
| SitePing    | MIT library          | Free                                                              | Best DOM anchoring; no server product                       |
| FasterFixes | AGPL + hosted        | Free self-host, flat hosted                                       | MCP server for AI agents                                    |
| BugDrop     | MIT                  | Free                                                              | Feedback → GitHub Issues only                               |

**What this tells us**

- Flat team pricing beats per-seat for agencies (clients and guests must be free and unlimited).
- A real free tier is rare (only Userback) — a generous Cloud Free plan is a growth lever.
- Self-hosters resent features like S3 storage being paywalled. Keep storage, integrations and replay free in self-host; charge for **organisation-scale** needs (SSO, SCIM, audit, white-label, compliance).
- AI-agent integration (MCP) is new and few competitors ship it — a differentiator now, table stakes soon.

## Positioning

> **"Pinned client feedback and developer-grade bug reports in one widget. Free to self-host, one container, your data."**

Differentiators, in priority order:

1. **Both modes in one widget** (anchored comments + technical bug reports).
2. **Best-in-class anchoring** — pins re-attach after redesigns (multi-strategy anchors + fuzzy re-match + "orphaned pin" recovery UI).
3. **Self-host with no artificial limits** on core features, in one container.
4. **AI-ready** — MCP server, structured reproduction context, optional AI triage (dedupe, summarise, suggest severity) with bring-your-own model key.
5. **Modern, fast UI** — Linear-grade inbox, real-time updates, keyboard-first, dark mode, accessible.

## Scope boundaries (what Pinwren is not)

- Not a product-analytics or heat-map tool (no PostHog/Hotjar clone).
- Not a public roadmap / feature-voting board (Canny, Quackback) — maybe a later add-on, not v1.
- Not a full session-recording product — replay is a short, bounded, privacy-masked buffer attached to a report.
- Not a proxy-based reviewer that renders third-party sites without a script (Ruttl-style). That is Phase 5+ and only via a browser extension.
- No native mobile SDKs in v1 (web only, including mobile browsers).

## Success metrics

| Metric                                         | v1 target                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------- |
| Time from `docker compose up` to first report  | < 5 minutes                                                               |
| Widget core bundle (gzip)                      | ≤ 35 KB; lazy chunks loaded only on interaction                           |
| Host-page main-thread cost at load             | < 5 ms                                                                    |
| Anchor re-attachment after a moderate redesign | ≥ 90 % of pins re-attach or are surfaced as "moved" (never silently lost) |
| Report submit p95 (excluding upload)           | < 300 ms server time                                                      |
| Self-host image size                           | < 250 MB                                                                  |
| Idle memory (app container)                    | < 200 MB                                                                  |
