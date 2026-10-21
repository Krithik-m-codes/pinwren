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
