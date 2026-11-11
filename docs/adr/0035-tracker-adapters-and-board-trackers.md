# ADR 0035 — Tracker adapter SDK and the board trackers (Trello, Asana, ClickUp, Notion)

**Status:** accepted (extends ADR 0015; no blueprint feature id — the blueprint names GitHub, GitLab, Linear and Jira)

## Context

ADR 0015 added token-based issue sync for four trackers. `integrations/trackers.ts` grew as one `if (provider === …)`
ladder per operation (create, set state, test), and the inbound routes copied each other. Four more requested
trackers — Trello, Asana, ClickUp and Notion — are not issue trackers: their items are cards, tasks and database pages
with no repository and no issue number, their "closed" is a list, a checkbox or a status the project names, and their
webhooks are registered, handshaken or signed in four different ways.

## Decision

1. **An adapter contract** (`integrations/sdk/types.ts`): `createIssue`, `setIssueState`, `checkAccess`, optional
   `findExisting`, optional `webhooks`. The registry (`adapters/index.ts`) maps `IssueProvider` to its adapter and
   `trackers.ts` is a thin facade. GitHub, GitLab, Linear and Jira were moved into adapters **verbatim** (same
   requests, same errors, same hints; their existing tests pass unchanged). Their inbound routes stay repository-keyed
   and are not routed through the SDK.
2. **A shared JSON client** (`sdk/http.ts`) with the tracker's own error text (never a raw body), the outbound guard,
   and opt-in rate-limit backoff: `429`/`503` (and transient read failures) are retried twice honouring `Retry-After`;
   a longer wait fails the job with `retryAfterMs` so the queue's own backoff takes over. Only the new adapters opt in.
3. **Schema (migration 0018):** `issue_provider` gains `trello`, `asana`, `clickup`, `notion`; `issue_link.number`
   becomes nullable and gains `external_id` (the tracker's own id); `issue_integration` gains `settings jsonb`
   (non-secret mapping: target list, done state, priority), `webhook_ref` (the webhook Pinwren registered) and
   `webhook_pending` (waiting for the signing secret). `repo` holds the board id (Trello), project gid (Asana), list id
   (ClickUp) or database id (Notion). `webhook_pending` joins the bootstrap column grant of the Cloud service role.
4. **Credentials** are stored like the existing ones: AES-256-GCM, last four characters shown. Trello needs an API key
   and a token, stored as `apiKey:token` in one encrypted value, as Jira stores `email:token`. The webhook secret is
   per integration: ClickUp returns it on registration, Asana and Notion hand it over in a one-time handshake, and for
   Trello the admin pastes the Power-Up's app secret (Trello signs with it, over the body and the callback URL).
5. **Webhook routes name the integration** (`/api/integrations/<provider>/webhook?i=<integration id>`). A delivery is
   checked against that integration's secret only, so tenants sharing a board id cannot confuse each other and an
   unknown id is indistinguishable from a bad signature. The one-time handshake (Asana `X-Hook-Secret`, Notion
   `verification_token`) is accepted **only while `webhook_pending` is set** and the first write wins; a rotated
   Notion secret sets it again. Replay protection, size and rate limits are the existing `inboundGuard`/`firstDelivery`.
6. **Mapping.** Priority maps to the tracker's native concept through `priorityLow…priorityUrgent` settings (Trello
   label name, Asana custom-field option, ClickUp 1–4 with defaults, Notion select option). Status maps through
   `doneListId` (Trello; archive when unset), `completed` (Asana), the list's closed/open statuses or configured names
   (ClickUp), and a Status, Select or Checkbox property with configured values (Notion). Issue bodies are built per
   tracker from the same structured source; reporter text goes only into plain-text fields.
7. **Idempotency beyond the link row:** board adapters implement `findExisting` (same title in the target list /
   project / database) and the create path adopts an item an interrupted job already made.
8. **Edition:** the four are Community, like GitHub, GitLab and Linear. The blueprint gates only Jira.

## Consequences

- Adding a tracker is an adapter file, a registry entry, a provider value and a migration; the writing guide is
  `docs/integrations/tracker-adapters.md`.
- Asana and Notion webhooks carry ids, not values, so each delivery costs one API read by Pinwren (capped at twenty
  per delivery).
- Trello needs a Power-Up (its API key and app secret) because Trello's webhooks are signed with the app secret; there
  is no way to verify them with the token alone.
- Notion's webhook subscription is created by hand in the integration's settings (the API has no endpoint for it);
  Pinwren keeps the verification token Notion posts. ClickUp's webhook is per workspace and list; Asana's is per project.
- No provider was exercised against a real account; all HTTP is mocked in tests and the shapes follow each provider's
  public documentation as of this ADR.
