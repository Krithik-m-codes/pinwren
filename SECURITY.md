# Security policy

Pinwren runs on other people's websites (the widget) and holds their feedback, screenshots and console
output (the server). We take reports seriously and will work with you to fix and disclose them.

## Supported versions

Pinwren is pre-1.0. Security fixes land on the latest minor release of the server image and of
`@pinwren/widget`; please upgrade to it before reporting.

| Version                    | Supported |
| -------------------------- | --------- |
| Latest `0.x` minor release | ✅        |
| Older releases             | ❌        |

## Reporting a vulnerability

**Please do not open a public issue, discussion or pull request for a vulnerability.**

Report it privately through GitHub:
[open a private vulnerability report](https://github.com/Krithik-m-codes/pinwren/security/advisories/new).
Only the maintainers can see it, and we coordinate the fix, the advisory and the credit with you there.

Please include:

- what an attacker can do, and who is affected (site visitors, workspace members, instance admins);
- the component and version (widget, dashboard, API, Docker image) and how Pinwren was deployed;
- steps or a proof of concept that reproduces it — against your own instance, never someone else's;
- any suggested fix.

## What to expect

| Step                          | Target                                                  |
| ----------------------------- | ------------------------------------------------------- |
| Acknowledgement               | within 3 working days                                   |
| Assessment and severity       | within 7 days                                           |
| Fix released                  | critical and high within 30 days; others within 90 days |
| Public advisory (GitHub, CVE) | when the fix is released, or as agreed with you         |

We follow coordinated disclosure: please give us the time above before publishing, and we will credit you in
the advisory and release notes unless you prefer to stay anonymous. Good-faith research that respects this
policy, avoids privacy violations and service disruption, and only touches your own instance is welcome; we
will not pursue legal action over it.

## Scope

In scope: everything in this repository — the server and dashboard (`apps/web`, `packages/api`,
`packages/core`, `packages/db`), the widget (`packages/widget` and the published `@pinwren/widget`), and the
Docker image and compose files. Especially interesting:

- anything that lets the widget break, read from or inject into the host page beyond its Shadow DOM;
- cross-tenant access between workspaces or projects;
- authentication, session or API-token bypasses; privilege escalation between roles;
- stored XSS through feedback text, names, URLs or metadata in the dashboard, emails, chat messages or
  issue bodies;
- SSRF through webhooks, issue-tracker URLs or the update check;
- secrets or personal data exposed in the browser, logs, exports or screenshots that should be masked.

Out of scope: findings that need an already compromised admin account or server; missing hardening
headers without a demonstrated impact; denial of service by sheer request volume; vulnerabilities in
dependencies without a path to exploit them through Pinwren (report those upstream — Dependabot tracks
them here).

## Hardening checklist for self-hosters

- **Use a long random `PINWREN_SECRET`** (`openssl rand -base64 48`) and keep it out of version control. It
  signs sessions and encrypts stored credentials such as the SMTP password and tracker tokens.
- **Serve over HTTPS** behind a reverse proxy, set `PINWREN_TRUST_PROXY=true` only when that proxy sets the
  `X-Forwarded-*` headers, and consider `PINWREN_ENFORCE_HTTPS=true`.
- **Limit each project's allowed sites** to the origins that really embed the widget. The project key is
  public by design; the origin allowlist and rate limits (`WIDGET_RATE_LIMIT_PER_MIN`, or per project) are
  what protect ingest.
- **Close sign-up** with `PINWREN_DISABLE_SIGNUP=true` once your team has accounts, and invite everyone
  else.
- **Keep uploads private.** Screenshots and attachments are served only to signed-in members; with
  `STORAGE_DRIVER=s3`, keep the bucket private too. Brand logos are public by random id.
- **Turn on privacy mode** for projects whose pages show personal data, and mark sensitive elements with
  `data-pinwren-mask` so they are blocked out of every capture.
- **Mind where integrations send data.** Issue sync and webhooks copy feedback text and links into other
  systems; use private repositories and scope tracker tokens to one repository.
- **Upgrade promptly** — Settings › Security shows when a new version is available — and back up the
  `pinwren-db` and `pinwren-data` volumes.
