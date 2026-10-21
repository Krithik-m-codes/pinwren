/**
 * Origin allowlist matching, shared by the API (enforcement) and the dashboard (preview).
 *
 * Patterns are hostnames with an optional port and an optional leading `*.` wildcard:
 *   example.com        → that host on any port and scheme
 *   *.example.com      → any subdomain (not the apex)
 *   localhost:3000     → that host and port only
 * Hostnames are compared exactly, so `example.com` never matches `evil-example.com`.
 */
export function normalizePattern(pattern: string): string {
  return pattern
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/\/.*$/, "");
}

export function originMatches(origin: string, pattern: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  const p = normalizePattern(pattern);
  if (!p) return false;
  const [hostPattern, portPattern] = p.split(":") as [string, string | undefined];
  if (portPattern !== undefined && url.port !== portPattern) return false;
  const host = url.hostname.toLowerCase();
  if (hostPattern.startsWith("*.")) {
    const base = hostPattern.slice(2);
    return host.endsWith(`.${base}`);
  }
  return host === hostPattern;
}

export function isOriginAllowed(origin: string | null | undefined, patterns: readonly string[]): boolean {
  if (!origin) return false;
  return patterns.some((p) => originMatches(origin, p));
}

/** Normalise a page URL for grouping: drop the hash, sort the query. */
export function normalizePageUrl(raw: string): string {
  const url = new URL(raw);
  url.hash = "";
  url.searchParams.sort();
  return url.toString();
}
