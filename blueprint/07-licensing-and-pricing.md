# 07 — Licensing, editions and pricing

## 1. Licence structure (open core)

| Code | Licence | Rationale |
|---|---|---|
| `packages/widget`, `widget-react`, `sdk-js`, `mcp`, `anchoring`, `capture` | **MIT** | Embedded in customers' sites and tools — must carry no copyleft obligations |
| Everything else outside `ee/` (server, dashboard, db, integrations…) | **AGPL-3.0** | Free to self-host and modify; hosted forks must publish changes (protects Cloud) |
| `ee/` | **Commercial licence** (source-available; use requires a valid licence or Cloud subscription) | Funds the project; standard model (GitLab, Cal.com, Formbricks, Documenso) |

Rules:
- A contributor licence agreement (CLA, e.g. via CLA Assistant) is required for contributions so `ee/` relicensing stays possible.
- The Community edition must be **genuinely complete for a team**: nothing in the core may call into `ee/` to "nag" or degrade.
- Never move a feature from Community to `ee/` after release (trust rule). Movement is only `ee/` → Community.
- BugPin's code is AGPL-3.0 and must not be copied (we would be bound to AGPL for the `ee/` parts it touches). SitePing is MIT — adaptations must keep its copyright notice in `THIRD_PARTY_NOTICES.md`.

Alternative considered: **FSL-1.1** (Functional Source License, converts to Apache/MIT after 2 years). Simpler but discourages contributors and some enterprises' legal teams. Revisit at 1.0 if AGPL creates friction.

## 2. What is free vs paid — the principle

> **Free:** everything a single team needs to collect, triage and route feedback, at any scale, on its own infrastructure.
> **Paid:** what an organisation needs to govern many teams (identity, compliance, branding, support) — and, in Cloud, the cost of us running it.

## 3. Edition / plan matrix

Prices are **proposals** to validate with 10–20 target customers before launch (anchored against Marker.io ~$39–199, Feedbucket ~$39–89, BugHerd ~$50–150, Gleap ~$149).

| | **Community** (self-host) | **Cloud Free** | **Cloud Pro** | **Cloud Business** | **Enterprise** (self-host or Cloud) |
|---|---|---|---|---|---|
| Price | $0 | $0 | **$29/mo** ($24 annual) | **$99/mo** ($79 annual) | From **$4,000/yr** (self-host) · custom (Cloud) |
| Team seats | Unlimited | 3 | 10 (+$6/seat) | 30 (+$5/seat) | Unlimited / per contract |
| Guests (clients) | Unlimited | Unlimited | Unlimited | Unlimited | Unlimited |
| Projects | Unlimited | 1 | 10 | Unlimited | Unlimited |
| Reports / month | Unlimited | 100 | 2,000 | 20,000 | Contract |
| Retention | You decide | 30 days | 1 year | 3 years | Custom + legal hold |
| Comment pins, bug reports, annotation editor | ✓ | ✓ | ✓ | ✓ | ✓ |
| Console + network capture | ✓ | ✓ | ✓ | ✓ | ✓ |
| Session replay | ✓ | — | 30 s, 30-day replay retention | 120 s, 90-day | ✓ |
| Email, Slack, Discord, Teams, Telegram, ntfy, webhooks | ✓ | Email + 1 chat | ✓ | ✓ | ✓ |
| GitHub, GitLab, Linear two-way sync | ✓ | — | ✓ | ✓ | ✓ |
| Jira | — | — | — | ✓ | ✓ |
| MCP server + REST API | ✓ | API read-only | ✓ | ✓ | ✓ |
| AI features | BYO key | — | 500 calls/mo | 5,000 calls/mo | BYO or contract |
| Storage | Local disk or any S3 | Included | Included | Included | Customer bucket option |
| "Powered by Pinwren" removal / white-label | — | — | Remove badge | Full white-label | ✓ |
| Audit log | — | — | — | 30 days | ✓ + SIEM stream |
| SSO (SAML/OIDC), SCIM, enforced SSO | — | — | — | — | ✓ |
| Custom roles | — | — | — | — | ✓ |
| Support | Community (GitHub Discussions) | Community | Email | Priority email | SLA, dedicated channel |

Additional Cloud add-ons: extra reports packs, extra replay retention, EU or US data residency (Business+), annual invoicing (Business+).

## 4. Self-host licence keys (Enterprise)

**Format:** a JSON payload + detached **Ed25519** signature, distributed as a single `.lic` text file (base64url `payload.signature`).

```json
{
  "lid": "lic_01J…", "customer": "Acme GmbH", "email": "it@acme.example",
  "edition": "enterprise",
  "features": ["sso","scim","audit_log","custom_roles","white_label","jira","legal_hold","siem_stream","priority_support"],
  "limits": { "seats": 250 },
  "instance": null,                 // optional binding to an instance ID
  "issuedAt": "2026-11-01T00:00:00Z", "expiresAt": "2027-11-01T00:00:00Z",
  "graceDays": 30, "v": 1
}
```

- Public verification key(s) compiled into `ee/licensing`, with key IDs for rotation.
- **Offline verification only** — no phone-home required (air-gapped friendly). Optional anonymous usage ping is opt-in.
- Expiry behaviour: `expiresAt` → banner for `graceDays` → `ee` features become **read-only** (e.g. SSO keeps working for login — never lock users out; audit log stays readable; no new custom roles). Data is never deleted or hidden.
- Seat limit exceeded → warning banner + admin email; never blocks logins.
- Licence issuance: an internal `apps/licensing-admin` script (Phase 4) signs licences with a private key kept in a hardware/KMS-backed secret, triggered by Stripe invoice payment for self-host Enterprise customers.

## 5. Cloud billing (Stripe)

- Products/prices defined in code (`ee/billing/plans.ts`) and synced to Stripe by a script — single source of truth for limits.
- Checkout → `checkout.session.completed` webhook → org plan update; Customer Portal for card/plan changes; `invoice.payment_failed` → 14-day dunning with in-app banner, then downgrade to Free (data kept, over-limit projects become read-only).
- Limits enforced server-side via `usage_counter`; soft limit at 100 % (banner), hard limit at 120 % for reports (widget shows a polite "feedback temporarily unavailable" and queues locally).
- Taxes via Stripe Tax; invoices in USD and EUR (INR optional for India-based customers).

## 6. Open-source health

- Public roadmap and changelog; semantic versioning; LTS policy (latest two minors receive security fixes).
- Telemetry in self-host: **off by default**, opt-in during onboarding, documented payload (version, edition, counts — no content).
