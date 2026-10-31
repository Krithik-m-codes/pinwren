import { HSTS_HEADER, httpsDecision } from "@pinwren/core";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import { getAuth } from "./auth";
import { ensureCloudDatabaseSecurity } from "./cloud-startup";
import { env } from "./env";
import { ApiError, problem } from "./errors";
import { csrfGuard } from "./guards";
import { clientIp, INTERNAL_REQUEST } from "./net";
import { dashboard } from "./routes/dashboard";
import { inbound } from "./routes/inbound";
import { projectData } from "./routes/project-data";
import { reviewLinks, reviewLinkWidget } from "./routes/review-links";
import { setup } from "./routes/setup";
import { signInMethods, signInSettings } from "./routes/sign-in-methods";
import { account } from "./routes/me";
import { members } from "./routes/members";
import { mcpRoutes } from "./routes/mcp";
import { pageLinks } from "./routes/page-links";
import { teamUnsubscribe, unsubscribe } from "./routes/unsubscribe";
import { v1 } from "./routes/v1";
import { aiRoutes } from "./routes/ai";
import { widget } from "./routes/widget";
import { guestPortal } from "./routes/guest";
import { workspace } from "./routes/workspace";

export { getAuth } from "./auth";
export { firstOrganizationFor } from "./db/identity";
export { env } from "./env";
export { startJobs, stopJobs } from "./jobs";
export { installPeerStamp } from "./net";
export {
  checkReleaseKeys,
  ensureInstanceAdmin,
  runStartupFixes,
  assertCloudDatabaseSecurity,
} from "./startup";

/** Dashboard JSON and token API bodies; the widget (screenshots, replays) has its own, larger caps. */
const API_MAX_BODY = 2 * 1024 * 1024;

const tooLarge = () => new ApiError(413, "PAYLOAD_TOO_LARGE", "Request body too large");

/**
 * Better Auth reads the client address from this header only (its rate limiter); it is always
 * overwritten with the address derived from PINWREN_TRUST_PROXY, so a client can't choose it.
 */
const AUTH_IP_HEADER = "x-pinwren-client-ip";

function authRequest(c: Parameters<typeof clientIp>[0]): Request {
  const headers = new Headers(c.req.raw.headers);
  const ip = clientIp(c);
  if (ip === "unknown") headers.delete(AUTH_IP_HEADER);
  else headers.set(AUTH_IP_HEADER, ip);
  return new Request(c.req.raw, { headers });
}

/** In-process requests (the /mcp tools call /api/v1 without a network hop). */
function internalFetch(req: Request): Promise<Response> {
  const headers = new Headers(req.headers);
  headers.set(INTERNAL_REQUEST.name, INTERNAL_REQUEST.value);
  return Promise.resolve(app.fetch(new Request(req, { headers })));
}

/**
 * The whole Pinwren HTTP API. Mounted by the Next.js app under /api and /w, and runnable on its own
 * with any Fetch-API server.
 */
export const app = new Hono()
  // PINWREN_ENFORCE_HTTPS (the Next.js proxy applies the same rule to pages; this covers the API when
  // it runs on its own).
  .use("*", async (c, next) => {
    const e = env();
    if (e.PINWREN_MODE === "cloud") await ensureCloudDatabaseSecurity();
    const d = httpsDecision(c.req.raw, {
      enforce: e.PINWREN_ENFORCE_HTTPS,
      trustProxy: e.PINWREN_TRUST_PROXY > 0,
    });
    if (d.action === "redirect") return c.redirect(d.location, 308);
    // Hono types a `use("*")` context's input as `any`; `problem` only uses the response helpers.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    if (d.action === "refuse") return problem(c, 403, "HTTPS_REQUIRED", "This server only accepts HTTPS");
    await next();
    if (d.hsts) c.res.headers.set("strict-transport-security", HSTS_HEADER);
  })
  // `version` lets `pinwren doctor` and monitors see what runs.
  .get("/api/health", (c) => c.json({ ok: true, version: env().PINWREN_VERSION }))
  // Bodies are capped while they stream in (Content-Length is checked first), before anything parses.
  .use(
    "/api/*",
    bodyLimit({
      maxSize: API_MAX_BODY,
      onError: () => {
        throw tooLarge();
      },
    }),
  )
  .use(
    "/mcp/*",
    bodyLimit({
      maxSize: API_MAX_BODY,
      onError: () => {
        throw tooLarge();
      },
    }),
  )
  .use(
    "/mcp",
    bodyLimit({
      maxSize: API_MAX_BODY,
      onError: () => {
        throw tooLarge();
      },
    }),
  )
  // Cookie-authenticated writes must come from our own pages, as JSON (ADR 0021).
  .use("/api/*", csrfGuard)
  .on(["GET", "POST"], "/api/auth/*", (c) => getAuth().handler(authRequest(c)))
  // Public first-run state (is there an account yet, may strangers sign up); no session.
  .route("/api", setup)
  // Public: which sign-in methods the auth pages offer (email link, passkey, Google, GitHub).
  .route("/api", signInMethods)
  // The signed-in person's own account (profile, avatar, email, invitations): no workspace needed, so
  // ahead of the dashboard's session middleware. Each route checks the session itself.
  .route("/api", account)
  // Token-authenticated public API first: the session middleware below covers the rest of /api.
  .route("/api/v1", v1)
  // Logos and tracker webhooks: no session (verified by random id / signature).
  .route("/api", inbound)
  .route("/api", unsubscribe)
  .route("/api", teamUnsubscribe)
  .route("/api", guestPortal)
  .route("/api", dashboard)
  // Users and workspace settings (wave-5 §3.1); after `dashboard`, whose session and viewer guards
  // (`use` on /api/*) run for them too.
  .route("/api", members)
  .route("/api", workspace)
  // Settings › Security › Sign-in methods (instance admins); after `dashboard` for its session guard.
  .route("/api/admin", signInSettings)
  // Signed page links + re-pin (wave-5 §3.3); after `dashboard`, whose session middleware covers /api/*.
  .route("/api", pageLinks)
  .route("/api", aiRoutes)
  // After the dashboard: its session and viewer guards (`use` on /api/*) run for these routes too.
  .route("/api", projectData)
  .route("/api", reviewLinks)
  .route("/w", widget)
  // After the widget router: its key/Origin check sets `project` and adds the CORS headers.
  .route("/w", reviewLinkWidget)
  // AI agents: MCP Streamable HTTP, token-authenticated (blueprint 04 §6).
  .route("/mcp", mcpRoutes(internalFetch))
  .notFound((c) => problem(c, 404, "NOT_FOUND", "Not found"))
  .onError((err, c) => {
    // Let the widget read its own errors (429, validation…). Only the error text is exposed.
    const origin = c.req.header("origin");
    if (origin && c.req.path.startsWith("/w/")) {
      c.header("access-control-allow-origin", origin);
      c.header("vary", "Origin");
    }
    if (err instanceof ApiError) return problem(c, err.status, err.code, err.message);
    if (err instanceof ZodError) return problem(c, 400, "VALIDATION_ERROR", "Invalid request");
    if (err instanceof HTTPException) return problem(c, err.status, "HTTP_ERROR", err.message);
    // A malformed id in the path (Postgres "invalid input syntax", e.g. for uuid) is a 404, not a crash.
    const e = err as { code?: string; cause?: { code?: string } };
    if ((e.cause?.code ?? e.code) === "22P02") return problem(c, 404, "NOT_FOUND", "Not found");
    console.error("[pinwren] unhandled error", err);
    return problem(c, 500, "INTERNAL_ERROR", "Something went wrong");
  });

export type AppType = typeof app;
