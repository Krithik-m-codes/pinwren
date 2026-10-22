import "server-only";
import { DEMO_KEY, peekVisitor, visitor } from "./store";

// Request plumbing shared by the demo API route handlers: problem-details errors like the real API
// (packages/api/src/errors.ts), the visitor lookup and a small fixed-window rate limiter.

export const DEMO_COOKIE = "pinwren_demo";
/** Same request size the real server accepts for a report with a screenshot and attachments. */
const MAX_BODY_BYTES = 12 * 1024 * 1024;
/** New sandboxes per client address per minute (all clients share one address unless a proxy is trusted). */
const NEW_SANDBOXES_PER_MINUTE = 60;

export function problem(status: number, code: string, title: string) {
  return Response.json(
    { type: `https://pinwren.dev/errors/${code.toLowerCase().replaceAll("_", "-")}`, title, status, code },
    { status, headers: { "content-type": "application/problem+json", "cache-control": "no-store" } },
  );
}

export const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "cache-control": "no-store" } });

const windows = new Map<string, { start: number; count: number }>();
const MAX_WINDOWS = 20_000;

/** At most `limit` hits per `key` per minute. In-memory and per process, which is all the demo needs. */
export function allow(key: string, limit: number): boolean {
  const t = Date.now();
  const w = windows.get(key);
  if (!w || t - w.start >= 60_000) {
    // Bounded: oldest windows go first (insertion order), so a flood of keys can't reset everyone's budget.
    windows.delete(key);
    for (const k of windows.keys()) {
      if (windows.size < MAX_WINDOWS) break;
      windows.delete(k);
    }
    windows.set(key, { start: t, count: 1 });
    return true;
  }
  w.count++;
  return w.count <= limit;
}

/** The rate-limit bucket for requests whose client address can't be trusted: one shared bucket. */
export const UNKNOWN_CLIENT = "unknown";

/**
 * Trusted reverse-proxy hops in front of the site, the main app's convention: `PINWREN_TRUST_PROXY` is a
 * hop count, `true` means 1, unset / `false` / `0` trusts none.
 */
export function trustedProxyHops(): number {
  const raw = process.env.PINWREN_TRUST_PROXY?.trim().toLowerCase();
  if (!raw || raw === "false") return 0;
  if (raw === "true") return 1;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

/**
 * The client address used for rate limits. Request headers are client-controlled, so nothing is believed by
 * default and every request shares the `unknown` bucket (the store's global caps still bound memory):
 * - `DEMO_TRUST_PLATFORM_IP_HEADER` names a header the hosting platform sets and overwrites itself, e.g.
 *   `x-vercel-forwarded-for` on Vercel. Only set it where the platform guarantees that header.
 * - Otherwise, with `PINWREN_TRUST_PROXY` = N hops, X-Forwarded-For is read from the right: each trusted
 *   proxy appended one entry, so the entry N from the end is the address the outermost proxy saw (the
 *   leftmost when there are fewer). Entries further left are whatever the client sent.
 * `x-real-ip` is never read: a proxy that doesn't set it passes the client's value straight through.
 */
export function clientIp(req: Request): string {
  const platform = process.env.DEMO_TRUST_PLATFORM_IP_HEADER?.trim();
  if (platform) {
    try {
      const ip = req.headers.get(platform)?.split(",")[0]?.trim();
      if (ip) return ip.slice(0, 64);
    } catch {
      // Not a valid header name; fall through.
    }
  }
  const hops = trustedProxyHops();
  if (!hops) return UNKNOWN_CLIENT;
  const entries = (req.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  const ip = entries[Math.max(0, entries.length - hops)];
  return ip ? ip.slice(0, 64) : UNKNOWN_CLIENT;
}

/** Same-origin only: the demo widget runs on this site, so a foreign Origin is someone else's page. */
function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const forwarded = trustedProxyHops() > 0 ? req.headers.get("x-forwarded-host") : null;
  const host = forwarded ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

type Guarded = { ok: true; key: string } | { ok: false; res: Response };

/** Widget requests: the demo project key (one sandbox per visitor), this site's origin, a read budget. */
export function widgetGuard(req: Request): Guarded {
  const key = req.headers.get("x-pinwren-key") ?? new URL(req.url).searchParams.get("key");
  if (!key)
    return { ok: false, res: problem(401, "MISSING_PROJECT_KEY", "x-pinwren-key header is required") };
  if (!DEMO_KEY.test(key))
    return { ok: false, res: problem(401, "INVALID_PROJECT_KEY", "Unknown project key") };
  if (!sameOrigin(req)) {
    return {
      ok: false,
      res: problem(403, "ORIGIN_NOT_ALLOWED", "This site is not on the project's allowed origins"),
    };
  }
  if (!allow(`read:${clientIp(req)}`, 300)) {
    return { ok: false, res: problem(429, "RATE_LIMITED", "Too many requests — try again in a minute") };
  }
  const opened = openSandbox(req, key);
  if (opened) return { ok: false, res: opened };
  return { ok: true, key };
}

/**
 * Touch the visitor's sandbox, creating it on first use. New sandboxes have their own per-address budget:
 * keys are minted by the browser, so without it one client could churn through the store's sandbox cap and
 * evict everyone else's.
 */
export function openSandbox(req: Request, key: string): Response | null {
  if (!peekVisitor(key) && !allow(`sandbox:${clientIp(req)}`, NEW_SANDBOXES_PER_MINUTE)) {
    return problem(429, "RATE_LIMITED", "Too many demo sandboxes — try again in a minute");
  }
  visitor(key);
  return null;
}

/** A write: per-visitor and per-IP budgets, like the real per-IP-per-project limit (default 10/min). */
export function writeAllowed(
  req: Request,
  key: string,
  kind: "report" | "reply" | "status",
): Response | null {
  const ip = clientIp(req);
  const perVisitor = kind === "report" ? 10 : 30;
  if (!allow(`${kind}:${key}`, perVisitor) || !allow(`write:${ip}`, 60)) {
    return problem(
      429,
      "RATE_LIMITED",
      kind === "reply"
        ? "Too many replies — try again in a minute"
        : "Too many reports — try again in a minute",
    );
  }
  return null;
}

/** Parse a JSON body with a size cap; `null` means it was too large or not JSON. */
export async function readJson(req: Request): Promise<unknown> {
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return null;
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** The inbox and reset endpoints identify the visitor by the cookie the demo page set. */
export function cookieKey(req: Request): string | null {
  const raw = req.headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === DEMO_COOKIE) {
      const value = decodeURIComponent(rest.join("="));
      return DEMO_KEY.test(value) ? value : null;
    }
  }
  return null;
}

export { peekVisitor };
