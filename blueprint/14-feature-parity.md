# 14 — Feature parity: SitePing + BugPin → Annota

Annota must do **everything SitePing does and everything BugPin does**, in one product. This file is the
checklist. Every row maps a competitor feature to an Annota feature ID (see [01-feature-spec.md](01-feature-spec.md))
and a work package (see [11-build-prompts.md](11-build-prompts.md)).

Status legend: ✅ built · 🟡 partly built · ⬜ planned

Sources: SitePing — the MIT source and docs in the local fork (`E:\Shubpy\SitePing`, `packages/*`,
`apps/demo/content/docs`). BugPin — [bugpin.io](https://bugpin.io/), [docs.bugpin.io](https://docs.bugpin.io/), and
behaviour observed on the self-hosted instance at `bugs.shubpy.com` (routes, settings, widget modules). BugPin is
AGPL: **study behaviour only, never copy code** (ADR 0011).

_Last updated: 2026-10-21 (after Phase-1 build)._

---

## A. From SitePing (anchored review comments)

| SitePing feature | What it does | Annota | Status | WP |
|---|---|---|---|---|
| Rectangle / region annotations | Client drags a box on the live page | F-002 region select | 🟡 click-pin built; drag-region not yet | WP-06 |
| Element-anchored pins | Pin tied to an element, not pixels | F-002, F-030 | ✅ | — |
| Multi-selector anchoring (CSS + XPath + text) | Re-finds the element after redesigns | F-030/F-031 | ✅ (CSS, XPath, test-id/id, fuzzy text + siblings + geometry) | — |
| Percentage-relative positions | Pin stays put across breakpoints | F-030 `pin.xPct/yPct` | ✅ | — |
| Semantic anchors (`data-feedback-anchor`) | Developer-declared stable anchors | `data-annota-anchor` | ✅ | — |
| Category on each annotation | Bug / change / question / other | `kind`: comment, bug, idea, question | ✅ | — |
| Status workflow (open, in progress, resolved, won't fix) | Triage states | open, in_progress, in_review, resolved, wont_fix, duplicate | ✅ | — |
| Discussion threads | Replies under each feedback | Comments (public + internal) | ✅ | — |
| "Who speaks as the team" | Team replies marked as team | `team` flag on widget replies | ✅ | — |
| Reviewer emails hidden from the public | PII never listed to anonymous visitors | Widget API never returns emails | ✅ | — |
| Instant right-click comment (opt-in) | Right-click → composer at cursor | F-015 | ⬜ | WP-30 |
| Panel actions | Custom buttons/links in the detail view (create ticket, hand to agent) | F-016 | ⬜ | WP-30 |
| Screenshots of the annotated area with privacy masking | Opt-in capture, masked fields | F-003 + masking (05 §6) | ✅ viewport capture, password/cc/`data-annota-mask` hidden | — |
| Console + network diagnostics (opt-in) | Errors and failed requests attached | F-005/F-006 | ✅ errors, warnings, failed/slow requests, redacted URLs | — |
| Triage inbox (Linear-style, keyboard-first, light/dark) | `<SitepingInbox />` | F-050/F-051 dashboard | ✅ list + detail, j/k, `/`, dark mode | — |
| Headless inbox hook | Build your own inbox UI | `@annota/sdk` + REST API | ⬜ | WP-18 |
| Retry with backoff + local queue | Flaky network never loses a comment | F-010 | 🟡 retry with same clientId built; IndexedDB queue not yet | WP-07 |
| Shadow DOM isolation | No CSS leaks either way | Closed shadow root | ✅ | — |
| Dev-only by default / `forceShow` | Hidden in production unless forced | F-012 visibility rules | ⬜ | WP-20 |
| `minViewportWidth`, phone/tablet behaviour | Skip or adapt on small screens | F-012 + mobile bottom sheet | ⬜ | WP-20 |
| Lazy-loaded heavy parts | Panel, screenshot engine, locales on demand | `widget-capture.js` loaded on first bug report | ✅ screenshot; ⬜ panel/locales | WP-20 |
| 8 locales (en, fr, de, es, it, pt-BR, ru, ja) | Widget + inbox translated | F-013 | ⬜ | WP-20 |
| Page scope / URL patterns (`getPageScope`, `urlPattern`) | Group pins across `/product/:id` | F-008 `setPageScope` | 🟡 field stored; no widget API yet | WP-20 |
| Scope annotations by URL | Pins from one page never leak to another | Pins listed per normalised page URL | ✅ | — |
| Deep links (`?siteping=<id>`) | Open the page focused on one feedback | `?annota=<id>` + "Open on page" | ✅ | — |
| Watch navigation (SPA route changes) | Reload pins on client-side navigation | MutationObserver + URL check | ✅ | — |
| Identity (`identity` option) | Pre-fill reporter from the host app | F-008 `identify()` | 🟡 remembered name/email; no host API yet | WP-20 |
| Read-only mode | Viewers can't post | F-017 | ⬜ | WP-30 |
| Show/hide annotations toggle | Hide pins while browsing | Widget menu "Hide pins" | ✅ | — |
| "Mine" filter (own feedback in localStorage) | See only what I sent | F-011 panel filters | ⬜ | WP-30 |
| Export from the widget | Download page feedback | F-018 | ⬜ | WP-30 |
| Events / callbacks (`onOpen`, `onFeedbackSent`, …) | Host app reacts to widget events | `Annota.on(...)` (05 §8) | ⬜ | WP-20 |
| React hook (`useSiteping`) | Framework-native install | `@annota/react` | ⬜ | WP-20 |
| Over-your-modals handling | Works above host dialogs/focus traps | `z-index` + host on `<html>` | 🟡 needs focus-trap handling | WP-30 |
| Store-agnostic server (Prisma, Drizzle, memory, localStorage) | Choose your DB / no server | Postgres only (ADR 0001) | ➖ deliberate: one supported DB | — |
| Screenshot storage backends (S3, R2, Cloudflare Images, DB, filesystem) | Keep images out of the DB | F-096 storage drivers | 🟡 filesystem built; S3-compatible next | WP-07 |
| Webhooks (Slack, Discord, generic) with escaping | Notify on new feedback | F-071/F-072/F-075 | ⬜ | WP-16 |
| GitHub / GitLab issue sync | One issue per feedback | F-076/F-077 | ⬜ | WP-17 |
| CLI (`init`, `sync`, `status`, `doctor`) | Setup and health checks | `annota doctor` (08 §5) | ⬜ | WP-12 |
| Access policies (API key or custom auth, CSRF guards) | Who may read/write | Session auth for team, origin-bound public key for widget | ✅ | — |

## B. From BugPin (visual bug reporting)

| BugPin feature | What it does | Annota | Status | WP |
|---|---|---|---|---|
| One script tag install | `<script … data-api-key>` | `<script … data-project>` | ✅ | — |
| Per-project API key | Identifies the site | Public project key + rotate | ✅ | — |
| Domain whitelist (subdomains allowed) | Only listed sites can submit | Allowed sites with `*.` wildcards + URL tester | ✅ | — |
| Rate limiting (configurable per minute) | Abuse protection | Postgres fixed-window limiter (`WIDGET_RATE_LIMIT_PER_MIN`) | ✅ (env); ⬜ UI setting | WP-13 |
| Visible-area screenshot | Capture what the user sees | SnapDOM viewport capture | ✅ | — |
| Full-page screenshot | Capture the whole page | F-003 full-page option | ⬜ | WP-09 |
| Screen-share capture fallback (`getDisplayMedia`) | When DOM capture fails | F-003 fallback | ⬜ | WP-09 |
| Annotation: pen | Freehand | Editor "Draw" | ✅ | — |
| Annotation: rectangle | Box | Editor "Box" | ✅ | — |
| Annotation: circle / ellipse | Ellipse | F-004 | ⬜ | WP-09 |
| Annotation: arrow | Arrow | Editor "Arrow" | ✅ | — |
| Annotation: text | Text labels on the image | F-004 | ⬜ | WP-09 |
| Annotation: privacy blur | Hide sensitive content | Editor "Hide" (irreversible pixelation) | ✅ | — |
| Undo | Step back | Editor "Undo" | ✅ | — |
| Media attachments (files) | Attach extra files | F-002/F-003 attachments | ⬜ | WP-07 |
| Console errors attached | Debug context | F-005 | ✅ | — |
| Network logs attached | Failed requests | F-006 | ✅ | — |
| Browser / OS / device metadata | Environment | F-003 environment | ✅ browser, OS, viewport, DPR, locale, timezone, referrer | — |
| Offline support / draft storage (IndexedDB) | Queue and resume reports | F-010 | 🟡 retries only | WP-07 |
| Consent notice before sending | Tell the reporter what is sent | F-019 | ⬜ | WP-13 |
| Widget launcher customisation (position, shape, icon, text, tooltip, light/dark colours, hover effect) | Brand the button | F-001 | 🟡 accent colour only | WP-20 |
| Widget dialog colours | Brand the form | F-001 theming | ⬜ | WP-20 |
| Widget i18n (de, en, es, fr, it, ja, nl, zh) | Translated widget | F-013 | ⬜ | WP-20 |
| Admin dashboard: report list, detail, status, priority, assignee | Triage | F-050/F-051 | ✅ | — |
| Report history | Per-report change log | `activity` timeline | ✅ stored; 🟡 not yet shown in the UI | WP-08 |
| Users with roles (admin, editor, viewer) | Access control | Better Auth org roles (owner/admin/member) | 🟡 roles exist; viewer/permissions not enforced | WP-24 |
| Invitations by email (with expiry) | Add teammates | F-090 | ⬜ | WP-11 |
| Team email notifications (new report, status, priority, assignment, deletion) | Email the team | F-054/F-070 | ⬜ | WP-11 |
| Reporter email notifications + two-way reporter messaging | Keep the reporter informed | F-054 reporter notifications + public replies | 🟡 public replies built; ⬜ email | WP-11 |
| SMTP settings in the UI with test email | Configure mail without env | F-070 instance settings | ⬜ | WP-11 |
| Email templates (custom) | Edit message wording | F-020 | ⬜ (Enterprise in BugPin; Community in Annota) | WP-11 |
| GitHub issue sync | Reports → issues | F-076 | ⬜ | WP-17 |
| Outbound webhooks | Integrations | F-075 | ⬜ (Enterprise in BugPin; Community in Annota) | WP-16 |
| API access tokens | Programmatic access | F-081 | ⬜ (Enterprise in BugPin; Community in Annota) | WP-18 |
| S3 storage | Off-disk screenshots | F-096 | ⬜ (Enterprise in BugPin; **Community in Annota**) | WP-07 |
| Custom branding (logo, colours, favicon) | Brand the console | F-094 | ⬜ | WP-25 |
| White-label (remove BugPin branding) | Agency resale | F-094 | ⬜ (Enterprise in both) | WP-25 |
| Data retention (days) with cleanup job | Auto-delete old reports | F-095 | ⬜ | WP-12 |
| Session lifetime setting | Security | Better Auth session config | ⬜ UI | WP-13 |
| EU privacy mode | Stricter data handling | F-021 (IP truncation, no third-party calls, consent) | ⬜ | WP-13 |
| Enforce HTTPS | Refuse plain HTTP | Reverse-proxy + `ANNOTA_URL` https check | ⬜ | WP-12 |
| Update check | Tell admins about new versions | `ANNOTA_UPDATE_CHECK` | ⬜ | WP-12 |
| Health endpoint | Ops | `/api/health` | ✅ | — |
| Single-container self-host, Docker | Easy install | `docker/compose.yml` (app + Postgres) | ✅ | — |
| Licence management (Enterprise key) | Unlock EE features | F-098 Ed25519 licence files | ⬜ | WP-23 |

## C. Annota-only (neither SitePing nor BugPin has these)

| Feature | ID | Status | WP |
|---|---|---|---|
| Both modes (anchored comments **and** annotated bug reports) in one widget | F-002 + F-003 | ✅ | — |
| Multi-tenant workspaces + Cloud plans with Stripe | F-090, F-097 | 🟡 workspaces built | WP-21/22 |
| Session replay buffer (last 30–120 s) | F-007 | ⬜ | WP-19 |
| Real-time inbox (SSE) + presence | F-050 | ⬜ (20 s polling today) | WP-14 |
| Board view, page view, review rounds, saved views | F-052/053/055 | ⬜ | WP-15 |
| MCP server for AI coding agents | F-080 | ⬜ | WP-18 |
| AI triage (summary, severity, duplicates, repro steps, translation) | F-110–F-114 | ⬜ | WP-27 |
| Slack (interactive), Teams, Telegram, ntfy, Linear, Jira | F-071–F-079 | ⬜ | WP-16/17/25 |
| SSO, SCIM, audit log, custom roles | F-091–F-093 | ⬜ | WP-24 |
| Guest portal + review links for clients | F-012, 06 §7 | ⬜ | WP-20 |

## D. Parity gaps added to the spec by this review

New feature IDs created so nothing above is lost (full text in [01-feature-spec.md](01-feature-spec.md) §H):
F-015 right-click comment · F-016 panel actions · F-017 read-only widget · F-018 widget export ·
F-019 consent notice · F-020 custom email templates · F-021 EU privacy mode. They are built in **WP-30**
(widget parity extras) except where another WP is named above.

## E. How to keep this file true

Every work package that ships a row above must flip its status in the same commit. A row may only be marked ✅
when an automated test covers it (unit, integration, smoke or Playwright).
