import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import { getAuth } from "./auth";
import { ApiError, problem } from "./errors";
import { dashboard } from "./routes/dashboard";
import { widget } from "./routes/widget";

export { getAuth } from "./auth";
export { env } from "./env";

/**
 * The whole Annota HTTP API. Mounted by the Next.js app under /api and /w, and runnable on its own
 * with any Fetch-API server.
 */
export const app = new Hono()
  .get("/api/health", (c) => c.json({ ok: true }))
  .on(["GET", "POST"], "/api/auth/*", (c) => getAuth().handler(c.req.raw))
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
    console.error("[annota] unhandled error", err);
    return problem(c, 500, "INTERNAL_ERROR", "Something went wrong");
  });

export type AppType = typeof app;
