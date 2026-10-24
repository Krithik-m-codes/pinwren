// npm entry of @pinwren/widget (`import { init } from "@pinwren/widget"`).
//
// This module is a few hundred bytes: it doesn't bundle the widget. `init()` adds `<endpoint>/widget.js` —
// the core your Pinwren server ships, which always matches its hashed chunks and its API — and every call
// made before that script has run is queued on `window.Pinwren.q`, which widget.js replays. Safe to import
// during server-side rendering: nothing touches `window` until a function is called in a browser.

// --- Public types (blueprint 05 §8). They live here so the npm declaration file is self-contained;
// src/types.ts re-exports them for the widget's own modules. ---------------------------------------------

/** `"page"` opens the composer for a comment on the whole page (no pin; wave-5 §3.3). */
export type Mode = "comment" | "bug" | "panel" | "page";
export type WidgetEvent = "open" | "close" | "submit" | "error" | "ready";

/** What each event hands its handlers. */
export type EventMap = {
  open: { mode: string };
  close: undefined;
  submit: { id: string; number: number; kind: string };
  error: { message: string };
  ready: undefined;
};

export type Handler<E extends WidgetEvent = WidgetEvent> = (data: EventMap[E]) => void;

/** The person using the host app. `id` is what a signed identity signs (wave-4 §4). */
export type PinwrenUser = {
  id?: string | undefined;
  name?: string | undefined;
  email?: string | undefined;
};

export type IdentifyOptions = {
  /** Hex HMAC-SHA256 of `user.id` with the project's identity secret, computed on your server. */
  signature?: string | undefined;
};

export type PageScope = {
  /** Groups pins across pages that share a template, e.g. `/product/:id`. `null` clears it. */
  urlPattern?: string | null | undefined;
};

export type PinwrenOptions = {
  /** Public project key (`pk_…`). */
  projectKey: string;
  /** Origin of your Pinwren server, e.g. `https://feedback.example.com`. */
  endpoint: string;
  /** Launcher colour override (hex). */
  accent?: string | undefined;
  /** UI language; defaults to the browser's. */
  locale?: string | undefined;
  /** Show the widget even where the project's visibility rules would hide it (production hosts, small screens). */
  forceShow?: boolean | undefined;
  /** Page scope for pins and new feedback; see {@link PageScope}. */
  urlPattern?: string | undefined;
  /** Privacy mode turns session replay off; set this to keep it on anyway (you take care of consent). */
  allowReplayInPrivacyMode?: boolean | undefined;
  /** Light or dark widget UI; "auto" (the default) follows the visitor's system setting. */
  theme?: "light" | "dark" | "auto" | undefined;
};

/** `window.Pinwren` once widget.js has loaded. */
export type PinwrenApi = {
  init: (options: PinwrenOptions) => void;
  open: (mode?: Mode) => void;
  close: () => void;
  on: <E extends WidgetEvent>(event: E, handler: Handler<E>) => () => void;
  identify: (user: PinwrenUser | null, options?: IdentifyOptions) => void;
  setPageScope: (scope: PageScope | null) => void;
  /**
   * Context sent with every bug report and comment from now on (plan, account id, feature flags…): a plain JSON
   * object of at most 14 KB, shown in the dashboard's Details. `null` clears it.
   */
  setMetadata: (metadata: Record<string, unknown> | null) => void;
  /** Show the widget, whatever the project's visibility mode says (e.g. mode "manual"). */
  show: () => void;
  /** Hide the widget (launcher, pins, open cards) until `show()`. */
  hide: () => void;
  destroy: () => void;
};

type Stub = { q: unknown[][] };
type Win = { Pinwren?: PinwrenApi | Stub };

const browser = () => typeof window !== "undefined" && typeof document !== "undefined";

/** The loaded API, or null while widget.js hasn't run yet (or outside a browser). */
function api(): PinwrenApi | null {
  if (!browser()) return null;
  const p = (window as Win).Pinwren;
  return p && typeof (p as Partial<PinwrenApi>).init === "function" ? (p as PinwrenApi) : null;
}

