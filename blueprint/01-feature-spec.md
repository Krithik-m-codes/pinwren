# 01 — Feature specification

Legend for **Edition**: **C** = Community (free self-host), **E** = Enterprise self-host licence, and Cloud plans **F** Free, **P** Pro, **B** Business, **X** Cloud Enterprise. "All" = every edition and plan. The authoritative matrix is in [07-licensing-and-pricing.md](07-licensing-and-pricing.md); this file defines behaviour.

Each feature has an ID (`F-xxx`) used by the roadmap and build prompts.

---

## A. Widget — capture

### F-001 Launcher
- Floating button (position: 4 corners, offset configurable), keyboard shortcut (default `Alt+Shift+F`), or fully hidden with a JS API `annota.open()` for custom triggers.
- Brandable colours, icon, label, shape; light/dark/auto theme. Respects `prefers-reduced-motion`.
- **Acceptance:** renders inside a closed Shadow DOM; zero CSS leaks either way (verified by visual-regression test against a page with aggressive global CSS such as `* { all: unset }`).

### F-002 Comment mode (anchored pins) — *All*
- Hover highlights the element under the cursor (outline + label `tag.class`); click pins at that point; drag draws a region; text selection pins to a text range.
- Composer: rich-ish text (bold, italic, code, links, lists, @mentions for team users), attachments (images/files ≤ 10 MB), category (comment / bug / idea / question), optional priority.
- The pin stores an **anchor bundle** (see F-030) plus position as % of the anchor element's box.
- Existing pins render as numbered markers on the page; clicking opens the thread in a side panel.
- **Acceptance:** pins stay visually attached through scroll, resize, breakpoint change, and DOM re-render (React/Vue hydration); pins whose anchor cannot be found are listed in the panel under "Couldn't place on this page" with a screenshot thumbnail, never dropped.

### F-003 Report mode (bug report) — *All*
- One click captures the visible viewport (or a selected element / full page, configurable).
- Opens the annotation editor (F-004), then a form: title (optional, auto-suggested), description, severity, reporter name/email (optional, remembered), attachments.
- Attaches automatically: URL, page title, viewport, device pixel ratio, browser, OS, locale, timezone, referrer, custom metadata (F-008), console buffer (F-005), network failures (F-006), replay buffer if enabled (F-007).
- **Acceptance:** submitting works offline (queued, F-010); capture of a 1440×900 typical marketing page completes in < 1.5 s on a mid-range laptop.

### F-004 Annotation editor — *All*
- Tools: arrow, rectangle, ellipse, highlighter, freehand pen, text, numbered step markers, **blur/pixelate** (privacy), crop.
- Undo/redo, colour palette (5 swatches + custom), stroke width, keyboard shortcuts, touch support.
- Output: flattened PNG/WebP **and** a vector layer (JSON) so the dashboard can toggle annotations on/off.
- **Acceptance:** works on touch devices; editor chunk lazy-loaded (not in core bundle).

### F-005 Console capture — *All (opt-in per project, default on for errors)*
- Ring buffer of last N (default 100) console entries: `error`, `warn` (default), optionally `log/info/debug`; uncaught errors and unhandled rejections with stack.
- Serialises arguments safely (depth/size limits, circular-safe), redacts per F-040.

### F-006 Network capture — *All (opt-in per project, default failures only)*
- Wraps `fetch` and `XMLHttpRequest`: method, URL (query redacted per rules), status, duration, size; bodies **never** captured by default; opt-in body capture for same-origin with size cap and redaction.
- **Acceptance:** wrapping is transparent (no behaviour change; verified with a test suite of fetch edge cases: streams, aborts, keepalive, `Request` objects).

### F-007 Session replay buffer — *C, E, P, B, X (not F)*
- rrweb-based rolling buffer of the last 30 s (configurable up to 120 s), recorded only while the widget is enabled on the page; flushed only when a report is submitted.
- Privacy: masks all inputs by default, honours `data-annota-mask`, `data-annota-block`, and per-project selector lists.
- Lazy-loaded; recording starts after `requestIdleCallback`; can be disabled per project or per page.
- **Acceptance:** CPU overhead < 3 % on a reference SPA; buffer memory capped (default 5 MB).

### F-008 Identify & metadata API — *All*
- `annota.identify({ id, name, email, avatar })` pre-fills reporter identity (signed identity via HMAC optional, F-041).
- `annota.setMetadata({ plan: 'pro', build: 'a1b2c3' })` attached to every report.
- `annota.setPageScope({ urlPattern: '/products/:id' })` groups pins across dynamic URLs.

