// Pure request-security helpers shared by the Next.js proxy (pages) and the Hono API.

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export type HttpsDecision =
  | { action: "pass"; hsts: boolean }
  | { action: "redirect"; location: string }
  | { action: "refuse" };

/**
 * `ANNOTA_ENFORCE_HTTPS`: plain-HTTP requests are redirected (GET/HEAD) or refused (anything else,
 * so a form post never silently loses its body). Requests to localhost are exempt so health checks
 * and local development keep working. `X-Forwarded-Proto` / `X-Forwarded-Host` count only behind a
 * trusted proxy — otherwise any client could claim https.
 */
export function httpsDecision(
  req: { url: string; method: string; headers: { get(name: string): string | null } },
  opts: { enforce: boolean; trustProxy: boolean },
): HttpsDecision {
  if (!opts.enforce) return { action: "pass", hsts: false };
  const url = new URL(req.url);
  const first = (v: string | null) => v?.split(",")[0]?.trim().toLowerCase() || null;
  const proto =
    (opts.trustProxy ? first(req.headers.get("x-forwarded-proto")) : null) ?? url.protocol.replace(":", "");
  const host = (opts.trustProxy ? first(req.headers.get("x-forwarded-host")) : null) ?? url.host;
  if (proto === "https") return { action: "pass", hsts: true };
  const hostname = host.replace(/:\d+$/, "");
  if (LOCAL_HOSTS.has(hostname)) return { action: "pass", hsts: false };
  if (req.method === "GET" || req.method === "HEAD") {
    return { action: "redirect", location: `https://${host}${url.pathname}${url.search}` };
  }
  return { action: "refuse" };
}

export const HSTS_HEADER = "max-age=31536000; includeSubDomains";

/**
 * Privacy mode (F-021): keep only the network part of an address — IPv4 /24, IPv6 /48 — so a
 * stored or logged IP no longer identifies one visitor. Anything unparseable becomes "unknown".
 */
export function truncateIp(ip: string): string {
  const v = ip.trim();
  const v4 = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/i.exec(v);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0`;
  if (v.includes(":")) {
    const groups =
      v
        .replace(/^\[|\]$/g, "")
        .split("%")[0]
        ?.split("::") ?? [];
    const head = (groups[0] ?? "").split(":").filter(Boolean);
    const tail = groups.length > 1 ? (groups[1] ?? "").split(":").filter(Boolean) : [];
    const full = [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill("0"), ...tail];
    if (full.length === 8 && full.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) {
      return `${full.slice(0, 3).join(":").toLowerCase()}::`;
    }
  }
  return "unknown";
}
