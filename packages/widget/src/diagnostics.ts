import type { CaptureCfg } from "./config";

// Console + failed-network ring buffers (blueprint F-005/F-006), sized by the project's `capture` config.
// Wrappers are transparent: they call the original first, never change arguments or results, and never throw.

type ConsoleEntry = { level: "error" | "warn" | "info" | "log" | "debug"; message: string; at: number };
type NetworkEntry = { method: string; url: string; status: number; durationMs: number; at: number };

const MAX_CONSOLE = 100;
const MAX_NETWORK = 50;
const SENSITIVE_PARAM = /token|key|secret|pass(word)?|auth|session|code|sig/i;

const consoleBuf: ConsoleEntry[] = [];
const networkBuf: NetworkEntry[] = [];
let installed = false;

function push<T>(buf: T[], item: T, max: number) {
  buf.push(item);
  if (buf.length > max) buf.shift();
}

function serialize(value: unknown, depth = 0): string {
  try {
    if (typeof value === "string") return value.slice(0, 1000);
    if (value instanceof Error) return `${value.name}: ${value.message}\n${value.stack ?? ""}`.slice(0, 2000);
    if (value instanceof Element) return `<${value.tagName.toLowerCase()}${value.id ? `#${value.id}` : ""}>`;
    if (typeof value !== "object" || value === null) return String(value);
    if (depth > 2) return "[Object]";
    const seen = new WeakSet();
    return (
      JSON.stringify(value, (_k, v) => {
        if (typeof v === "object" && v !== null) {
          if (seen.has(v)) return "[Circular]";
          seen.add(v);
        }
        return v;
      })?.slice(0, 1000) ?? String(value)
    );
  } catch {
    return "[Unserializable]";
  }
}

export function redactUrl(raw: string): string {
  try {
    const u = new URL(raw, location.href);
    for (const k of Array.from(u.searchParams.keys())) {
      if (SENSITIVE_PARAM.test(k)) u.searchParams.set(k, "[redacted]");
    }
    return u.origin === location.origin ? u.pathname + u.search : u.toString();
  } catch {
    return raw.slice(0, 500);
  }
}

const LEVELS = {
  off: [],
  errors: ["error"],
  warnings: ["error", "warn"],
  all: ["error", "warn", "info", "log", "debug"],
} as const;

let lcp: number | undefined;
/** Undo steps of the current install; `destroy()` runs them (blueprint 05 §3: wrappers are reversible). */
let undo: (() => void)[] = [];

/**
 * Replace `obj[key]` with a wrapper and register its removal. If something else wrapped it after us, we can't
 * unwrap without dropping their wrapper too — then ours stays in the chain but goes inert (`live.on`).
 */
function wrap<O extends object, K extends keyof O>(
  obj: O,
  key: K,
  make: (orig: O[K]) => O[K],
  live: { on: boolean },
) {
  const orig = obj[key];
  const ours = make(orig);
  obj[key] = ours;
  undo.push(() => {
    live.on = false;
    if (obj[key] === ours) obj[key] = orig;
  });
}

export function installDiagnostics(cfg: Pick<CaptureCfg, "console" | "network">) {
  if (installed) return;
  installed = true;
  const live = { on: true };

  try {
    // Largest Contentful Paint is only observable, not queryable; `buffered` replays what already happened.
    const po = new PerformanceObserver((list) => {
      const last = list.getEntries().at(-1);
      if (last) lcp = last.startTime;
    });
    po.observe({ type: "largest-contentful-paint", buffered: true });
    undo.push(() => po.disconnect());
  } catch {}

  for (const level of LEVELS[cfg.console]) {
    wrap(
      console,
      level,
      (original) =>
        function (this: Console, ...args: unknown[]) {
          original.apply(this, args);
          if (!live.on) return;
          try {
            push(
              consoleBuf,
              {
                level,
                message: args
                  .map((a) => serialize(a))
                  .join(" ")
                  .slice(0, 4000),
                at: Date.now(),
              },
              MAX_CONSOLE,
            );
          } catch {}
        },
      live,
    );
  }

  if (cfg.console !== "off") {
    const onError = (e: ErrorEvent) =>
      push(
        consoleBuf,
        { level: "error", message: serialize(e.error ?? e.message), at: Date.now() },
        MAX_CONSOLE,
      );
    const onRejection = (e: PromiseRejectionEvent) =>
      push(
        consoleBuf,
        { level: "error", message: `Unhandled rejection: ${serialize(e.reason)}`, at: Date.now() },
        MAX_CONSOLE,
      );
    addEventListener("error", onError);
    addEventListener("unhandledrejection", onRejection);
    undo.push(() => {
      removeEventListener("error", onError);
      removeEventListener("unhandledrejection", onRejection);
    });
  }
  installNetwork(cfg, live);
}

