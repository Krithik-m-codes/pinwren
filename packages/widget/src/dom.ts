// Tiny element builder: no framework, no innerHTML for untrusted text (blueprint 09 — XSS).
// `on*` handlers may be async: h() wraps them in guard(), which also catches a rejected promise.
type Attrs = Record<string, string | number | boolean | ((e: Event) => unknown) | undefined>;

/** Wrap a handler so a widget bug is logged instead of surfacing in the host page's error handlers. */
export const guard =
  (fn: (e: Event) => unknown): EventListener =>
  (e) => {
    try {
      const r = fn(e);
      if (r instanceof Promise) r.catch((err: unknown) => console.warn("[pinwren]", err));
    } catch (err) {
      console.warn("[pinwren]", err);
    }
  };

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), guard(v));
    else if (k === "class") el.className = String(v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

/** Static, trusted SVG icons only — never used for user content. */
export function icon(svg: string): HTMLElement {
  const span = document.createElement("span");
  span.style.display = "contents";
  span.innerHTML = svg;
  return span;
}

/** Add a chunk's stylesheet to the widget's shadow root once. */
export function adoptStyle(root: HTMLElement, id: string, css: string) {
  const top = root.getRootNode();
  // Normally the widget's shadow root; the document only if the widget was mounted without one.
  const target = top instanceof Document ? top.head : top instanceof ShadowRoot ? top : root;
  if (target.querySelector(`style[data-chunk="${id}"]`)) return;
  const style = document.createElement("style");
  style.dataset.chunk = id;
  style.textContent = css;
  target.append(style);
}

const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]):not([type=hidden]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The focused element, looking inside the shadow root `node` lives in (closed roots are invisible otherwise). */
export function focused(node: Node): Element | null {
  const r = node.getRootNode() as ShadowRoot | Document;
  return r.activeElement ?? document.activeElement;
}

/**
 * Keep Tab / Shift+Tab inside `box` while focus is in it (blueprint 05 §9), and return a release function that
 * puts focus back on the first of `openers` still on screen — but only if focus is still inside the box or
 * has fallen to <body>, so a click into the page is never undone.
 */
export function trapFocus(box: HTMLElement, ...openers: (Element | null | undefined)[]): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const items = Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => el.getClientRects().length > 0,
    );
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) {
      e.preventDefault();
      return;
    }
    const cur = focused(box);
    if (e.shiftKey && (cur === first || cur === box)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && cur === last) {
      e.preventDefault();
      first.focus();
    }
  };
  box.addEventListener("keydown", onKey);
  return () => {
    box.removeEventListener("keydown", onKey);
    const cur = focused(box);
    const lost = !cur || cur === document.body || box.contains(cur) || !cur.isConnected;
    if (!lost) return;
    const back = openers.find(
      (o): o is HTMLElement =>
        o instanceof HTMLElement && o.isConnected && o !== document.body && o.getClientRects().length > 0,
    );
    back?.focus({ preventScroll: true });
  };
}

/** A stroke icon in the widget's style (24×24, currentColor). */
const svg = (d: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const ICONS = {
  // The Pinwren mark as one filled shape (brand/pinwren-mark-small.svg): the bird-pin with its eye cut out.
  logo: '<svg viewBox="150 128 560 560" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M159 156c2 56 17 74 81 102l90 43-37-8c-48-12-77-23-105-38l-9-5v3c0 10 5 28 12 41 13 27 38 40 99 52q34 6-12 5c-28 1-34 0-51-6l-9-2 3 11q10 29 38 68l169 237c2 0 152-213 159-223 21-31 36-66 39-93v-53q-3-1 10-10l59-44-80 5h-8l-6-9q-17-22-46-33c-28-11-66-12-95-2-26 9-37 18-73 54l-29 29-8-5-15-11-116-86-59-42zM542 245c-14 8-18 24-10 36 15 21 47 11 47-15 0-18-21-30-37-21"/></svg>',
  comment: svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
  bug: svg(
    '<path d="m8 2 1.9 1.9M16 2l-1.9 1.9M9 7.1V6a3 3 0 1 1 6 0v1.1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6Z"/><path d="M12 20v-9M6.5 13H3M21 13h-3.5M6 9 3 7M18 9l3-2M6 17l-3 2M18 17l3 2"/>',
  ),
  eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  list: svg('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  clip: svg(
    '<path d="m21 11-8.6 8.6a5 5 0 0 1-7-7l8.5-8.6a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l8-7.9"/>',
  ),
};