### F-009 Guest identity
- Anonymous reporters may optionally give a name/email; stored in localStorage per project. "My feedback" filter in the widget panel uses a locally remembered list of IDs (no server-side enumeration).

### F-010 Offline queue & retries
- IndexedDB queue; exponential backoff; idempotency via client-generated `clientId` (UUIDv7); dedupe on server.

### F-011 Widget panel
- Side panel listing feedback for the current page (and, toggled, the whole project if the project allows public read): filters (open/resolved/mine), search, thread view, reply, resolve/reopen (if permitted).
- Deep link: `?annota=<feedbackId>` opens the page, scrolls to and pulses the pin.

### F-012 Visibility rules — *All*
- Show widget: always / only for identified users / only when `?annota` query param present / only on listed URL patterns / only on staging hostnames / via JS `annota.show()`.
- "Review links": the dashboard generates a URL with a short-lived token that enables the widget for a guest on a site where it is otherwise hidden.

### F-013 Localisation — *All*
- Widget and emails in en, es, fr, de, pt-BR, it, ja, hi at launch (structure allows community locales). RTL support (ar, he) in Phase 3.

---

## B. Anchoring engine

### F-030 Anchor bundle (capture side)
For the target element, store all of:
1. Robust CSS selector (shortest unique, avoiding hashed class names like `css-1x2y3z`, `sc-*`, Tailwind arbitrary values).
2. XPath (positional fallback).
3. `data-annota-anchor` / `data-testid` / `id` / `aria-label` / `name` if present (highest priority).
4. Text fingerprint: element's normalised text (≤ 120 chars), text before/after (≤ 32 chars each), tag, role.
5. Structural fingerprint: tag path depth, sibling index, a hash of child tag sequence.
6. Geometry: bounding box at capture (page coords + viewport size), offset of the pin as % of the box.
7. Page scope: URL, optional `urlPattern`.

### F-031 Re-attach algorithm (render side)
Strategies in order, first confident hit wins; each yields a confidence score:
1. Explicit anchor attributes → 1.0
2. CSS selector unique match whose text fingerprint similarity ≥ 0.6 → 0.9
3. XPath match with text similarity ≥ 0.6 → 0.8
4. Fuzzy search: candidate elements with same tag; score = 0.5·textSimilarity + 0.2·neighbourSimilarity + 0.2·structuralSimilarity + 0.1·geometryProximity; best ≥ 0.65 → that score
5. Otherwise **orphaned**.
- Pins with confidence < 0.8 render with a "moved?" badge; team users can "re-pin" (drag to correct element), which updates the bundle and keeps history.
- **Acceptance:** an automated fixture suite of 30 page mutations (class renames, reordering, wrapper divs, text edits, responsive layout) meets the ≥ 90 % re-attach target from 00.

### F-032 Responsive & dynamic content
- Recompute marker positions on resize/scroll via `ResizeObserver` + `IntersectionObserver` + throttled `MutationObserver`; pins inside hidden/collapsed elements show a ghost marker at the nearest visible ancestor.

---

## C. Inbox & collaboration (dashboard)

### F-050 Inbox — *All*
- Unified list of comments and bug reports; columns/rows configurable; group by status/assignee/page/priority.
- Filters: project, type, status, priority, assignee, label, reporter, page URL, date, has-replay, browser; full-text search (Postgres FTS).
- Saved views (personal and shared).
- Keyboard: `j/k`, `enter`, `e` resolve, `a` assign, `l` label, `p` priority, `/` search, `?` shortcuts, `cmd+k` command palette.
- Real-time updates (SSE): new items slide in; presence avatars on an open item.

