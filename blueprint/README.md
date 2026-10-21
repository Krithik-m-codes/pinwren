# Pinwren — build blueprint

> **Codename:** `Pinwren` (placeholder — check trademark/domain before launch; every doc uses this name so a find-and-replace renames it).

Pinwren is a visual feedback and bug-reporting platform. A single script tag (or npm package) adds a widget to any website. Clients and teammates **pin comments onto live page elements** (SitePing-style, DOM-anchored, threaded), or **file a full bug report** with an annotated screenshot, console logs, network errors and an optional session replay (BugPin/Marker.io-style). Everything lands in a fast, keyboard-first triage inbox and is routed to email, chat, issue trackers and AI coding agents.

It ships three ways from one codebase:

| Edition                    | Who runs it                     | License                  | Money                                   |
| -------------------------- | ------------------------------- | ------------------------ | --------------------------------------- |
| **Community (self-host)**  | You                             | AGPL-3.0 core + MIT SDKs | Free                                    |
| **Enterprise (self-host)** | You, with a signed license file | Commercial `ee/`         | Annual license                          |
| **Cloud**                  | Us, multi-tenant                | Same code + `ee/`        | Free tier → Pro → Business → Enterprise |

## How to use this folder

This folder is the complete spec. The build agent (Claude Opus) should read it in this order before writing code:

| #   | File                                                       | What it settles                                                            |
| --- | ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| 0   | [00-vision-and-scope.md](00-vision-and-scope.md)           | Product, users, market research, positioning, what we will _not_ build     |
| 1   | [01-feature-spec.md](01-feature-spec.md)                   | Every feature, its edition, and its acceptance criteria                    |
| 2   | [02-architecture.md](02-architecture.md)                   | Stack, monorepo layout, runtime topology, decision log (ADRs)              |
| 3   | [03-data-model.md](03-data-model.md)                       | Database schema (Drizzle / Postgres), tenancy, retention                   |
| 4   | [04-api-spec.md](04-api-spec.md)                           | Widget API, dashboard API, webhooks, MCP tools, auth                       |
| 5   | [05-widget-spec.md](05-widget-spec.md)                     | The embeddable widget: modes, anchoring, capture, size budget              |
| 6   | [06-dashboard-ux.md](06-dashboard-ux.md)                   | Dashboard screens, design system, interaction rules                        |
| 7   | [07-licensing-and-pricing.md](07-licensing-and-pricing.md) | Open-core boundary, plans, license keys, billing                           |
| 8   | [08-self-hosting.md](08-self-hosting.md)                   | Docker image, compose files, env vars, upgrades, backups                   |
| 9   | [09-security-and-privacy.md](09-security-and-privacy.md)   | Threat model, PII masking, abuse controls, GDPR                            |
| 10  | [10-roadmap.md](10-roadmap.md)                             | Phased plan with milestones and exit criteria                              |
| 11  | [11-build-prompts.md](11-build-prompts.md)                 | Copy-paste prompts, one per work package, in build order                   |
| 12  | [12-testing-and-quality.md](12-testing-and-quality.md)     | Test strategy, performance budgets, CI gates                               |
| 13  | [13-references.md](13-references.md)                       | Sources, upstream code to study, license cautions                          |
| 14  | [14-feature-parity.md](14-feature-parity.md)               | **Every SitePing and BugPin feature mapped to Pinwren, with build status** |
| —   | [templates/CLAUDE.md](templates/CLAUDE.md)                 | Drop-in agent instructions for the new repo's root                         |
| —   | [templates/env.example](templates/env.example)             | Every environment variable, documented                                     |

## Kick-off prompt (paste into a fresh Opus session)

```
You are building Pinwren from the blueprint in E:/projects/pinwren/blueprint (the repo is E:/projects/pinwren).
Read README.md, then files 00 through 14 in order, then templates/CLAUDE.md.
Do not write code until you have read all of them.
Then create a new git repository at <target path>, copy templates/CLAUDE.md to its root,
and execute the prompts in 11-build-prompts.md one work package at a time, in order.
After each work package: run the gates in 12-testing-and-quality.md, commit, and report
what you built, what you deferred, and any spec decision you had to make. When the spec is
silent or contradictory, choose the option that keeps self-hosting simple and record it as
a new ADR in docs/adr/ — do not stop to ask unless the choice is irreversible or costs money.
```

## Non-negotiables (repeated in every file that they touch)

1. **One container self-host.** Community edition runs as one app container plus Postgres. No Redis, no queue broker, no object store required (local disk is a valid storage driver).
2. **The widget never breaks the host page.** Shadow DOM isolation, no global CSS/JS leakage, lazy-loaded heavy parts, hard size budget, every failure swallowed and reported.
3. **No API secret in the browser.** The widget authenticates with a public, origin-bound project key. Admin access is session-based.
4. **Clean-room implementation.** BugPin is AGPL-3.0 — study its behaviour, never copy its code. SitePing is MIT — code may be adapted with attribution in `THIRD_PARTY_NOTICES.md`.
5. **Every claim the UI makes is true.** No fake counts, no dead buttons, no "coming soon" placeholders in shipped screens.
