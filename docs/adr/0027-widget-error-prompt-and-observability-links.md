# ADR 0027 — Widget error prompt and observability link-outs

**Status:** accepted

Two widget features, both inside the core's 35 KiB gzip budget, which had only a few dozen bytes of headroom.

**Error prompt.** The listener for uncaught errors and unhandled rejections, the toast and the dedupe/rate
logic live in a new lazy chunk, `widget-errors.js` (budget 3 KiB). The core only reads the new
`widgetConfig.errorPrompt` flag (default off) and loads the chunk when it is on, so projects that do not use it
download nothing. Core savings elsewhere (shorter console warnings) paid for the hook. The prompt is suppressed in
privacy mode (the server also forces the flag off in `/w/config`), while the widget is hidden by visibility
rules, while a report is open, and for errors thrown by the widget's own files. Nothing is captured or sent until
the visitor clicks "Send report"; the error then goes into the report's console log and `metadata.error`. At most
three prompts per browser session (`sessionStorage`), 30 s apart, one per distinct error.

**Observability links.** No migration: the ids live in `metadata.observability`, which the server already stores
(16 KiB cap) and returns. Detection runs in the lazy report chunk and only reads globals Sentry, PostHog, LogRocket
and Datadog RUM already put on `window`; it never loads or calls anything that sends data, and is skipped in
privacy mode. The widget validates ids (plain tokens), hosts (hostnames) and URLs (https, no credentials), and the
dashboard validates again at render time because `metadata` is visitor-controlled: only links built from valid
parts are shown, with the destination host in the button's title. Sites can supply the same shape with
`Pinwren.setMetadata({ observability })` (there is no separate `setContext`; `setMetadata` already is the generic
channel). Sentry and Datadog links are derived from ids plus the DSN host / RUM site; Sentry's organisation is
resolved by Sentry for a signed-in user.
