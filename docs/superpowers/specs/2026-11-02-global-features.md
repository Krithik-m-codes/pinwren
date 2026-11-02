# Global features reviewed from the DocuSigner app

Source: `E:\Shubpy\docusigner_frontend` (branch `v2-ui`, read only). The goal was to find app-wide features
that make Pinwren, a visual feedback and bug tool, nicer to live in all day. Pinwren already has more than
the first pass suggested, so each row says what exists.

## Inventory and ranking

| Feature in DocuSigner                                                   | Pinwren today                                                           | Fit        | Decision               |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------- | ---------------------- |
| Global search ("Search everywhere", pill trigger + ⌘K, match options)   | Palette navigates pages, projects, views only; inbox search is per-list | High       | **Built** (search)     |
| Recent documents widget                                                 | None                                                                    | High       | **Built** (recents)    |
| Keyboard shortcuts                                                      | Inbox-only keys and help; one global chord (`g m`)                      | High       | **Built** (global)     |
| Theme / layout / navbar customiser, saved per user                      | Light/dark/system + language + dashboard layouts                        | Medium     | **Built** (start page) |
| Default landing page                                                    | `/` always redirected to the inbox                                      | High       | **Built** (start page) |
| Saved views of list filters (`use-saved-document-views`)                | Server-side saved views, sidebar, palette                               | -          | Exists                 |
| Bulk action bar with confirm + partial-failure report                   | Inbox selection bar, bulk update, undo toast, `u`                       | -          | Exists                 |
| Session-expired toast on return to sign-in                              | Redirect only                                                           | Low-medium | Parked                 |
| Notification bell / notifications page / per-user notification settings | Bell, page, settings, desktop notifications                             | -          | Exists                 |
| Breadcrumbs                                                             | Page headers carry the context; one nesting level                       | Low        | Skipped                |
| Activity page and audit-trail dialog                                    | Item timeline; workspace activity on the dashboard                      | -          | Exists                 |
| Onboarding / empty states                                               | Setup checklist, empty states on each screen                            | -          | Exists                 |
| Quick-create menu                                                       | Feedback is created by the widget, not the dashboard                    | Low        | Skipped                |
| Session update handler (force sign-out on role change)                  | Session boundary re-reads the role on every request                     | -          | Not needed             |

## What was built

1. **Global feedback search** in the command palette. After two characters it runs the inbox's own `q`
   search (all statuses, six hits, 250 ms debounce) and lists matches with their number and project, plus a
   "Search all feedback for ..." row that opens the inbox with the term applied. Authorisation is the API's:
   no new endpoint.
2. **Recent items.** Opening a feedback item records it (number, title, project name) per user in
   localStorage, eight at most; the palette shows them when its input is empty.
3. **Shortcuts everywhere.** The help overlay moved from the inbox into the shell, so `?` works on every
   screen and from the palette. New go-to chords: `g i` inbox, `g d` dashboard, `g p` projects, `g n`
   notifications, `g s` settings (`g m` already existed). The overlay is grouped (Everywhere / Inbox) from a
   single table in `lib/shortcuts.ts`, which a test checks against the chords.
4. **Start page.** Settings > Profile > Appearance lets a person choose what `/` opens: inbox (default),
   dashboard or My work. Stored per device in a cookie, because the redirect is server side. After sign-in
   the fallback destination is now `/`, so the choice applies there too.
5. **Palette actions:** "Keyboard shortcuts" and "Copy link to this page".

## Not done, and why

- Account-level preferences (would need a column on `user_preference`); the start page is per device like
  dashboard layouts (ADR 0024).
- Idle / expired-session toast: the 401 redirect works; a toast needs a flag handed across the redirect and
  is a small follow-up.
- Pinned projects: the sidebar already lists projects; saved views cover the "favourite filter" need.
