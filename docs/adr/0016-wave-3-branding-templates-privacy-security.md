# ADR 0016 — Wave 3: branding, email templates, privacy mode, panel actions, instance security

**Status:** accepted

## Context

Wave 3 closes the remaining SitePing/BugPin gaps on the server and dashboard (contract `docs/contracts/wave-3.md`).
Several details were left open by the blueprint.

## Decision

1. **Brand assets are public by random id.** Logos (`brand_asset`, PNG/JPEG/WebP ≤ 512 KB, magic-byte checked, no
   SVG) are served at `GET /api/brand-assets/:id` without a session, `Cross-Origin-Resource-Policy: cross-origin`,
   sandbox CSP. Emails and the widget on customers' sites must load them; a logo is not secret. Feedback assets stay
   session-only. Org branding (product name, accent, logo) lives in `org_setting` (key `branding`); the dashboard
   applies the accent by overriding `--primary`/`--ring` with a validated hex. Project widget branding is a
   `project.widget_branding` column returned top-level from `/w/config`.
2. **Email templates are Markdown rendered by our own minimal renderer** (`packages/api/src/email/markdown.ts`):
   the source is HTML-escaped first, so only tags the renderer writes can appear; `{{variables}}` are inserted after
   parsing, escaped, so user values can't add formatting, links or markup; links must be http(s)/mailto. Saving
   rejects unknown variables (`400 UNKNOWN_VARIABLE`). Overrides are per org (`email_template`); the defaults live in
   code. No React Email dependency — the layout is one inline-styled table, as before.
3. **Privacy mode is a widget-config flag enforced on the server too**: `/w/config` forces consent and caps console
   capture; ingest drops non-error console entries and `metadata.performance` and reduces the user agent to the
   browser/OS family; rate-limit keys use the truncated IP (/24, /48); turning it on changes a "keep forever"
   retention to 90 days; while any non-archived project uses it, the instance update check does not run. Team
   members' session IPs (Better Auth) are not truncated — they are not visitor data.
4. **Panel actions** live in `widgetConfig.panelActions`. Webhook actions are dashboard-only and never sent to the
   widget (their URLs may be private). They are signed exactly like generic webhooks with a per-project secret
   (encrypted, revealable by org admins, rotatable, created on first use). Link URLs are templates with a fixed
   http(s) prefix; placeholders are URL-encoded on substitution.
5. **Instance security:** session lifetime is an instance setting (`ANNOTA_SESSION_DAYS` locks it). Better Auth's
   cookie lives up to 90 days with refresh disabled; a `session.create` hook stamps each new session's expiry, so
   the lifetime is a hard limit from sign-in and changes apply to new sessions. `ANNOTA_ENFORCE_HTTPS` is env-only
   (a DB toggle could lock admins out): the Next.js proxy and the Hono app redirect plain-HTTP GET/HEAD (308) and
   refuse other methods (403 `HTTPS_REQUIRED`), exempt localhost, honour `X-Forwarded-*` only with
   `ANNOTA_TRUST_PROXY`, and send HSTS over https. The update check is a daily `update.check` job reading
   `GET {GITHUB_API_URL}/repos/{ANNOTA_UPDATE_REPO}/releases/latest` (5 s timeout, never throws); instance admins
   see "Update available" from `/api/me`.

## Consequences

- Anyone with a logo URL can fetch that logo (acceptable: it is shown in emails anyway).
- Email wording can't contain raw HTML; admins who need it would need a later, sanitiser-based feature.
- Shortening a session lifetime does not cut existing sessions short; sign everyone out to force it.
