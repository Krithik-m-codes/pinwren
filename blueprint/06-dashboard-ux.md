# 06 — Dashboard UX and design system

## 1. Design direction

**"Calm, dense, fast."** Reference points: Linear (speed, keyboard, density), Vercel dashboard (clarity, typography), Raycast (command palette). Not a marketing page — a tool used for hours.

- **Typography:** Inter Variable (UI) + JetBrains Mono (code, selectors, IDs). Scale: 12 / 13 / 14 (base) / 16 / 20 / 24 / 32. Tabular numerals for counts and tables.
- **Colour:** neutral zinc scale; one accent (default indigo `#5B5BD6`, org-customisable); semantic tokens for status (open = blue, in progress = amber, in review = violet, resolved = green, won't fix = zinc, duplicate = zinc-dashed) and priority (urgent = red, high = orange, medium = yellow, low = slate). All colours defined as CSS variables with light and dark values; contrast checked in CI (axe).
- **Density:** 32 px list rows (compact) / 40 px (comfortable), user-toggle.
- **Motion:** 120–180 ms ease-out for panels and list inserts (Motion), disabled under `prefers-reduced-motion`.
- **Components:** shadcn/ui on Base UI primitives in `packages/ui`. **No browser-native pickers or controls** (date, select, colour, file) — use the design-system components everywhere.
- **Empty, loading, error states** designed for every screen; skeletons not spinners for lists; optimistic updates with undo toasts (`u` / toast button).

## 2. Information architecture

```
Org switcher ─┬─ Inbox (all projects)           ← default landing
              ├─ My work (assigned / mentioned / following)
              ├─ Projects ─┬─ <Project> ─┬─ Feedback (list | board)
              │            │             ├─ Pages
              │            │             ├─ Rounds
              │            │             ├─ Install (snippet + verify)
              │            │             └─ Settings (widget, capture, privacy, integrations, labels, members)
              ├─ Views (saved)
              ├─ Settings ─┬─ Profile, notifications, API tokens
              │            ├─ Members & roles, guests
              │            ├─ Integrations, webhooks
              │            ├─ Branding / white-label (ee)
              │            ├─ Security: SSO, SCIM, audit log (ee)
              │            ├─ Instance (self-host admin): email, storage, AI, licence
              │            └─ Billing (Cloud)
              └─ ⌘K command palette (everything above + actions)
```

## 3. Key screens

### 3.1 Inbox (list)

- Left: collapsible sidebar (projects, views, counts). Centre: list with grouping headers. Right: detail drawer (opens without losing list position; `Esc` closes).
- Row: status icon, `#number`, kind icon, title/first line, page path chip, labels, assignee avatars, replay/console badges, relative time. Hover reveals quick actions.
- Multi-select with `x` / shift-click → bulk bar (status, assign, label, delete).
- Filters as removable chips; "Save view" from any filter state.

### 3.2 Item detail

- Header: title (inline edit), status/priority/assignee/labels pickers, "Open on page", "Send to …", overflow menu.
- Media area tabs: **Screenshot** (annotation layer toggle, zoom, before/after if re-captured), **Replay** (rrweb-player with timeline markers for clicks, errors, failed requests; scrubbing syncs the console/network panes), **Attachments**.
- Context tabs: Console, Network (filter, copy as cURL with secrets redacted), Environment, Metadata, Anchor (selector, XPath, confidence history, "re-pin" button).
- Timeline: comments (public vs internal toggle with clear visual difference — internal notes on amber tint with a lock icon), activity events, integration sync events.
- Composer: Markdown with slash commands, @mentions, attachments, "Reply publicly" vs "Internal note" segmented control (default internal).

### 3.3 Board

Columns per status, cards with thumbnail, drag and drop with keyboard alternative (`m` → move to…).

### 3.4 Pages

Grid of page cards (thumbnail from the latest capture, open/resolved counts). Page detail shows the screenshot with all pins overlaid at their captured positions, clickable to open items.

### 3.5 Install & verify

- Snippet with copy button, framework tabs (HTML, React/Next, Vue/Nuxt, WordPress, Webflow, Shopify, Google Tag Manager).
- **Live verification:** "Waiting for first ping from https://… " → turns green when the widget loads on an allowed origin (widget sends a `/w/config` hit; dashboard listens via SSE).
- Origin allowlist editor with wildcard preview.

### 3.6 Onboarding (first run)

Self-host first run: create admin → name org → create first project (origin) → install snippet → verify → configure email (optional, testable) → invite team. Cloud: same flow after sign-up, plus plan picker deferred until limits are hit.

### 3.7 Settings pages

Every setting has a short explanation, a default, and immediate validation. Settings locked by environment variables show the variable name and are read-only.

## 4. Real-time & collaboration

- SSE stream updates lists in place; a subtle "3 new items" pill when the user has scrolled.
- Presence: avatars of teammates viewing the same item; soft-lock hint when someone is typing a reply.

## 5. Keyboard map (shown on `?`)

| Key                 | Action                         |
| ------------------- | ------------------------------ |
| `⌘K`                | Command palette                |
| `j / k`, `↑ / ↓`    | Move selection                 |
| `Enter` / `o`       | Open item                      |
| `Esc`               | Close drawer / clear selection |
| `x`                 | Select                         |
| `e`                 | Resolve / reopen               |
| `s`                 | Status menu                    |
| `p`                 | Priority menu                  |
| `a`                 | Assign menu                    |
| `l`                 | Labels menu                    |
| `c`                 | Comment                        |
| `/`                 | Search                         |
| `g i`, `g m`, `g p` | Go to Inbox, My work, Projects |
| `u`                 | Undo last change               |

## 6. Responsive

Dashboard is fully usable at 375 px: list → full-screen detail navigation, bottom action bar, filters in a sheet. Tested at 375, 768, 1280, 1920.

## 7. Guest portal (client reviewers)

Guests invited by email or review link get a minimal portal: their submitted items, replies, statuses — no team UI, no internal notes. Branded with the org's white-label settings where entitled.
