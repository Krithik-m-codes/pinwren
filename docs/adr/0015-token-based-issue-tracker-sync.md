# ADR 0015 — Token-based GitHub/GitLab issue sync

**Status:** accepted (narrows blueprint F-076 "App install")

## Context

F-076/F-077 ask for one issue per feedback item with two-way status. The blueprint names a GitHub App install.
A GitHub App needs a public callback URL, an app registered by every self-hoster (or by us, which would then
receive install events for private instances) and key management. Self-managed GitLab has the same OAuth friction.

## Decision

1. **Access tokens, per project.** An org admin pastes a fine-grained personal / project access token, the
   repository (`owner/name`, or a nested GitLab path) and optionally an API base URL (GitHub Enterprise,
   self-managed GitLab). Defaults come from `GITHUB_API_URL` / `GITLAB_URL`. One integration per provider per
   project. The token is AES-256-GCM encrypted (ADR 0014 §5) and never returned — only its last 4 characters.
2. **Outbound is jobs.** `issues.sync` (pg-boss, 6 retries with backoff, one job per fetch) creates issues
   (auto-create for `bugs` / `all`, or the dashboard's synchronous "Send to …" button) and pushes close/reopen
   when an item enters/leaves a closed status. `issue_link` stores the issue number, URL and last known state;
   creation is idempotent per (item, integration). Failures are recorded in `issue_integration.last_error`.
3. **Inbound is a plain webhook per provider:** `POST /api/integrations/github/webhook` verifies
   `X-Hub-Signature-256` (HMAC-SHA256 of the raw body) and `/gitlab/webhook` verifies `X-Gitlab-Token`
   (constant-time compare), both against a per-integration secret (`whsec_…`, encrypted, revealable to admins).
   Integrations are found by repository; when several projects sync one repository, only the integration whose
   secret verifies acts. Closing an issue resolves an open item; reopening reopens a closed one. These changes are
   written as `actor_kind: "integration"` and are not pushed back to the tracker (no loops).
4. **Issue bodies carry no private data links.** The reporter's text is quoted with HTML entity-encoding,
   Markdown punctuation backslash-escaped and `@`/`#` broken with a zero-width space (no mentions, no cross-links).
   Screenshots and diagnostics are not embedded or linked by signed URL; the body links to the item in the
   dashboard (sign-in required). Reporter emails are never included.

## Consequences

- No app registration; works air-gapped against GHES / self-managed GitLab.
- Tokens belong to a person; if they leave, an admin replaces the token (UI: "Replace").
- No screenshot preview inside the issue (deliberate privacy trade-off).
- Linear/Jira (F-078/F-079) can follow the same shape: config row + link row + job + verified inbound route.

## Amendment (wave 5): Linear and Jira Cloud, chat channels

Linear (F-078) and Jira Cloud (F-079) follow the same shape, added as `issue_provider` values in migration
`0005_complete` with no new columns:

- **Linear**: a personal API key (sent bare in `Authorization`, GraphQL at `api.linear.app`); `repo` holds the team
  key. Issues are created in the team (labels matched by name to existing Linear labels); closing moves the issue to
  the team's first `completed` state, reopening to its first `unstarted` (else `backlog`) state. Linear generates
  the webhook signing secret itself, so the admin pastes it into the integration (`webhookSecret` on PATCH).
  Inbound: `Linear-Signature` (hex HMAC-SHA256 of the raw body), `webhookTimestamp` within 5 minutes,
  `Linear-Delivery` remembered for 7 days; `completed` / `canceled` states close the item, others reopen it.
- **Jira Cloud** (REST v3, Enterprise `jira` licence feature per blueprint 07): `apiUrl` is the site URL,
  `token` stores `email:apiToken` encrypted (Basic auth), `repo` the project key. Bugs use the project's Bug issue
  type (else Task); the description is an ADF document whose text nodes are never parsed, so no escaping is
  needed. State changes take the workflow transition into the `done` (closed) or `new` / `indeterminate` (open)
  status category. Inbound: `X-Hub-Signature: sha256=…` with the Pinwren-generated secret pasted into Jira, and
  `X-Atlassian-Webhook-Identifier` remembered for 7 days. Without the licence feature a Jira integration can't be
  created and an existing one is inert (ADR 0019: configured work is kept, not deleted).
- Links show the tracker's key (`ENG-12`, `WEB-7`); `issue_link.number` keeps the numeric part.

Microsoft Teams (Workflows Adaptive Card), Telegram (bot token + chat id, stored as one encrypted Bot API URL) and
ntfy (topic URL + optional access token in `webhook_endpoint.secret`) are `webhook_kind` values that reuse the
webhook delivery, retry, log and auto-disable machinery; every chat URL is stored encrypted and shown masked.
