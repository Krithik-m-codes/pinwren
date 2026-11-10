# ADR 0029 — Interactive Slack

**Status:** accepted

## Context

F-071 asks for Slack with channel routing and interactive buttons. Until now Slack was one-way: an incoming webhook
(`webhook_endpoint.kind = slack`) that posts a message and nothing else. The spec says "OAuth app". Pinwren is also
self-hosted, often behind a firewall, and multi-tenant in Cloud (`docs/security/cloud-tenant-isolation.md`), so the
design has to keep the tenant boundary, keep secrets encrypted like every other integration secret and keep Slack
outages away from the rest of the notification pipeline.

## Decision

1. **A Slack app per workspace, configured by pasting two credentials.** An admin creates the app from a manifest that
   Pinwren generates (shortcuts, `/pinwren`, scopes and the two request URLs from `PINWREN_URL`) and pastes its signing
   secret and bot token. No OAuth install flow: it would need a central Pinwren Slack app with a client secret, which a
   self-hosted instance cannot have, and it would make Cloud a single point of trust for every customer's Slack. The
   token is proven with `auth.test` before it is stored, and that call also returns the Slack team id.
2. **Storage.** Four tenant tables in migration `0014`: `slack_workspace` (one per organisation; encrypted signing
   secret and bot token via `encryptSecret`, `team_id` unique across organisations), `slack_route` (channel per project
   and event), `slack_user_link` (Slack user to member) and `slack_message` (the card posted per item and channel).
   All have a direct `org_id`, the `pinwren_tenant` policy and composite `(id, org_id)` foreign keys, and are in the
   tenant inventory. The feedback source enum gains `slack`.
3. **Inbound requests are authenticated by the signing secret, found by team id.** `/api/slack/interactivity` and
   `/api/slack/commands` are `capability` routes outside the session. The team id in the (still untrusted) body selects
   a candidate workspace through the bootstrap role, which can read only `id`, `org_id`, `team_id`, `signing_secret`
   and `active`. The signature (`v0=` HMAC-SHA256 over `v0:<timestamp>:<raw body>`, constant-time compare) and a
   five-minute timestamp window are checked before anything else is read. An unknown or paused team, a wrong signature
   and a stale timestamp all answer 401, so team ids cannot be probed. After verification the workspace's `org_id` is
   the only tenant context; nothing in the payload can choose another organisation.
4. **Idempotency by Slack's ids.** Each verified request records its `trigger_id` (24 h) in the rate-limit table and a
   repeat is acknowledged without being processed. The capture modal derives the item's `client_id` from the Slack
   view id, so the existing `(project, client_id)` unique index makes a double submit a no-op even if the first
   attempt's record was lost.
5. **Act as the mapped member.** A Slack user is mapped once to a member by **confirmed** email: Slack's profile email
   from `users.info` against a `user.email_verified` member of that organisation (read through the identity role, as
   the tenant role cannot see the flag). Guests, bots and deactivated users never map. Otherwise the user gets an
   ephemeral message with a signed one-hour link (`/slack/link?token=`); opening it signed in shows who is asking and
   links only after the member presses a button (a link minted for an attacker's Slack user must not link itself). The
   member's role is checked with the existing permission matrix (`feedback.update`, `feedback.create`) and the change is
   made with `updateFeedback`, so timeline, events, webhooks, automation rules and realtime behave exactly as for the
   dashboard; the actor carries `via: slack`.
6. **Outbound is its own job.** The dispatcher enqueues `slack.deliver` per event after webhooks and issue sync, so a
   Slack outage or rate limit never delays notifications. The job posts a card (with buttons) to each routed channel
   once per event and channel (a done-marker is written only after success, so a retry after a rate limit posts), then
   later events refresh that card in place (`chat.update`) and add a one-line thread reply. Internal comments are never
   posted. A failure is recorded on the connection as an actionable sentence, never as Slack's response.
7. **Untrusted text.** All card and modal text is entity-escaped or placed in `plain_text` blocks (the same helpers as
   the incoming-webhook formatter), `link_names` is off and unfurling is off.
8. **Limits.** 600 requests per minute per address and per workspace, 60 button presses per minute and 20 new items
   per hour per Slack user, 50 routes per workspace, list calls to Slack capped at five pages, every Slack call timed
   out at 2.5 s (Slack gives an interaction three seconds).
9. **Outbound guard.** Slack calls go through `safeFetch` with the base URL from `SLACK_API_URL` (operator
   configuration, trusted like `GITHUB_API_URL`), form-encoded, no redirects, response size capped.

## Consequences

- Both Slack modes coexist: the webhook kind stays for people who cannot expose Pinwren to the internet.
- Slack must be able to reach `PINWREN_URL`; the settings screen shows the two URLs and the docs say so.
- Changing `PINWREN_SECRET` makes the stored secrets unreadable; the settings screen asks for them again (inbound
  requests then get 401 until it is done), like every other encrypted integration secret.
- Not verified against a live Slack workspace in CI; the Web API is a test double. The first real connection should
  run through the checklist in `docs/contracts/slack.md`.
