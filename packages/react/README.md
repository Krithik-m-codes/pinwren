# @pinwren/react

React bindings for the [Pinwren](https://pinwren.dev) feedback widget: a `<Pinwren>` component and a
`usePinwren()` hook. Works with Next.js (App Router and Pages), Vite, Remix and any React 18+ app. MIT.

```sh
npm install @pinwren/react
```

## Usage

Render `<Pinwren>` once, near the root of your app. It renders nothing; in an effect it loads `widget.js` from
your Pinwren server and starts the widget, and it removes everything again on unmount.

```tsx
// app/layout.tsx (Next.js App Router) — @pinwren/react is already a client component
import { Pinwren } from "@pinwren/react";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Pinwren projectKey="pk_live_xxx" endpoint="https://feedback.example.com" />
      </body>
    </html>
  );
}
```

Open the widget from your own UI with the hook:

```tsx
"use client";
import { usePinwren } from "@pinwren/react";

export function ReportButton() {
  const pinwren = usePinwren();
  return (
    <button type="button" disabled={!pinwren.ready} onClick={() => pinwren.open("bug")}>
      Report a problem
    </button>
  );
}
```

## Props

| Prop                                                  | Type                             | Notes                                                                                                         |
| ----------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `projectKey`                                          | `string`                         | Public project key (required)                                                                                 |
| `endpoint`                                            | `string`                         | Your Pinwren server's origin (required)                                                                       |
| `user`                                                | `{ id?, name?, email? } \| null` | Pre-fills the reporter                                                                                        |
| `userSignature`                                       | `string`                         | Hex HMAC-SHA256 of `user.id` with the identity secret — makes the reporter verified. Compute it on the server |
| `urlPattern`                                          | `string`                         | Page scope, e.g. `/product/:id`                                                                               |
| `locale`                                              | `string`                         | UI language; defaults to the browser's                                                                        |
| `accent`                                              | `string`                         | Launcher colour (hex)                                                                                         |
| `forceShow`                                           | `boolean`                        | Ignore the project's visibility rules                                                                         |
| `allowReplayInPrivacyMode`                            | `boolean`                        | Keep session replay on in privacy mode                                                                        |
| `nonce`                                               | `string`                         | CSP nonce for the widget's scripts                                                                            |
| `metadata`                                            | `object \| null`                 | Context sent with every report and comment (plain JSON, ≤ 14 KB); compared by value                           |
| `visible`                                             | `boolean`                        | `true` shows, `false` hides the widget whatever the visibility mode; leave out to let the mode decide         |
| `onReady`, `onOpen`, `onClose`, `onSubmit`, `onError` | callbacks                        | Widget events; the latest function is always called                                                           |

Changing `projectKey`, `endpoint`, `locale`, `accent`, `forceShow`, `nonce` or `allowReplayInPrivacyMode`
re-creates the widget; `user`, `userSignature`, `urlPattern`, `metadata` and `visible` update it in place.

## `usePinwren()`

Returns `{ ready, open(mode?), close(), identify(user, { signature }?), setPageScope({ urlPattern }),
setMetadata(object), show(), hide(), on(event, handler) }`. The functions work before the widget has loaded
(calls are queued); `on` returns an unsubscribe
function to call in your effect's cleanup.

## Server-side rendering

Nothing touches `window` during render, so the component is safe in server-rendered trees; the bundle starts
with `"use client"` for the App Router. `usePinwren().ready` is `false` on the server.

## Licence

MIT. The package bundles only Pinwren's own loader from `@pinwren/widget`.
