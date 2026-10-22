import "server-only";
import { DEMO_KEY, peekVisitor, visitor } from "./store";

// Request plumbing shared by the demo API route handlers: problem-details errors like the real API
// (packages/api/src/errors.ts), the visitor lookup and a small fixed-window rate limiter.

export const DEMO_COOKIE = "pinwren_demo";
/** Same request size the real server accepts for a report with a screenshot and attachments. */
const MAX_BODY_BYTES = 12 * 1024 * 1024;

export function problem(status: number, code: string, title: string) {
  return Response.json(
    { type: `https://pinwren.dev/errors/${code.toLowerCase().replaceAll("_", "-")}`, title, status, code },
    { status, headers: { "content-type": "application/problem+json", "cache-control": "no-store" } },
  );
}

export const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "cache-control": "no-store" } });

const windows = new Map<string, { start: number; count: number }>();

/** At most `limit` hits per `key` per minute. In-memory and per process, which is all the demo needs. */
export function allow(key: string, limit: number): boolean {
  const t = Date.now();
  const w = windows.get(key);
  if (!w || t - w.start >= 60_000) {
    if (windows.size > 20_000) windows.clear();
    windows.set(key, { start: t, count: 1 });
    return true;
  }
  w.count++;
  return w.count <= limit;
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || req.headers.get("x-real-ip") || "local";
}

/** Same-origin only: the demo widget runs on this site, so a foreign Origin is someone else's page. */
function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
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
  visitor(key);
  return { ok: true, key };
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
