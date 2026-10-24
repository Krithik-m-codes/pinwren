import { setNonce } from "./chunks";
import { hostMetadata } from "./config";
import { identityOf, urlPatternOf } from "./identity";
import * as lib from "./lib";
import { trimTrailingSlashes } from "./slashes";
import type { Identity } from "./store";
import type {
  IdentifyOptions,
  Mode,
  PageScope,
  PinwrenApi,
  PinwrenOptions,
  PinwrenUser,
  WidgetEvent,
} from "./types";
import { PinwrenWidget } from "./widget";

// Script-tag entry:
//   <script src="https://feedback.example.com/widget.js" data-project="pk_…" async></script>
// Optional attributes: data-endpoint="https://…" (defaults to the script's origin), data-accent="#d63a1c",
// data-locale="fr" (otherwise the browser's language; English fallback), data-url-pattern="/product/:id"
// (page scope), data-force-show (ignore the visibility rules), data-nonce="…" (CSP nonce for the chunks),
// data-allow-replay-in-privacy-mode, data-theme="light" | "dark" (otherwise the visitor's system setting).
//
// Public API (blueprint 05 §8): Pinwren.init / open / close / on / identify / setPageScope / setMetadata /
// show / hide / destroy. Calls
// made before this script loads can be queued as `window.Pinwren = { q: [["open", "comment"], …] }` — the npm
// entry (loader.ts) and @pinwren/react do exactly that. Events: open, close, submit, error, ready. A `ready`
// handler added after the widget is ready still runs.

type Handler = (data?: unknown) => void;

const g = window as unknown as {
  Pinwren?: PinwrenApi | { q?: unknown[] };
  __pinwrenInstance?: PinwrenWidget | undefined;
  __pinwrenLib?: typeof lib;
};
// Shared with the lazy chunks (see chunks.ts / build.mjs).
g.__pinwrenLib = lib;

// Chunks and locales are served next to widget.js, which may be a CDN rather than the API endpoint.
const script = document.currentScript as HTMLScriptElement | null;
const assetBase = (() => {
  try {
    return script?.src ? new URL(".", script.src).href.replace(/\/$/, "") : undefined;
  } catch {
    return undefined;
  }
})();
setNonce(script?.nonce || script?.dataset.nonce || undefined);

const handlers = new Map<WidgetEvent, Set<Handler>>();
let identity: Identity = {};
// Set before init (or kept across destroy → init), like the identity.
let metadata: Record<string, unknown> | null = null;
let shown: "show" | "hide" | null = null;
let pendingOpen: [Mode | undefined] | null = null;
let isReady = false;

const call = (cb: Handler, data?: unknown) => {
  try {
    cb(data);
  } catch (err) {
    console.warn("[pinwren] event handler failed", err);
  }
};

const emit = (event: WidgetEvent, data?: unknown) => {
  if (event === "ready") isReady = true;
  for (const cb of handlers.get(event) ?? []) call(cb, data);
};

/** Every entry point is wrapped: nothing the widget does may throw into the host page. */
const safe =
  <A extends unknown[], R>(fn: (...a: A) => R, fallback: R) =>
  (...a: A): R => {
    try {
      return fn(...a);
    } catch (err) {
      console.warn("[pinwren]", err);
      return fallback;
    }
  };

// The scope set before init, or kept across destroy → init (as React does on a remount).
let scope: string | undefined;

const init = safe((o: PinwrenOptions) => {
  if (g.__pinwrenInstance) return; // one widget per page
  if (typeof o.projectKey !== "string" || !o.projectKey || typeof o.endpoint !== "string") {
    console.warn("[pinwren] init needs a projectKey and an endpoint");
    return;
  }
  const endpoint = trimTrailingSlashes(o.endpoint);
  if (o.urlPattern !== undefined) scope = urlPatternOf(o.urlPattern);
  const w = new PinwrenWidget({
    projectKey: o.projectKey,
    endpoint,
    assets: assetBase ?? endpoint,
    accent: o.accent,
    locale: o.locale,
    forceShow: o.forceShow === true,
    urlPattern: scope,
    allowReplayInPrivacyMode: o.allowReplayInPrivacyMode === true,
    theme: o.theme,
    emit,
    identity,
    metadata,
    shown,
  });
  g.__pinwrenInstance = w;
  void w.start().catch((err: unknown) => console.warn("[pinwren]", err));
  if (pendingOpen) w.open(pendingOpen[0]);
  pendingOpen = null;
}, undefined);

const existing = g.Pinwren as { q?: unknown } | undefined;
const queued: unknown[] = Array.isArray(existing?.q) ? existing.q : [];
const noop = () => {
  // the fallback for a call that failed: nothing to return
};

const api: PinwrenApi = {
  init,
  open: safe((mode?: Mode) => {
    if (g.__pinwrenInstance) g.__pinwrenInstance.open(mode);
    else pendingOpen = [mode];
  }, undefined),
  close: safe(() => {
    pendingOpen = null;
    g.__pinwrenInstance?.close();
  }, undefined),
  on: safe((event: WidgetEvent, cb: Handler) => {
    if (typeof cb !== "function") return noop;
    const set = handlers.get(event) ?? new Set();
    set.add(cb);
    handlers.set(event, set);
    if (event === "ready" && isReady) queueMicrotask(() => set.has(cb) && call(cb));
    return () => set.delete(cb);
  }, noop) as PinwrenApi["on"],
  // Plain-JS hosts can pass anything; only well-typed fields are kept.
  identify: safe((user: PinwrenUser | null, opts?: IdentifyOptions) => {
    identity = identityOf(user, opts);
    g.__pinwrenInstance?.identify(identity);
  }, undefined),
  setMetadata: safe((m: Record<string, unknown> | null) => {
    const r = hostMetadata(m);
    if (r.error) {
      console.warn(`[pinwren] ${r.error}; ignored`);
      return;
    }
    metadata = r.ok;
    g.__pinwrenInstance?.setMetadata(metadata);
  }, undefined),
  show: safe(() => {
    shown = "show";
    g.__pinwrenInstance?.setShown("show");
  }, undefined),
  hide: safe(() => {
    shown = "hide";
    g.__pinwrenInstance?.setShown("hide");
  }, undefined),
  setPageScope: safe((s: PageScope | null) => {
    scope = urlPatternOf(s?.urlPattern);
    g.__pinwrenInstance?.setPageScope(scope);
  }, undefined),
  destroy: safe(() => {
    g.__pinwrenInstance?.destroy();
    g.__pinwrenInstance = undefined;
    isReady = false;
  }, undefined),
};
g.Pinwren = api;

for (const c of queued) {
  if (!Array.isArray(c)) continue;
  const [method, ...args] = c as [keyof PinwrenApi, ...unknown[]];
  const fn = api[method] as ((...a: unknown[]) => unknown) | undefined;
  if (typeof fn === "function") fn(...args);
}

const key = script?.dataset.project;
if (script && key) {
  const d = script.dataset;
  // A bare attribute (value "") counts as on; only "false" turns it off.
  const flag = (v: string | undefined) => v !== undefined && v !== "false";
  const start = () => {
    init({
      projectKey: key,
      endpoint: (d.endpoint ?? new URL(script.src).origin).replace(/\/$/, ""),
      accent: d.accent,
      locale: d.locale,
      urlPattern: d.urlPattern,
      forceShow: flag(d.forceShow),
      allowReplayInPrivacyMode: flag(d.allowReplayInPrivacyMode),
      theme: d.theme === "light" || d.theme === "dark" ? d.theme : undefined,
    });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}
