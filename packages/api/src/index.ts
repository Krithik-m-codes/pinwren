import { HSTS_HEADER, httpsDecision } from "@pinwren/core";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import { getAuth } from "./auth";
import { env } from "./env";
import { ApiError, problem } from "./errors";
import { dashboard } from "./routes/dashboard";
import { inbound } from "./routes/inbound";
import { v1 } from "./routes/v1";
import { widget } from "./routes/widget";

export { getAuth } from "./auth";
export { env } from "./env";
export { startJobs, stopJobs } from "./jobs";

/**
 * The whole Pinwren HTTP API. Mounted by the Next.js app under /api and /w, and runnable on its own
 * with any Fetch-API server.
 */
export const app = new Hono()
  // PINWREN_ENFORCE_HTTPS (the Next.js proxy applies the same rule to pages; this covers the API when
  // it runs on its own).
  .use("*", async (c, next) => {
    const e = env();
    const d = httpsDecision(c.req.raw, { enforce: e.PINWREN_ENFORCE_HTTPS, trustProxy: e.PINWREN_TRUST_PROXY });
    if (d.action === "redirect") return c.redirect(d.location, 308);
    if (d.action === "refuse") return problem(c, 403, "HTTPS_REQUIRED", "This server only accepts HTTPS");
    await next();
    if (d.hsts) c.res.headers.set("strict-transport-security", HSTS_HEADER);
  })
  .get("/api/health", (c) => c.json({ ok: true }))
  .on(["GET", "POST"], "/api/auth/*", (c) => getAuth().handler(c.req.raw))
  // Token-authenticated public API first: the session middleware below covers the rest of /api.
  .route("/api/v1", v1)
  // Logos and tracker webhooks: no session (verified by random id / signature).
  .route("/api", inbound)
  .route("/api", dashboard)
  .route("/w", widget)
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
