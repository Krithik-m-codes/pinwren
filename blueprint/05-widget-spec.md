# 05 — Widget specification (`@pinwren/widget`, MIT)

The widget is the product most people touch and the one place a bug can hurt a customer's own site. It gets the strictest budgets.

## 1. Delivery

```html
<script src="https://pinwren.example.com/widget.js" data-project="pk_live_xxx" async></script>
```

or

```ts
import { init } from "@pinwren/widget";
init({ projectKey: "pk_live_xxx", endpoint: "https://pinwren.example.com" });
```

or React: `<Pinwren projectKey="…" />` from `@pinwren/react`.

- `widget.js` is a tiny **loader** (< 3 KB gzip) that reads `data-*` attributes, checks visibility rules locally where possible, then imports the versioned core (`/w/v1/core.<hash>.js`).
- Lazy chunks: `editor` (annotation), `capture` (SnapDOM), `replay` (rrweb record), `panel` (thread list), `i18n/<locale>`.
- Self-host serves bundles from the same container; Cloud serves from CDN with `immutable` caching.

## 2. Budgets (CI-enforced with size-limit)

| Artifact                                                       | Budget (gzip)                           |
| -------------------------------------------------------------- | --------------------------------------- |
| loader                                                         | 3 KB                                    |
| core (launcher, comment mode, composer, API client, anchoring) | 35 KB                                   |
| panel                                                          | 15 KB                                   |
| editor                                                         | 30 KB                                   |
| capture (SnapDOM + glue)                                       | 40 KB                                   |
| replay (rrweb record)                                          | 60 KB                                   |
| Main-thread work on page load (loader + core idle init)        | < 5 ms on 4× CPU throttle               |
| Memory at idle                                                 | < 3 MB (replay off), < 8 MB (replay on) |

## 3. Isolation rules

- All UI lives in a **closed Shadow DOM** attached to a single host element `<pinwren-root>` appended to `document.documentElement` (not `body`, survives body re-renders).
- Styles via constructed `CSSStyleSheet` + `adoptedStyleSheets`; fallback `<style>` inside the shadow root. Reset with `:host { all: initial }`.
- Overlays that must sit above the page (hover outline, region selection, pins) are rendered in a fixed-position layer inside the shadow root with `z-index: 2147483000+` and `pointer-events` only while active.
- **No globals** except `window.Pinwren` (queue + API). No prototype patching except the opt-in, reversible `fetch`/`XHR`/`console` wrappers in capture, each guarded so a second instance or an uninstall restores originals.
- Every public entry point is wrapped: exceptions are caught, reported to `/w/telemetry` (sampled, opt-out), and never rethrown into host code.
- Respect host CSP: no `eval`, no inline scripts; document the required CSP (`script-src`, `connect-src`, `img-src` for the Pinwren origin) and a nonce option (`data-nonce`).
- Works with: plain HTML, React/Next.js (App Router), Vue/Nuxt, Svelte/SvelteKit, Angular, Astro, WordPress, Webflow, Shopify. E2E fixture sites cover the first six.

## 4. Modes and state machine

```
idle ──launcher/shortcut──▶ menu ──"Comment"──▶ picking ──click/drag──▶ composing ──submit──▶ sent ──▶ idle
                              │                    ▲ Esc                  │ Esc (confirm if dirty)
                              └──"Report a bug"──▶ capturing ──▶ annotating ──▶ report-form ──submit──▶ sent
                              └──"View feedback"──▶ panel
```

- `picking`: hover outline + tag label; `Shift` = select parent; arrow keys walk the DOM (accessibility); touch: long-press to pick.
- Region select: drag rectangle; anchored to the smallest element containing the region.
- Text select: if the user has a text selection when entering comment mode, offer "Comment on selection".
- Composer anchored next to the pin, repositions to stay in viewport; mobile = bottom sheet.

## 5. Anchor bundle (wire format)

