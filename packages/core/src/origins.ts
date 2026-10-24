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

/**
 * Query parameters that never identify a page: Pinwren's own deep-link / review-link parameters and the
 * common ad, campaign and referral trackers. Anything starting with `utm_` is dropped too.
 */
export const IGNORED_QUERY_PARAMS: readonly string[] = [
  "pinwren",
  "pwt",
  "pinwren_review",
  "gclid",
  "fbclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "ref",
];

/**
 * Whether `key` is left out of a page's identity: a built-in ignored parameter, or one of the project's own
 * `extra` names (`widgetConfig.ignoredQueryParams`; a trailing `*` matches a prefix, e.g. `hsa_*`).
 */
export function isIgnoredQueryParam(key: string, extra: readonly string[] = []): boolean {
  const k = key.toLowerCase();
  if (k.startsWith("utm_") || IGNORED_QUERY_PARAMS.includes(k)) return true;
  return extra.some((p) => {
    const q = p.trim().toLowerCase();
    if (!q) return false;
    return q.endsWith("*") ? q.length > 1 && k.startsWith(q.slice(0, -1)) : k === q;
  });
}

/**
 * Normalise a page URL for grouping: drop the hash and ignored parameters (plus the project's `extra` ones),
 * sort the query and fold a trailing slash (`/pricing/` = `/pricing`; the root stays `/`). Pins left on
 * `/pricing?utm_source=x` and `/pricing/` then share one page.
 */
export function normalizePageUrl(raw: string, extra: readonly string[] = []): string {
  const url = new URL(raw);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (isIgnoredQueryParam(key, extra)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  if (url.pathname.length > 1 && url.pathname.endsWith("/"))
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString();
}
