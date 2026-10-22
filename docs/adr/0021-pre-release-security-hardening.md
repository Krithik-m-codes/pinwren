# ADR 0021: Pre-release security hardening (outbound guard, client address, first-run admin, CSRF/CSP, caps)

**Status:** accepted. Amends blueprint 09 §1 (CSRF: an Origin check instead of a double-submit header) and
§4 (CSP: no script nonces). Supersedes ADR 0014's "first user who signed up is the instance admin" rule.

## Context

An independent review before the first release found:

- **SSRF that reads responses.** Webhooks, webhook panel actions and tracker base URLs could reach internal
  addresses, and the test endpoints sent the response body back.
- **Rate limits keyed on client-chosen headers.** The first X-Forwarded-For entry and X-Real-IP were trusted.
- **The first account to sign up became instance admin.**
- **Mail and invitation relays.**
- **Unbounded public request bodies.**
- **No CSRF check and no CSP on the dashboard.**
- **Smaller issues:** unsafe `href`s, a gzip bomb in the replay viewer, deleted threads still served to
  the widget, inbound webhook replay, chat webhook URLs stored in clear text, and CSV injection.

## Decision

1. **One outbound guard** (`packages/api/src/outbound/`). Every request to a URL a user entered goes through
   `safeFetch`, which:
   - resolves the host once and checks every resolved address;
   - connects to exactly the address it checked (Node's `lookup` hook), so DNS rebinding can't swap it;
   - never follows redirects;
   - has a timeout and a response size cap;
   - rejects only with a short error category.

   **Refused ranges:** loopback, RFC 1918, CGNAT, link-local and metadata, ULA, site-local and multicast,
   documentation and reserved ranges. IPv6 forms that embed an IPv4 address (mapped, NAT64, 6to4) are judged by
   that IPv4 address.

   **Exceptions:**
   - `PINWREN_OUTBOUND_ALLOWLIST` (host names, `*.domain`, CIDRs) admits internal targets. Self-hosters often
     run GitLab or Mattermost on private addresses.
   - `PINWREN_OUTBOUND_ALLOW_PRIVATE=true` allows every address, for development only. It is off by default.
   - Operator-set URLs (`GITHUB_API_URL`, `GITLAB_URL`, the release check) are trusted. SMTP and S3 hosts come
     from the instance admin or the environment and are out of scope.

   **No response bodies are shown.** Webhook attempts store only the status and an error category, and the
   API returns `responseBody: null`. Tracker errors echo only the tracker's JSON `message`. Panel actions show a
   `{message}` only from a 2xx response.

   **Project configuration is admin-only.** `PATCH /api/projects/:id`, project key rotation, panel actions,
   trackers and secrets are for org admins only.

2. **Client address.** `PINWREN_TRUST_PROXY` is a hop count (`true` = 1). The client is the X-Forwarded-For entry
   that many hops from the right. X-Real-IP is never read. With no trusted hop, forwarded headers are ignored.

   Next.js route handlers can't see the socket, so the instrumentation hook patches `http.Server` to stamp each
   request with its peer address. The header name is random per process, so no client can forge it. This works
   for `next dev`, `next start` and the standalone Docker server; without it the address is `"unknown"`.

   Better Auth's limiter reads only a header the API sets from the same logic. It is enabled in every
   environment. Its counters live in Postgres (`auth_rate_limit`, added after this ADR), so every cluster
   worker and replica shares one allowance — in memory, each worker granted its own.

   Per-project caps hold however many addresses send: `WIDGET_PROJECT_REPORTS_PER_MIN` (120) and
   `WIDGET_PROJECT_MB_PER_HOUR` (500, counting stored files).

3. **First-run admin.** An instance admin is either listed in `PINWREN_ADMIN_EMAILS` or claimed with a one-time
   setup token. While no admin exists, each server start prints a new token to the log; only its SHA-256 hash is
   stored. A signed-in user claims it at `/setup` (`POST /api/setup/claim`), behind an advisory lock and a rate
   limit, after which all tokens are dropped.

   Sign-up rules:
   - The first account can always be created.
   - Invited emails can always sign up.
   - Anyone else only with `PINWREN_DISABLE_SIGNUP=false` explicitly (the default changed from "open").

4. **Relays.** Template test emails go only to the caller's own address, at most 10 an hour per user and 30 per
   org. Invitations are limited to `PINWREN_INVITES_PER_HOUR` (30) per org.
5. **Bodies.** All limits are enforced while the body streams in, before any parsing:
   - `/api` and `/mcp`: 2 MB.
   - Widget reports: 48 MB. They must send a Content-Length, and are rate-limited first.
   - Widget replies and status changes: 64 KB, also rate-limited first.
   - Inbound tracker webhooks: 1 MB, after a per-address limit.
6. **CSRF and content type.** A cookie-carrying write to `/api` must come from our origin: Origin equal to
   `PINWREN_URL`, or `Sec-Fetch-Site: same-origin`. A cross-site request, or one with neither header, is refused.
   This replaces blueprint 09's double-submit header, which needs client plumbing and protects no better against a
   same-origin attacker. JSON routes refuse other content types with 415.

   Exempt: `/api/v1`, `/mcp`, `/w`, inbound webhooks, and the content-type check for Better Auth and one-click
   unsubscribe.

7. **CSP without nonces.** Next.js applies nonces only while rendering a request. The dashboard's static shells
   (Cache Components, ADR 0020) are prerendered, so their inline bootstrap and flight-data scripts can't carry a
   nonce. The Next.js 16 CSP guide states that partial prerendering is incompatible with nonces. Its alternative,
   SRI, only covers external files and still needs `'unsafe-inline'` for those inline scripts.

   We keep the static shells and send a fixed policy:
   - `script-src 'self' 'unsafe-inline'`;
   - no third-party origin for anything;
   - `img/font/media 'self' data: blob:`;
   - `object-src 'none'`, `base-uri 'none'`, `form-action 'self'`, `frame-ancestors 'none'`;
   - plus COOP and Permissions-Policy.

   XSS defence rests on React escaping, the Markdown sanitiser and `safeHref`. rrweb's `about:blank` replay iframe
   inherits this policy, so a replay can't load remote resources.

   Revisit this if Next.js ships nonce support for prerendered shells.

8. **Smaller fixes:**
   - `page.url` is http(s) only, and every untrusted `href` goes through `safeHref`.
   - The replay viewer stops inflating at 64 MB.
   - The widget hides threads of deleted items.
   - Inbound GitHub and GitLab deliveries are remembered by delivery id (or body hash) for 7 days.
   - Slack and Discord URLs are encrypted at rest; existing rows are encrypted at startup, and the API only ever
     returns them masked.
   - Webhook action URLs are hidden from non-admins; viewers don't see team-only actions.
   - The CSV export neutralises formulas behind whitespace, tabs and line breaks.
   - Failed Bearer tokens are limited to 20 per address per 10 minutes, across `/api/v1` and `/mcp`.
9. **Licence keys.** `docker/check-release-keys.mjs` fails a release build (`PINWREN_RELEASE=1`) while
   `PRODUCTION_KEYS` is empty, and a production server logs it at start. The owner's steps are in
   `docs/release/licence-keys.md`.

## Consequences

- **Self-hosters:**
  - Must set `PINWREN_TRUST_PROXY` to their real proxy count.
  - Must list internal webhook or tracker hosts in `PINWREN_OUTBOUND_ALLOWLIST`.
  - Must set `PINWREN_ADMIN_EMAILS` or claim `/setup`.
  - Must set `PINWREN_DISABLE_SIGNUP=false` if they want open sign-up.
- **Members** (non-admins) now see project settings read-only.
- **Webhook logs** no longer show receiver responses.
- **Smoke and e2e** start the server with `PINWREN_DISABLE_SIGNUP=false PINWREN_OUTBOUND_ALLOWLIST=127.0.0.1`, and
  Playwright's API client sends an Origin header.