/** Run `method` now if widget.js is loaded, otherwise queue it for widget.js to replay. */
function invoke(method: keyof PinwrenApi, ...args: unknown[]): void {
  if (!browser()) return;
  try {
    const real = api();
    if (real) {
      (real[method] as (...a: unknown[]) => unknown)(...args);
      return;
    }
    const w = window as Win;
    const stub = (w.Pinwren ??= { q: [] }) as Stub;
    if (!Array.isArray(stub.q)) stub.q = [];
    stub.q.push([method, ...args]);
  } catch (err) {
    console.warn("[pinwren]", err);
  }
}

let loading: Promise<PinwrenApi> | null = null;

/**
 * Add `<endpoint>/widget.js` to the page once and resolve with `window.Pinwren` when it has run. Calls made
 * meanwhile are queued, so awaiting this is optional.
 */
export function load(endpoint: string, opts: { nonce?: string | undefined } = {}): Promise<PinwrenApi> {
  if (!browser()) return Promise.reject(new Error("Pinwren only runs in a browser"));
  const ready = api();
  if (ready) return Promise.resolve(ready);
  if (loading) return loading;
  const base = endpoint.replace(/\/+$/, "");
  loading = new Promise<PinwrenApi>((resolve, reject) => {
    // Another copy of this loader (say, @pinwren/react's bundled one) may have added the script already.
    const existing = document.querySelector<HTMLScriptElement>("script[data-pinwren-loader]");
    const s = existing ?? document.createElement("script");
    s.addEventListener("load", () => {
      const real = api();
      if (real) resolve(real);
      else reject(new Error(`${s.src} did not start`));
    });
    s.addEventListener("error", () => {
      reject(new Error(`Couldn't load ${s.src}`));
    });
    if (existing) return;
    s.src = `${base}/widget.js`;
    s.async = true;
    s.dataset.pinwrenLoader = "";
    if (opts.nonce) {
      s.nonce = opts.nonce;
      s.dataset.nonce = opts.nonce;
    }
    document.head.append(s);
  }).catch((err: unknown) => {
    loading = null; // a later init() may retry
    throw err;
  });
  return loading;
}

/** Start the widget: loads widget.js from `endpoint` and initialises it (once per page). */
export function init(options: PinwrenOptions & { nonce?: string | undefined }): void {
  if (!browser()) return;
  const { nonce, ...rest } = options;
  invoke("init", rest);
  if (!api())
    load(options.endpoint, { nonce }).catch((err: unknown) => {
      console.warn("[pinwren]", err instanceof Error ? err.message : err);
    });
}

/** Open the menu, or a mode directly: `"comment"`, `"bug"` or `"panel"`. */
export const open = (mode?: Mode): void => {
  invoke("open", ...(mode ? [mode] : []));
};
export const close = (): void => {
  invoke("close");
};
/** Who is using the host app; `signature` makes them a verified reporter (see the README). */
export const identify = (user: PinwrenUser | null, options?: IdentifyOptions): void => {
  invoke("identify", user, options);
};
/** Group pins across pages of one template, e.g. `{ urlPattern: "/product/:id" }`; `null` clears it. */
export const setPageScope = (scope: PageScope | null): void => {
  invoke("setPageScope", scope);
};
/** Context for every report and comment (plain JSON object, ≤ 14 KB); `null` clears it. */
export const setMetadata = (metadata: Record<string, unknown> | null): void => {
  invoke("setMetadata", metadata);
};
/** Show the widget, overriding the project's visibility mode. */
export const show = (): void => {
  invoke("show");
};
/** Hide the widget until `show()`. */
export const hide = (): void => {
  invoke("hide");
};
/** Remove the widget completely: UI, listeners, capture wrappers and session replay. */
export const destroy = (): void => {
  invoke("destroy");
};

/** Listen to `open`, `close`, `submit`, `error` or `ready`. Returns the unsubscribe function. */
export function on<E extends WidgetEvent>(event: E, handler: Handler<E>): () => void {
  if (!browser()) return () => undefined;
  let live = true;
  let off: (() => void) | undefined;
  const wrapped = ((data: EventMap[E]) => {
    if (live) handler(data);
  }) as Handler<E>;
  const real = api();
  if (real) off = real.on(event, wrapped);
  else invoke("on", event, wrapped); // replayed by widget.js; `live` makes the unsubscribe work before then
  return () => {
    live = false;
    off?.();
  };
}
