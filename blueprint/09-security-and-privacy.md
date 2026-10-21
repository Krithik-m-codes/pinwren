# 09 — Security and privacy

## 1. Threat model (summary)

| Threat | Surface | Mitigation |
|---|---|---|
| Spam / abuse of the public widget endpoint | `/w/*` | Origin allowlist, per-IP + per-key rate limits, payload size caps, optional proof-of-work or Turnstile challenge after N submits, honeypot field, project "pause intake" switch |
| Stolen project key used from another site | `/w/*` | Key is public by design; `Origin`/`Referer` hostname checked; server-to-server misuse limited by rate limits; key rotation without downtime (old key valid for a configurable overlap) |
| XSS via feedback content (stored) | Dashboard, emails, widget panel, chat integrations | Markdown rendered with a strict allowlist sanitizer (no raw HTML); URLs restricted to http/https/mailto; screenshots and attachments served with `Content-Security-Policy: sandbox`, `X-Content-Type-Options: nosniff`, `Content-Disposition` for non-images; SVG uploads rejected or rasterised; Slack/Discord payloads escape mentions and markdown |
| Malicious uploads | `/w/uploads` | MIME sniffing (magic bytes), size caps, image re-encoding (strip EXIF / polyglots), random storage keys, never served from the app origin's root path |
| SSRF via capture proxy | `/w/proxy` | Only image/font MIME, only hosts on the project's declared allowlist, resolved IP must not be private/link-local/loopback, size and time caps |
| Cross-tenant data access (Cloud) | All tenant queries | Org scoping in every query helper + Postgres RLS + automated tests that run every endpoint as a user of another org |
| Session theft / CSRF | `/api` | `HttpOnly; Secure; SameSite=Lax` cookies, CSRF double-submit header on mutations, session rotation on privilege change, optional IP/device binding, passkeys |
| Credential stuffing | Login | Rate limits, breached-password check (k-anonymity HIBP API, optional/offline-friendly), passkeys/2FA (TOTP) |
| Secret leakage | Integration tokens, SMTP passwords | AES-256-GCM encryption at rest with key IDs; never returned by the API (write-only fields); redacted in logs |
| Webhook spoofing (inbound) | Provider webhooks | Signature verification per provider, timestamp tolerance, replay protection by delivery ID |
| Supply chain | Dependencies, image | Lockfile, Renovate with grouped updates, `pnpm audit` gate, SBOM + cosign signing, minimal base image |
| Host-page breakage | Widget | Isolation rules in 05, global error guard, kill switch (`/w/config` can disable a widget version remotely in Cloud) |

## 2. Privacy by design

- **Masking defaults:** password, credit-card autocomplete fields and `[data-pinwren-mask]` are always masked in screenshots and replay; replay masks *all* inputs by default.
- **Minimisation:** network bodies are never captured unless explicitly enabled; query strings redacted for sensitive keys; IP addresses stored truncated (/24 IPv4, /48 IPv6) unless the admin opts in.
- **Consent hooks:** `Pinwren.setConsent({ replay: false })` lets sites wire Pinwren into their CMP; replay and diagnostics stay off until granted when `requireConsent: true`.
- **Reporter rights:** GDPR erase/export by email (admin action + API); retention policies per project.
- **EU mode:** Cloud EU region keeps data and backups in the EU; DPA template and sub-processor list published.
- **AI:** off by default; screenshots/replay never sent to a model unless the admin enables it per project; prompts and responses logged in the audit trail; zero-retention provider settings documented.

## 3. Compliance roadmap

| Item | When |
|---|---|
| Security policy (`SECURITY.md`), private vulnerability reporting | Phase 1 |
| Third-party pentest of widget + API | Before Cloud GA |
| SOC 2 Type I → Type II (Cloud) | Year 1–2, triggered by enterprise demand |
| Accessibility conformance report (VPAT) | Before Enterprise GA |

## 4. Security headers (dashboard)

`Content-Security-Policy` (strict, nonce-based, no `unsafe-inline` scripts), `Strict-Transport-Security`, `X-Frame-Options: DENY` (except guest portal embedding if configured), `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` minimal, `Cross-Origin-Opener-Policy: same-origin`.
