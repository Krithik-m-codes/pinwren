# 0026. Share links, client sign-off and reporting widgets

Status: accepted

## Context

Teams need to show one report, or a whole review round, to a client without giving them an account, and to
record the client's answer. The guest portal (reporter tokens, signed page tokens) and review links (a token that
unlocks the widget on a site) cover neighbouring needs but neither is a read-only view of a report.

## Decision

- One table, `share_link`, targets a report (`feedback_id`) or a round (`round_id`) (check constraint: exactly
  one). Only the SHA-256 of the `pws_` token is stored, as for review links. An optional password is stored as
  the same scrypt hash API tokens use.
- The URL is `/share/<projectKey>#t=<token>`. The project key resolves the workspace through the existing
  bootstrap lookup (as the guest portal does), then every query runs under `withOrg` and RLS. The token goes in
  the `x-pinwren-share-token` header, never in a path or query, so it stays out of logs and `Referer`.
- A correct password returns a signed unlock proof bound to the link (HKDF from `PINWREN_SECRET`, 12 hours), so
  the scrypt hash runs once. Attempts are limited per visitor and per link.
- Public output is a fixed allowlist: no internal notes, assignees or reporter identity; diagnostics are reduced
  to counts plus capped, PII-masked entries (`maskPii`, `maskUrl`); only screenshot and replay files are served;
  attachments never are.
- Sign-off (`round_signoff`) is only accepted through a round link; the newest answer is the state.
  `review_round.require_signoff` blocks closing until that answer is Approved. The team is told through the bell
  and an email (`round_signoff` template) and the `round.signoff` webhook, sent after the commit.
- Dashboard widgets read new aggregates from `GET /api/stats`, computed in a few org-scoped queries. "SLA
  breach" means a due date set in triage was missed (open and past due, or resolved late); first response is the
  first teammate action on an item.

## Consequences

Routes are classified in `tenant-route-inventory.json` (`capability` for the public ones) and covered by the
cloud isolation suites. Migration `0012` adds the tables and their `pinwren_tenant` policies.
