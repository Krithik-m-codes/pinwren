import * as lib from "./lib";
import type { Reporter } from "./store";
import { AnnotaWidget, type Mode, type WidgetEvent, type WidgetOptions } from "./widget";

// Script-tag entry:
//   <script src="https://feedback.example.com/widget.js" data-project="pk_…" async></script>
// Optional: data-accent="#5b5bd6", data-endpoint="https://…" (defaults to the script's origin),
// data-locale="fr" (otherwise the browser's language; English fallback).
//
// Public API (blueprint 05 §8): Annota.init / open / close / on / identify / destroy. Calls made before
// this script loads can be queued as `window.Annota = { q: [["open", "comment"], …] }`.
// Events: open, close, submit, error, ready. A `ready` handler added after the widget is ready still runs.

type Handler = (data?: unknown) => void;
type InitOptions = Pick<WidgetOptions, "projectKey" | "endpoint" | "accent" | "locale">;
type Api = {
  init(o: InitOptions): void;
  open(mode?: Mode): void;
  close(): void;
  on(event: WidgetEvent, cb: Handler): () => void;
  identify(user: Reporter): void;
  destroy(): void;
};

const g = window as unknown as {
  Annota?: Api & { q?: unknown[] };
  __annotaInstance?: AnnotaWidget;
  __annotaLib?: typeof lib;
};
// Shared with the lazy chunks (see chunks.ts / build.mjs).
g.__annotaLib = lib;
const handlers = new Map<WidgetEvent, Set<Handler>>();
let identity: Reporter = {};
let pendingOpen: [Mode | undefined] | null = null;
let isReady = false;

const call = (cb: Handler, data?: unknown) => {
  try {
    cb(data);
  } catch (err) {
    console.warn("[annota] event handler failed", err);
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
      console.warn("[annota]", err);
      return fallback;
    }
  };

const init = safe((opts: InitOptions) => {
  if (g.__annotaInstance) return; // one widget per page
  const w = new AnnotaWidget({ ...opts, emit, identity });
  g.__annotaInstance = w;
  void w.start().catch((err) => console.warn("[annota]", err));
  if (pendingOpen) w.open(pendingOpen[0]);
  pendingOpen = null;
}, undefined);

const queued = Array.isArray(g.Annota?.q) ? g.Annota.q : [];
const noop = () => {};

const api: Api = {
  init,
  open: safe((mode?: Mode) => {
    if (g.__annotaInstance) g.__annotaInstance.open(mode);
    else pendingOpen = [mode];
  }, undefined),
  close: safe(() => {
    pendingOpen = null;
    g.__annotaInstance?.close();
  }, undefined),
  on: safe((event: WidgetEvent, cb: Handler) => {
    if (typeof cb !== "function") return noop;
    const set = handlers.get(event) ?? new Set();
    set.add(cb);
    handlers.set(event, set);
    if (event === "ready" && isReady) queueMicrotask(() => set.has(cb) && call(cb));
    return () => set.delete(cb);
  }, noop),
  identify: safe((user: Reporter) => {
    identity = {
      name: typeof user?.name === "string" ? user.name.slice(0, 120) : undefined,
      email: typeof user?.email === "string" ? user.email.slice(0, 254) : undefined,
    };
    g.__annotaInstance?.identify(identity);
  }, undefined),
  destroy: safe(() => {
    g.__annotaInstance?.destroy();
    g.__annotaInstance = undefined;
    isReady = false;
  }, undefined),
};
g.Annota = api;

for (const call of queued) {
  if (!Array.isArray(call)) continue;
  const [method, ...args] = call as [keyof Api, ...unknown[]];
  const fn = api[method] as ((...a: unknown[]) => unknown) | undefined;
  if (typeof fn === "function") fn(...args);
}

const script = document.currentScript as HTMLScriptElement | null;
const key = script?.dataset.project;
if (script && key) {
  const start = () =>
    init({
      projectKey: key,
      endpoint: (script.dataset.endpoint ?? new URL(script.src).origin).replace(/\/$/, ""),
      accent: script.dataset.accent,
      locale: script.dataset.locale,
    });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}
