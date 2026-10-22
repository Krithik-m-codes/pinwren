import "server-only";
import { app, env } from "@pinwren/api";
import { headers } from "next/headers";
import { connection } from "next/server";
import { cache } from "react";

export type ServerResult<T> = { ok: true; data: T } | { ok: false; status: number; code: string };

/**
 * `GET /api/…` for server components, in process: the request goes through the same Hono app (and the
 * same session check and authorisation) as the browser's, with the visitor's cookie. Deduplicated per
 * request. Only for reads — writes go through the client (RTK Query) or a server action.
 */
export const serverApi = cache(async <T>(path: string): Promise<ServerResult<T>> => {
  // Request-time only: the API checks the session against the clock, which can't be part of a prerender.
  await connection();
  const h = await headers();
  const url = new URL(`/api${path}`, env().PINWREN_URL);
  const res = await app.fetch(
    new Request(url, { headers: { cookie: h.get("cookie") ?? "", accept: "application/json" } }),
  );
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const code = body && typeof body === "object" && "code" in body ? String(body.code) : "ERROR";
    return { ok: false, status: res.status, code };
  }
  return { ok: true, data: body as T };
});
