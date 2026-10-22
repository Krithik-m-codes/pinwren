import { isIP } from "node:net";
import { truncateIp } from "@pinwren/core";
import type { Context } from "hono";
import { env } from "./env";

/**
 * The server stamps each request with the TCP peer address under a header name that is random per
 * process (`installPeerStamp`, called at startup), so no client can send it. Route handlers in Next.js
 * have no other way to see the socket.
 */
const PEER_KEY = Symbol.for("pinwren.peerHeader");
type PeerGlobal = { [PEER_KEY]?: string };

export function peerHeaderName(): string | undefined {
  return (globalThis as PeerGlobal)[PEER_KEY];
}

type EmitFn = (event: string | symbol, ...args: unknown[]) => boolean;

/** Patches `http.Server` so every request carries its socket address (idempotent). */
export function installPeerStamp(httpModule: { Server: { prototype: object } }): void {
  const g = globalThis as PeerGlobal;
  if (g[PEER_KEY]) return;
  const name = `x-pinwren-peer-${crypto.randomUUID().replaceAll("-", "")}`;
  g[PEER_KEY] = name;
  // node:http's overloaded `emit` signature doesn't fit a plain function type; the patch only
  // forwards its arguments.
  const proto = httpModule.Server.prototype as { emit: EmitFn };
  const emit = proto.emit;
  proto.emit = function (this: unknown, event: string | symbol, ...args: unknown[]) {
    if (event === "request") {
      const req = args[0] as { headers?: Record<string, unknown>; socket?: { remoteAddress?: string } };
      // Assignment replaces anything a client sent under the same name.
      if (req.headers) req.headers[name] = req.socket?.remoteAddress ?? "";
    }
    return emit.call(this, event, ...args);
  };
}

/**
 * Marks requests the app sends to itself (the /mcp tools calling /api/v1 in process). Random per
 * process, so no outside request can carry it.
 */
export const INTERNAL_REQUEST = {
  name: "x-pinwren-internal",
  value: crypto.randomUUID(),
} as const;

export const isInternalRequest = (headers: Headers) =>
  headers.get(INTERNAL_REQUEST.name) === INTERNAL_REQUEST.value;

function cleanIp(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  let s = raw.trim();
  // "[::1]:1234" / "1.2.3.4:5678" → address only.
  const bracket = /^\[([^\]]+)\](?::\d+)?$/.exec(s);
  if (bracket?.[1]) s = bracket[1];
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(s)) s = s.replace(/:\d+$/, "");
  return isIP(s) ? s.toLowerCase() : undefined;
}

/**
 * The caller's address, trusting exactly `hops` reverse proxies (PINWREN_TRUST_PROXY): walking the
 * X-Forwarded-For chain from the right, the first entry the trusted proxies didn't add themselves.
 * With no trusted proxy, forwarded headers are ignored entirely (X-Real-IP never counts) and the socket
 * address is used; "unknown" when it can't be seen.
 */
export function resolveClientIp(headers: Headers, hops: number, peerHeader = peerHeaderName()): string {
  const peer = cleanIp(peerHeader ? headers.get(peerHeader) : undefined);
  if (hops <= 0) return peer ?? "unknown";
  const forwarded = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .reverse();
  // Nearest first: the socket peer (when known) is the first trusted proxy, then XFF right to left.
  const chain = peerHeader ? [peer ?? "unknown", ...forwarded] : forwarded;
  const index = Math.min(peerHeader ? hops : hops - 1, chain.length - 1);
  if (index < 0) return "unknown";
  return cleanIp(chain[index]) ?? "unknown";
}

/** In privacy mode (F-021) only the network part is kept, so no table or log holds a full address. */
export function clientIp(c: Context, opts: { privacy?: boolean } = {}): string {
  const ip = resolveClientIp(c.req.raw.headers, env().PINWREN_TRUST_PROXY);
  return opts.privacy && ip !== "unknown" ? truncateIp(ip) : ip;
}

/** "Chrome 140.0.1" → "Chrome": privacy mode keeps the browser/OS family only. */
export const family = (s: string | undefined) => s?.replace(/[\s/]*v?\d[\w.]*/g, "").trim() || undefined;
