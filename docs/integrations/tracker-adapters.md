# Writing a tracker adapter

Issue-tracker sync (F-076–F-079 and, since [ADR 0035](../adr/0035-tracker-adapters-and-board-trackers.md), Trello,
Asana, ClickUp and Notion) is built from **adapters**. An adapter is the only code that knows one tracker's API; the
jobs, links, activity timeline, tenant checks, licence gates, rate limits and routes above it are the same for every
tracker. Adding a tracker should not touch any of them.

The contract is `packages/api/src/integrations/sdk/types.ts`; the registry is
`packages/api/src/integrations/adapters/index.ts`; `packages/api/src/integrations/trackers.ts` is the facade the rest
of the API calls (`createIssue`, `setIssueState`, `checkAccess`, `findExistingIssue`), which picks the adapter by
`cfg.provider`.

```
packages/api/src/integrations/
  sdk/types.ts        TrackerAdapter, WebhookAdapter, TrackerConfig, IssueRef, TrackerError …
  sdk/http.ts         trackerClient(): JSON client with error text, outbound guard and rate-limit backoff
  sdk/util.ts         mdEscape, plainBody, keyNumber, small parsing helpers
  adapters/<name>.ts  one file per tracker
  adapters/index.ts   ADAPTERS registry (+ PROVIDER_NAMES)
  trackers.ts         facade used by jobs and routes
  issues.ts           tracker-independent half: create/state jobs, links, inbound state, bodies
  inbound.ts          pure parsing/verification of the older (repository-keyed) webhooks
```

## The contract

```ts
interface TrackerAdapter {
  provider: IssueProvider;
  name: string;
  createIssue(cfg, issue: NewIssue, fetch): Promise<IssueRef>;
  setIssueState(cfg, target: LinkTarget, state: "open" | "closed", fetch): Promise<void>;
  checkAccess(cfg, fetch): Promise<AccessResult>; // "Test connection"
  findExisting?(cfg, issue, fetch): Promise<IssueRef | null>; // idempotency, see below
  webhooks?: WebhookAdapter; // the tracker can call us back
}
```

- **`cfg`** (`TrackerConfig`) is the decrypted integration: `token`, `repo` (the one id that names the project, board,
  list or database), `apiUrl` (only GitHub, GitLab and Jira have one), `email` (Jira), `apiKey` (Trello) and the
  per-project `settings` (below). Adapters never read the database.
- **`fetch`** is `safeFetch` in production and a fake in tests. Every request must go through it; it enforces the
  outbound allow-list, timeouts and size caps. Do not call `fetch` directly.
- **`IssueRef`** is `{ number, url, key?, externalId? }`. Trackers with numbered issues return `number`; the others
  return `number: null` and the tracker's own `externalId`. The link row stores both; inbound events and state pushes
  address the item by whichever it has (`LinkTarget`).
- **Errors** are `TrackerError(message, status)`. The message must come from the tracker's JSON error fields (the
  client does this) and never echo a raw response body.

## HTTP: `trackerClient`

```ts
const call = trackerClient({
  name: "Asana",
  base: () => "https://app.asana.com/api/1.0",
  headers: (cfg) => ({ authorization: `Bearer ${cfg.token}`, "content-type": "application/json" }),
  hint: (cfg, status) => (status === 401 ? " (check the token)" : ""),
  retries: 2, // in-process backoff on 429 / 503 (and 502 / 504 / network errors for GETs)
});
const task = await call<{ data: { gid: string } }>(cfg, "POST", "/tasks", { data: {…} }, fetch);
```

- **Rate limits.** With `retries > 0` the client waits and retries on `429` and `503`, honouring `Retry-After`
  (seconds or an HTTP date), else exponential backoff with jitter (500 ms, 1 s …). A wait longer than 8 s is not
  waited for in-process: the client throws a `TrackerError` with status 429 and `retryAfterMs`, the job fails, and
  the queue retries it later (`issues.sync`: six retries, exponential). GitHub, GitLab, Linear and Jira keep
  `retries: 0` so their behaviour is unchanged. Tests override `backoff.sleep` / `backoff.jitter`.
- **Never** put a credential in a URL if the tracker accepts a header (Trello does: `Authorization: OAuth …`).

## Idempotency

