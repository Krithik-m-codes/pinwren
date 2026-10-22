# @pinwren/widget

The [Pinwren](https://pinwren.dev) feedback widget: Figma-style comments pinned to any element of your site,
and annotated bug reports with console, network and (optionally) session replay — sent to your self-hosted
or cloud Pinwren server. MIT licensed.

It runs in a closed Shadow DOM, never throws into your page, and loads its heavy parts (screenshot engine,
annotation editor, side panel, replay recorder, translations) only when a visitor needs them.

## Install

### Script tag (any site)

```html
<script src="https://feedback.example.com/widget.js" data-project="pk_live_xxx" async></script>
```

`feedback.example.com` is your Pinwren server; the project key comes from **Project › Install** in the
dashboard. The page's origin must be in the project's allowed origins.

| Attribute                           | Meaning                                                                           |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| `data-project`                      | Public project key (required)                                                     |
| `data-endpoint`                     | API origin, when it differs from where `widget.js` is served (e.g. a CDN)         |
| `data-locale`                       | UI language (`en`, `es`, `fr`, `de`, `pt-BR`, `it`, `ja`, `hi`, `nl`, `zh`, `ru`) |
| `data-accent`                       | Launcher colour, hex                                                              |
| `data-url-pattern`                  | Page scope, e.g. `/product/:id` — pins are shared across every page matching it   |
| `data-force-show`                   | Show the widget even where the project's visibility rules would hide it           |
| `data-nonce`                        | CSP nonce for the scripts the widget adds                                         |
| `data-allow-replay-in-privacy-mode` | Keep session replay on in privacy mode (you are responsible for consent)          |

### npm

```sh
npm install @pinwren/widget
```

```ts
import { identify, init, on, open } from "@pinwren/widget";

init({ projectKey: "pk_live_xxx", endpoint: "https://feedback.example.com" });
identify({ id: "user_42", name: "Maria Lopez", email: "maria@example.com" }, { signature });
on("submit", ({ number }) => console.log(`Feedback #${number} sent`));
open("bug");
```

The npm entry is a ~1 KB ESM loader with TypeScript types. `init()` adds `<endpoint>/widget.js` — the build
your server ships, so the widget always matches your server's version — and queues every call made before
it has loaded. It is safe to import during server-side rendering: nothing touches `window` until you call a
function in the browser. For React and Next.js use [`@pinwren/react`](https://www.npmjs.com/package/@pinwren/react).

## API

| Call                             | What it does                                                                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init(options)`                  | Start the widget (once per page). Options: `projectKey`, `endpoint`, `accent`, `locale`, `urlPattern`, `forceShow`, `allowReplayInPrivacyMode`, `nonce` |
| `open(mode?)`                    | Open the menu, or `"comment"`, `"bug"`, `"panel"` directly                                                                                              |
| `close()`                        | Close whatever is open                                                                                                                                  |
| `identify(user, { signature? })` | Pre-fill the reporter from your app; `null` forgets them                                                                                                |
| `setPageScope({ urlPattern })`   | Change the page scope (`null` clears it); the pins on the page are re-listed                                                                            |
| `on(event, handler)`             | `open`, `close`, `submit` (`{ id, number, kind }`), `error` (`{ message }`), `ready`. Returns unsubscribe                                               |
| `destroy()`                      | Remove everything: UI, listeners, console/network wrappers, session replay                                                                              |

With the script tag, the same functions are on `window.Pinwren`; calls made before the script has loaded can
be queued as `window.Pinwren = { q: [["identify", user], ["open", "bug"]] }`.

### Verified reporters

Compute `signature` **on your server** — hex HMAC-SHA256 of the user's `id` with the project's identity secret
(dashboard: project settings › identity) — and pass it to `identify()`. The dashboard then marks that reporter as
verified. Never ship the secret to the browser.

```ts
// Node, on your server
import { createHmac } from "node:crypto";
const signature = createHmac("sha256", process.env.PINWREN_IDENTITY_SECRET!).update(user.id).digest("hex");
```

### Visibility

Set in the dashboard (**Widget › Visibility**); `forceShow` overrides both:

- **Environments → non-production only** hides the widget on production hosts. Not production: `localhost`,
  `*.localhost`, loopback and private-network IPs (127.x, 10.x, 192.168.x, 172.16–31.x, `::1`), the suffixes
  `.local`, `.test`, `.internal`, and `staging`, `stage`, `preview` or `dev` subdomains (`dev.example.com`,
  `preview-42.example.com` — but `example.dev` is production). Everything else is production.
- **Minimum viewport width** hides it on narrower windows (it comes back when the window grows).

## Session replay

When the project turns it on (**Capture › Session replay**), the widget records the last 30–120 s of the page
with [rrweb](https://github.com/rrweb-io/rrweb) and attaches it to bug reports. The recording stays in the
page's memory and is only sent with a report; the reporter sees it in "What we'll send" and can leave it out.
Every input is masked; elements with the class `pinwren-block` or `data-pinwren-ignore` are not recorded;
`pinwren-mask` / `data-pinwren-mask` (and the project's mask selectors) have their text replaced. Privacy mode
turns replay off unless the page sets `allowReplayInPrivacyMode`.

## Hosting the files

`dist/` holds `widget.js` plus content-hashed chunks (`widget-panel.<hash>.js`, `widget-capture.<hash>.js`, …)
listed in `dist/manifest.json`. Serve `widget.js` with a short cache (`Cache-Control: public, max-age=300`)
and the hashed files with `Cache-Control: public, max-age=31536000, immutable`. Chunks load from the
directory `widget.js` was served from, so a CDN copy of `dist/` works with `data-endpoint` pointing at your
server.

Content Security Policy: allow your Pinwren origin in `script-src`, `connect-src` and `img-src` (plus
`data:` and `blob:` in `img-src` for screenshots).

## Licence

MIT. Bundled third-party code (SnapDOM, finder, rrweb) is listed in `dist/THIRD_PARTY_NOTICES.md`.