```ts
interface AnchorBundle {
  v: 1;
  attrs?: { pinwrenAnchor?: string; testId?: string; id?: string; ariaLabel?: string; name?: string };
  css: string; // stable selector (avoid hashed classes)
  xpath: string;
  text: { content: string; prefix: string; suffix: string }; // normalised, truncated
  tag: string;
  role?: string;
  structure: { depth: number; siblingIndex: number; childTagsHash: string };
  rect: { x: number; y: number; w: number; h: number; vw: number; vh: number; scrollY: number };
  pin: { xPct: number; yPct: number; wPct?: number; hPct?: number };
  textRange?: { startOffset: number; endOffset: number; quote: string };
}
```

Stable-selector heuristics (build on SitePing's approach, MIT): skip class names matching `/^(css|sc|jsx|emotion|svelte)-[\w-]{4,}$/`, CSS-module hashes (`_[a-z0-9]{5,}$`), Tailwind arbitrary-value classes, and IDs that look generated (`:r1:`, UUIDs, long digit runs). Prefer `data-pinwren-anchor` > `data-testid` > `id` > `aria-label` > semantic tag path.

The re-attach algorithm and scoring live in `packages/anchoring` (framework-free, 100 % unit-tested, see F-031).

## 6. Capture pipeline

1. **Mask first.** Before capture, apply masking: elements matching `[data-pinwren-mask]`, `input[type=password]`, `[autocomplete^=cc-]`, project-configured selectors → replaced in the clone with a solid block; `[data-pinwren-ignore]` → removed.
2. **Capture** with SnapDOM (`clip` = viewport by default, element or full page optional), `scale = min(devicePixelRatio, 2)`, WebP 0.85 (PNG fallback).
3. **Cross-origin images/fonts** that block capture: retry those resources through the server's capture proxy (`/w/proxy?url=` — allowlisted to the project's origins and their declared asset hosts, size-capped, image/font MIME only). If still blocked, render a labelled placeholder rather than failing.
4. **Fallback**: if SnapDOM throws or exceeds 4 s, offer "Capture with screen share" (`getDisplayMedia`, user-initiated) or "Submit without screenshot".
5. Upload via `/w/uploads` while the user is typing (optimistic), so submit is instant.

## 7. Diagnostics buffers

- Console: ring buffer (default 100 entries, 4 KB per entry), args serialised with a safe serializer (depth 4, 50 keys, strings 1 KB, circular-safe, DOM nodes as `<tag#id.class>`).
- Network: ring buffer (default 50 entries) of failed (status ≥ 400 or network error) and slow (> 3 s) requests; URL query values redacted by default for keys matching `/token|key|secret|password|auth|session|code/i`.
- Errors: `window.onerror`, `unhandledrejection`, with stack and source mapping hints.
- Replay: rrweb with `maskAllInputs: true`, `blockClass: 'pinwren-block'`, `maskTextClass: 'pinwren-mask'`, sampling (mousemove 50 ms, scroll 150 ms), `checkoutEveryNms: 10_000` so the buffer can drop old segments; gzip with `CompressionStream` before upload.

## 8. Public JS API

```ts
Pinwren.init(options)            // when not using data attributes
Pinwren.open(mode?: 'comment'|'bug'|'panel')
Pinwren.close()
Pinwren.show() / Pinwren.hide()   // launcher visibility
Pinwren.identify(user, { signature? })
Pinwren.setMetadata(obj)
Pinwren.setPageScope({ urlPattern })
Pinwren.on(event, handler)       // 'open','close','submit','error','ready'
Pinwren.destroy()                // full teardown: listeners, wrappers, DOM
```

Before the core loads, calls are queued on `window.Pinwren.q` (snippet-style).

## 9. Accessibility

WCAG 2.2 AA: every control reachable by keyboard, visible focus ring, focus trapped in dialogs and returned on close, `aria-live` announcements for submit success/failure, pin markers are buttons with labels ("Comment 3 by Maria: 'Logo too small'"), colour contrast ≥ 4.5:1 in both themes, reduced-motion respected.

## 10. Testing (see 12)

- Unit: anchoring scoring, selector heuristics, serializers, redaction.
- Visual: widget in light/dark on fixture pages with hostile CSS.
- E2E (Playwright): every framework fixture × comment flow, bug flow, offline queue, re-attach after mutation script, CSP-strict page, iframe-heavy page, RTL page.
- Bundle size and main-thread budget checks in CI.
