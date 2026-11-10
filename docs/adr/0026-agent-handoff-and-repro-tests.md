# ADR 0026 — Agent hand-off briefs and generated repro tests

**Status:** accepted

Coding agents were reachable through MCP, but the person triaging had no one-click way to hand a report over,
and the agent had no ready test to reproduce it. Two server-side features close that gap, and the SDK, MCP
server and CLI now cover the dashboard API they were missing (stats, labels, saved views, assets).

## Decisions

- **One brief, many doors.** `GET /api/v1/feedback/:id/brief` (and the session route `/api/feedback/:id/brief`)
  returns the Markdown brief plus the commands and links that deliver it. The dashboard's **Fix with agent**
  dialog, MCP `get_agent_brief` and `pinwren feedback brief` all read that one answer, so they cannot drift.
- **Masked data only, nothing visual by default.** The brief is built from what the report already stores
  (diagnostics are masked at capture; typed text never leaves the visitor's browser). The replay and screenshot
  are linked, never inlined. The MCP tool `get_asset` returns an image only when called with
  `includeImage: true`, never a replay.
- **Reporter text is data.** It is quoted in the brief, escaped for Markdown, and kept out of every shell
  command: the `claude`, `code chat` and pipe commands are built from the item's id and number only.
- **Agent webhook = a panel action.** A webhook panel action gets an optional `agent: true` flag. It reuses the
  signed `action.run` delivery (outbound guard, activity entry, secret) and adds `data.brief` to the payload;
  the dashboard lists it under **Fix with agent** instead of in the plain actions row. No new settings table.
- **Cursor and VS Code.** Cursor has a documented prompt deep link (`cursor://anysphere.cursor-deeplink/prompt`,
  prompt limited to 8 000 characters; the link falls back to a one-line prompt that names `get_agent_brief`
  when the brief is longer). For VS Code we offer the `code chat '…'` command rather than a URL handler we could
  not verify; the dialog copies it.
- **Deterministic repro test first.** `generateReproTest` is a pure function over the replay trace, console and
  network evidence and the anchor: `goto` the recorded page, script clicks and typing with stable locators (an
  id that is not generated, role + name, field name, label, placeholder, text), sample values instead of the
  masked input, and expectations on console errors, failing requests and the pinned element (`test.fixme` when
  nothing can be asserted). Every reporter string is emitted as a JSON string literal or a one-line comment; tests
  parse the output with TypeScript, including hostile input.
- **Honest labelling.** The file header, the API's `caveats`, the dashboard and the MCP result all say it is a
  draft. Nothing claims the test was run.
- **Optional AI polish.** `?polish=1` (dashboard only, opt-in per click) sends just the generated, masked draft
  to the organisation's AI provider and keeps the result only if it still looks like a Playwright test with
  the draft header; otherwise the deterministic draft is shown.
- **Parity.** `replayTrace` keeps the structured action behind each replay step (the text steps are derived from
  it, so MCP/Markdown output is unchanged). `/api/v1/stats`, `/projects/:id/labels` and `/views` reuse the
  dashboard's services. A test fails when an `/api/v1` route has no SDK method, when the generated types are
  stale, or when an MCP tool is missing from its README or docs page.

## Consequences

- Seven new routes are in `tenant-route-inventory.json` and the tenant acceptance cases (`foreign` or `scoped`).
- A brief or test is only as good as the recording: without a replay the test just opens the page and checks the
  console/network evidence, and says so.
