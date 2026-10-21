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

export function installDiagnostics(cfg: Pick<CaptureCfg, "console" | "network">) {
  if (installed) return;
  installed = true;

  try {
    // Largest Contentful Paint is only observable, not queryable; `buffered` replays what already happened.
    new PerformanceObserver((list) => {
      const last = list.getEntries().at(-1);
      if (last) lcp = last.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
  } catch {}

  for (const level of LEVELS[cfg.console]) {
    const original = console[level];
    console[level] = function (...args: unknown[]) {
      original.apply(this, args);
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
    };
  }

  if (cfg.console === "off") return installNetwork(cfg);
  addEventListener("error", (e) => {
    push(
      consoleBuf,
      { level: "error", message: serialize(e.error ?? e.message), at: Date.now() },
      MAX_CONSOLE,
    );
  });
  addEventListener("unhandledrejection", (e) => {
    push(
      consoleBuf,
      { level: "error", message: `Unhandled rejection: ${serialize(e.reason)}`, at: Date.now() },
      MAX_CONSOLE,
    );
  });
  installNetwork(cfg);
}

function installNetwork(cfg: Pick<CaptureCfg, "network">) {
  if (cfg.network === "off") return;
  const originalFetch = window.fetch;
  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
    const started = performance.now();
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const url = input instanceof Request ? input.url : String(input);
    try {
      const res = await originalFetch.call(this, input, init);
      const ms = performance.now() - started;
      if ((res.status >= 400 || ms > 3000) && !url.includes("/w/")) {
        push(
          networkBuf,
          { method, url: redactUrl(url), status: res.status, durationMs: ms, at: Date.now() },
          MAX_NETWORK,
        );
      }
      return res;
    } catch (err) {
      push(
        networkBuf,
        { method, url: redactUrl(url), status: 0, durationMs: performance.now() - started, at: Date.now() },
        MAX_NETWORK,
      );
      throw err;
    }
  };

  const open = XMLHttpRequest.prototype.open;
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest & { __annota?: { m: string; u: string } },
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    this.__annota = { m: method.toUpperCase(), u: String(url) };
    // biome-ignore lint/suspicious/noExplicitAny: forwarding the original variadic signature
    return (open as any).call(this, method, url, ...rest);
  } as typeof XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.send = function (
    this: XMLHttpRequest & { __annota?: { m: string; u: string } },
    body?: Document | XMLHttpRequestBodyInit | null,
  ) {
    const meta = this.__annota;
    const started = performance.now();
    if (meta) {
      this.addEventListener("loadend", () => {
        const ms = performance.now() - started;
        if (this.status >= 400 || this.status === 0 || ms > 3000) {
          push(
            networkBuf,
            { method: meta.m, url: redactUrl(meta.u), status: this.status, durationMs: ms, at: Date.now() },
            MAX_NETWORK,
          );
        }
      });
    }
    return send.call(this, body);
  };
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
