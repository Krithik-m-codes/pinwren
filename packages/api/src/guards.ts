import { createMiddleware } from "hono/factory";
import { env } from "./env";
import { ApiError } from "./errors";

// Cross-site request forgery and content-type guards for the cookie-authenticated API (ADR 0021).
// SameSite=Lax cookies already stop most cross-site posts; this closes the rest (same-site subdomains,
// old browsers, top-level form posts) by refusing any state-changing request whose origin isn't ours.

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Token-authenticated, public or signature-verified: no session cookie is involved. */
const NO_COOKIE_AUTH = [
  /^\/api\/v1(\/|$)/,
  /^\/mcp(\/|$)/,
  /^\/w(\/|$)/,
  /^\/api\/integrations\/(github|gitlab)\/webhook$/,
];

/** Bodies here aren't the dashboard's JSON: Better Auth's own forms, and RFC 8058 one-click unsubscribe. */
const ANY_CONTENT_TYPE = [/^\/api\/auth(\/|$)/, /^\/api\/unsubscribe$/];

let ownOrigin: string | undefined;
const appOrigin = () => (ownOrigin ??= new URL(env().PINWREN_URL).origin);

const hasBody = (h: Headers) =>
  (h.get("transfer-encoding") ?? "") !== "" || Number(h.get("content-length") ?? 0) > 0;

export type CsrfVerdict = "ok" | "cross_site" | "bad_content_type";

/** Pure decision, unit-tested; the middleware below only maps it to errors. */
export function csrfVerdict(method: string, path: string, headers: Headers, origin: string): CsrfVerdict {
  if (SAFE_METHODS.has(method.toUpperCase())) return "ok";
  if (NO_COOKIE_AUTH.some((r) => r.test(path))) return "ok";
  if (headers.get("cookie")) {
    const site = headers.get("sec-fetch-site");
    const from = headers.get("origin");
    // Browsers send Sec-Fetch-Site on every request; Origin on every non-GET. A request with neither
    // didn't come from a page of ours.
    if (site && site !== "same-origin") return "cross_site";
    if (from ? from !== origin : site !== "same-origin") return "cross_site";
  }
  if (hasBody(headers) && !ANY_CONTENT_TYPE.some((r) => r.test(path))) {
    const type = (headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
    if (type !== "application/json") return "bad_content_type";
  }
  return "ok";
}

export const csrfGuard = createMiddleware(async (c, next) => {
  const verdict = csrfVerdict(c.req.method, c.req.path, c.req.raw.headers, appOrigin());
  if (verdict === "cross_site") {
    throw new ApiError(403, "CROSS_SITE_REQUEST", "Cross-site requests are not allowed");
  }
  if (verdict === "bad_content_type") {
    throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Send the request body as application/json");
  }
  await next();
});