`issue_link` has a unique `(feedback, integration)`, and `createIssueFor` returns an existing link, so a retry after a
completed create is free. The remaining gap is a job that died _between_ the tracker answering and the link insert.
Board adapters close it with `findExisting`: before creating, the facade asks the tracker whether an item with the same
title (`#<number> <text>`, unique within a project) already exists and adopts it. Implement it with the tracker's
cheapest list/search call; a 4xx other than 429 is treated as "can't look" and creating proceeds.

## Settings and field mapping

Board trackers take a flat `settings` object (`issue_integration.settings`, non-secret): target list, done state,
priority mapping. The accepted keys per tracker are `TRACKER_SETTING_KEYS` in `packages/core/src/schemas.ts`; unknown
keys are refused by the API and the form. To add a setting: add the key there, read it in the adapter with
`cfg.settings?.key`, and add a label under `trackers.field.<key>` to the dashboard catalogues.

Pinwren's priority (`none`, `low`, `medium`, `high`, `urgent`) arrives as `issue.priority`; map it with
`priorityLow … priorityUrgent` settings whose meaning is the tracker's (a Trello label name, an Asana option gid,
ClickUp's 1–4, a Notion option name).

## Webhooks (two-way)

A `WebhookAdapter` has one of two modes:

| Mode        | Who creates the webhook                                  | Example                |
| ----------- | -------------------------------------------------------- | ---------------------- |
| `register`  | Pinwren, through `register()` (button: Register webhook) | Trello, Asana, ClickUp |
| `handshake` | The admin, in the tracker; the tracker posts a token     | Notion                 |

The URL is `/api/integrations/<provider>/webhook?i=<integrationId>`. Because the id names exactly one integration,
the route checks the delivery against **that integration's secret only** (no searching by repository), so one tenant's
secret can never act on another's integration. An unknown id answers like a bad signature. The route
(`boardWebhook()` in `packages/api/src/routes/inbound.ts`) does, in order:

1. rate limit and body-size cap (`inboundGuard`);
2. the **handshake**, only while `webhook_pending` is true (the integration is waiting for its secret): the first
   delivery wins and stores the secret; afterwards a handshake is a 401;
3. `verify(secret, req)` — constant-time HMAC check of the raw body (Trello also signs the callback URL);
4. replay protection: `deliveryId(req)` (else the body hash) is acted on once for seven days;
5. `events(cfg, req, fetch)` — the state changes. Some trackers send ids only (Asana, Notion): the adapter reads the
   value back from the API;
6. `applyInboundState` per event, written as `actor_kind: "integration"` so it is not pushed back (no loops).

`tests` for a new adapter should cover: valid signature, tampered body, wrong secret, missing header; each event type
that maps to open/closed and each that must be ignored.

## Checklist for a new tracker

1. `ISSUE_PROVIDERS` (and `BOARD_PROVIDERS`, `TRACKER_SETTING_KEYS`, `trackerRepoError`, `normalizeTrackerRepo`) in
   `packages/core/src/schemas.ts`.
2. `adapters/<name>.ts`, an entry in `adapters/index.ts`.
3. A migration adding the value to the `issue_provider` enum (`pnpm db:generate`), and — for a webhook route — the
   route in `routes/inbound.ts`, `tenant-route-inventory.json`, and a case in `cloud-routes-public-db.test.ts`.
4. Credentials: if the tracker needs two secrets, store them as one encrypted value (`apiKey:token`, as Trello and
   Jira do) in `routes/integrations.ts` and `trackerConfig()`.
5. Dashboard: icon and name (`components/tracker-icon.tsx`), an entry in `META` (`trackers-tab.tsx`), strings under
   the `trackers.*` keys in all catalogues.
6. Docs: `apps/www/content/docs/integrations/<name>.mdx`, the parity row in `blueprint/14-feature-parity.md`.
7. Tests with a fake `fetch` (see `packages/api/src/tracker-adapters.test.ts`): create, state both ways, test
   connection, errors, rate-limit retry, `findExisting`, and every webhook path above. Never call a real account.

## Untrusted text

Feedback text, names and URLs are untrusted. Markdown trackers get `issueBody()` (entity-encoded, punctuation
escaped, `@`/`#` broken). Trackers with a plain-text or block field (Asana notes, Notion rich text) get
`NewIssue.source` — the raw quote and facts — and must put it only in text fields, never in HTML or a mention.