### F-051 Item detail
- Screenshot viewer with annotation layer toggle, zoom/pan; replay player (rrweb-player) synced with console/network timeline; metadata panel; thread with internal notes (team-only) vs public replies (visible to the reporter in the widget).
- Actions: status (open, in progress, in review, resolved, won't fix, duplicate), priority (none, low, medium, high, urgent), assignee(s), labels, due date, link duplicates, convert comment ↔ bug, "Open on page", copy as Markdown, send to tracker.

### F-052 Board view — *All*
- Kanban by status with drag and drop.

### F-053 Page view — *All*
- Pick a page URL → see an embedded, scaled screenshot gallery of all pins on that page (static, from captures) for a "review round" overview.

### F-054 Notifications — *All*
- Per-user preferences per project: new item, assigned to me, mentioned, status change on items I follow; channels: email, in-app; digest option (hourly/daily).
- Reporter notifications (opt-in per project, default **off**): confirmation, status changes, replies.

### F-055 Review rounds — *All*
- Group feedback into a named round (e.g. "Homepage v2 — client review 1") with a deadline; round progress bar; export round as PDF/CSV.

### F-056 Duplicate detection — *All (basic), AI-assisted C/E/P/B/X*
- Basic: same page + same anchor + similar text → suggestion.
- AI: embeddings-based similarity across the project (BYO key in self-host; included quota in Cloud).

---

## D. Routing & integrations

| ID | Integration | Direction | Edition |
|---|---|---|---|
| F-070 | Email (SMTP or Resend/Postmark API) | out | All |
| F-071 | Slack (OAuth app; channel per project; interactive buttons: assign/resolve) | out + actions | All |
| F-072 | Discord (webhook) | out | All |
| F-073 | Microsoft Teams (workflow webhook) | out | All |
| F-074 | Telegram (bot) and ntfy | out | All |
| F-075 | Generic webhooks (HMAC-SHA256 signed, retries with backoff, delivery log, replay) | out | All |
| F-076 | GitHub Issues (App install; two-way status sync; screenshot embedded) | two-way | All |
| F-077 | GitLab Issues | two-way | All |
| F-078 | Linear | two-way | All |
| F-079 | Jira Cloud / Data Center | two-way | E, B, X |
| F-080 | MCP server (tools: list/search/get/update feedback, get replay summary, reply, resolve) | in | All |
| F-081 | Public REST API + personal/API tokens (scoped) | in/out | All (rate-limited on F) |
| F-082 | Zapier / Make / n8n via webhooks + REST | — | All |

**Acceptance (all integrations):** a failing integration never blocks report submission; every outbound delivery is logged with status and retry; secrets are encrypted at rest (F-042).

---

## E. Workspace & administration

### F-090 Organisations, projects, members — *All*
- Org → projects. Roles: owner, admin, member, viewer, guest (guests = client reviewers, free and unlimited).
- Per-project: allowed origins (hostname patterns with wildcards), public-read toggle, widget config, capture defaults, retention.

### F-091 Authentication — *All*
- Email + password, magic link, passkeys, Google/GitHub OAuth (configurable in self-host).
- **SSO (SAML 2.0 / OIDC), SCIM provisioning, enforced SSO, domain capture** — *E, X*.

### F-092 Audit log — *E, B (30 days), X*
- Every admin/security action; export; SIEM webhook (E, X).

### F-093 Custom roles & granular permissions — *E, X*

### F-094 White-label — *E, B, X*
- Remove "Powered by", custom widget domain (CNAME), custom email sender/domain, custom dashboard logo/colours, custom guest portal domain.

### F-095 Data retention & export — *All (policy), E/X (legal hold)*
- Per-project retention (default: never delete in self-host; plan-based in Cloud); full export (JSON + assets zip); GDPR delete by reporter email.

### F-096 Storage drivers — *All*
- Local filesystem (default self-host), any S3-compatible (AWS, R2, MinIO, RustFS, B2), with signed URLs. **Free in Community** — explicitly unlike BugPin.

### F-097 Usage & billing — *Cloud only*
- Stripe Billing: plans, trials, seats/limits enforcement, invoices, customer portal, dunning; usage meters (reports/month, replay storage).

### F-098 Licence management — *E*
- Upload an Ed25519-signed licence file; offline verification; grace period; see 07.

---

## F. AI features (bring-your-own key in self-host, quota in Cloud)

| ID | Feature | Edition |
|---|---|---|
| F-110 | Auto title + summary for reports | C, E, P, B, X |
| F-111 | Severity / category suggestion | C, E, P, B, X |
| F-112 | Duplicate clustering (embeddings) | C, E, P, B, X |
| F-113 | "Reproduction steps" draft from replay events + console/network | C, E, B, X |
| F-114 | Translate feedback to the team's language | C, E, P, B, X |

All AI features are **off by default**, require an explicit provider configuration (Anthropic, OpenAI-compatible, or local via Ollama), never send screenshots or replay unless the admin opts in, and log every call in the audit trail.

---

## G. Explicit non-features for v1

Native mobile SDKs, public roadmaps/voting, heat maps, analytics, video recording of the screen (use replay instead), proxy-rendering third-party sites without a script, on-premise AI model hosting.
