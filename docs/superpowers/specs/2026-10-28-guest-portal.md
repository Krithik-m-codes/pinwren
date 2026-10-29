# Phase 2 completion: guest portal

Source requirements: blueprint 06 section 7, WP-20 and the remaining guest-portal parity row. The user
explicitly instructed us to proceed with unfinished phases; implementation follows this existing scope.

## Behaviour

- `/guest/[key]` is a standalone guest screen, outside the authenticated team shell.
- The widget opens it with up to 50 existing reporter tokens in a URL fragment. Reporter emails open
  it with the existing signed, expiring page-link capability for that one feedback item.
- The browser validates fragment credentials, removes the fragment immediately, and remembers access
  per project locally. No credential is put in a query string or sent to an external page.
- Guests see their recent submitted items, status, public replies and a public reply composer.
- Server queries require the project and organisation plus a matching reporter-token hash or an item
  id from a valid signed page token. UUIDs, email addresses, public-read settings and review links alone
  never grant access to other reporters' items in the portal.
- Replies are attributed from the original reporter, cannot become internal notes, respect read-only
  and archived projects, and use the existing domain-event notification path.
- No diagnostics, internal notes, teammate email addresses, arbitrary activity or management controls.
- Entitled organisation branding is reused; otherwise Pinwren branding remains visible.
- Empty, expired/unavailable, loading, error/retry and forget-browser-access states are required.

## API contract

Core schemas live in `packages/core/src/guest.ts` and are exported through core's index.
All routes are mounted before dashboard session middleware and still use the global JSON CSRF guard.

`GET /api/guest/:key/feedback` returns `GuestPortalResponse`.
`GET /api/guest/:key/feedback/:id` returns `GuestThreadResponse`.
`POST /api/guest/:key/feedback/:id/comments` accepts `GuestReplyCreate` and returns `{ comment }`.

Credentials are sent in `x-pinwren-reporter-tokens` and `x-pinwren-page-tokens`, comma separated. The
total is capped at 50. Every response is private/no-store; reads and writes have separate IP limits.

Fragment format: `#access=` followed by URI-encoded JSON `{reporterTokens: string[], pageTokens: string[]}`.
Neither property contains feedback ids; the server derives allowed ids from the capabilities.

## Interface

Extend the incumbent dashboard visual system: Inter, existing navy/orange tokens, existing Base UI
controls, narrow project header, searchable report list and conversation panel. Stack list and thread
on mobile. Keep the primary action beside the conversation. No dashboard sidebar, admin navigation,
decorative metrics or new visual identity. Honour keyboard and screen-reader semantics.

## Evidence required

Schema, token, expiry, cross-project/tenant, deleted-item, internal-note and read-only tests; real-DB
smoke checks; guest browser journey at desktop/mobile; existing widget budgets; full required CI.
