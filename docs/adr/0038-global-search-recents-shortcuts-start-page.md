# ADR 0038 — Palette search, recent items, global shortcuts and a start page

**Status:** accepted

From the DocuSigner review (`docs/superpowers/specs/2026-11-02-global-features.md`).

- **Search reuses the list endpoint.** The palette calls `GET /api/feedback?q=` through RTK Query
  (`useListFeedbackInfiniteQuery`), so tenant scoping, role checks and the search semantics are the inbox's.
  Hits carry the typed text in their cmdk `value` so cmdk's own filter keeps them. No route is added, so the
  tenant route inventory is unchanged.
- **Recents are per browser.** `lib/recent.ts`: localStorage per user id, eight entries, validated on read.
  Only number, title and project name are stored; opening one navigates to the live item, so a deleted or
  moved item shows the inbox's normal not-found state.
- **Shortcuts are one table.** `lib/shortcuts.ts` holds the go-to chords and the help rows; the overlay lives
  in the shell next to the capture-phase handler that swallows both keys of a chord.
- **The start page is a cookie.** `pinwren_landing` holds one of three words (never a path), read by the `/`
  server redirect and written by the profile setting. The default clears the cookie. `safeNext` now falls back
  to `/` so sign-in lands on the chosen page. Per device, not per account, until a preference column exists.