/** Restore console, fetch and XHR and stop listening; buffers are cleared. Safe to call repeatedly. */
export function uninstallDiagnostics() {
  for (const fn of undo.reverse()) {
    try {
      fn();
    } catch {}
  }
  undo = [];
  installed = false;
  consoleBuf.length = 0;
  networkBuf.length = 0;
}

function installNetwork(cfg: Pick<CaptureCfg, "network">, live: { on: boolean }) {
  if (cfg.network === "off") return;
  const record = (e: NetworkEntry) => live.on && push(networkBuf, e, MAX_NETWORK);
  wrap(
    window,
    "fetch",
    (originalFetch) =>
      async function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
        const started = performance.now();
        const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
        const url = input instanceof Request ? input.url : String(input);
        try {
          const res = await originalFetch.call(this, input, init);
          const ms = performance.now() - started;
          if ((res.status >= 400 || ms > 3000) && !url.includes("/w/"))
            record({ method, url: redactUrl(url), status: res.status, durationMs: ms, at: Date.now() });
          return res;
        } catch (err) {
          record({
            method,
            url: redactUrl(url),
            status: 0,
            durationMs: performance.now() - started,
            at: Date.now(),
          });
          throw err;
        }
      },
    live,
  );

  type Xhr = XMLHttpRequest & { __pinwren?: { m: string; u: string } };
  const proto = XMLHttpRequest.prototype;
  wrap(
    proto,
    "open",
    (open) =>
      function (this: Xhr, method: string, url: string | URL, ...rest: unknown[]) {
        this.__pinwren = { m: method.toUpperCase(), u: String(url) };
        // biome-ignore lint/suspicious/noExplicitAny: forwarding the original variadic signature
        return (open as any).call(this, method, url, ...rest);
      } as typeof proto.open,
    live,
  );
  wrap(
    proto,
    "send",
    (send) =>
      function (this: Xhr, body?: Document | XMLHttpRequestBodyInit | null) {
        const meta = this.__pinwren;
        const started = performance.now();
        if (meta) {
          this.addEventListener("loadend", () => {
            const ms = performance.now() - started;
            if (this.status >= 400 || this.status === 0 || ms > 3000)
              record({
                method: meta.m,
                url: redactUrl(meta.u),
                status: this.status,
                durationMs: ms,
                at: Date.now(),
              });
          });
        }
        return send.call(this, body);
      },
    live,
  );
}

export function snapshotDiagnostics() {
  return { console: consoleBuf.slice(), network: networkBuf.slice() };
}

/** Counts for the report form's "what we'll send" summary. */
export function diagnosticsSummary() {
  return {
    errors: consoleBuf.filter((c) => c.level === "error").length,
    failures: networkBuf.filter((n) => n.status === 0 || n.status >= 400).length,
  };
}

/** Page-load timing for `metadata.performance` (ms, rounded; absent when the browser doesn't report it). */
export function performanceTiming(): Record<string, number> {
  const out: Record<string, number> = {};
  const set = (k: string, v: number | undefined) => {
    if (typeof v === "number" && Number.isFinite(v) && v > 0) out[k] = Math.round(v);
  };
  try {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (nav) {
      set("ttfbMs", nav.responseStart - nav.startTime);
      set("domContentLoadedMs", nav.domContentLoadedEventEnd - nav.startTime);
      set("loadMs", nav.loadEventEnd - nav.startTime);
    }
    set("fcpMs", performance.getEntriesByName("first-contentful-paint")[0]?.startTime);
    set("lcpMs", lcp);
  } catch {}
  return out;
}
