import { truncateIp } from "@annota/core";
import type { Context } from "hono";
import { env } from "./env";

/**
 * The caller's IP for rate limiting. X-Forwarded-For counts only behind a trusted proxy. In privacy
 * mode (F-021) only the network part is kept, so neither the rate-limit table nor a log line holds a
 * full visitor address.
 */
export function clientIp(c: Context, opts: { privacy?: boolean } = {}): string {
  let ip: string | undefined;
  if (env().ANNOTA_TRUST_PROXY) ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || undefined;
  ip ??= c.req.header("x-real-ip") ?? "unknown";
  return opts.privacy && ip !== "unknown" ? truncateIp(ip) : ip;
}

/** "Chrome 140.0.1" → "Chrome": privacy mode keeps the browser/OS family only. */
export const family = (s: string | undefined) => s?.replace(/[\s/]*v?\d[\w.]*/g, "").trim() || undefined;
