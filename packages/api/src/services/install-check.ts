import { originMatches } from "@pinwren/core";
import { OutboundError, safeFetch, type OutboundFetch } from "../outbound/safe-fetch";

// "Check installation" (install tab): fetch the project's allowed sites server-side and look for the
// widget's script tag. Every request goes through safeFetch (ADR 0021): http/https only, no private
// addresses, a timeout and a size cap; redirects are followed by hand, a few hops at most.

export type SiteVerdict =
  | "found" //            the tag is there with this project's key
  | "script_missing" //   the page loaded but has no Pinwren tag
  | "key_mismatch" //     a Pinwren tag is there, with another key
  | "unreachable"; //     could not be fetched (or is a private address)

export type SiteCheck = {
  site: string;
  url: string;
  verdict: SiteVerdict;
  /** Why it was unreachable: a category safe to show, never the remote response. */
  reason?: "timeout" | "dns_error" | "blocked_address" | "tls_error" | "too_large" | "status" | "failed";
  status?: number;
  /** The keys other tags on the page use (key_mismatch only). */
  foundKeys?: string[];
};

export type InstallCheck = {
  checkedAt: string;
  sites: SiteCheck[];
  /** The widget has loaded from an allowed site before (project.lastSeenAt). */
  lastSeenAt: string | null;
  /** Origins the API refused (they loaded the widget but are not allowed). */
  refusedOrigins: string[];
  /** No allowed site to look at. */
  noSites: boolean;
};

const MAX_SITES = 3;
const MAX_REDIRECTS = 3;
const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 6000;

/** The page to fetch for an allowlist entry (`*.example.com` → `www.example.com`, bare hosts → https). */
export function siteUrl(entry: string): string | null {
  const trimmed = entry.trim();
  if (!trimmed) return null;
  const withScheme = trimmed.includes("://")
    ? trimmed
    : `${/^(localhost|127\.|\[::1\])/i.test(trimmed) ? "http" : "https"}://${trimmed.replace(/^\*\./, "www.")}`;
  try {
    const u = new URL(withScheme.replace("://*.", "://www."));
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.origin + "/";
  } catch {
    return null;
  }
}

const TAG = /<script\b[^>]*>/gi;

/** Pinwren script tags in `html`: the project keys they carry. */
export function widgetKeysIn(html: string): string[] {
  const keys: string[] = [];
  for (const m of html.matchAll(TAG)) {
    const tag = m[0];
    if (!/widget\.js|data-pinwren|data-project\s*=/i.test(tag)) continue;
    const key = /data-project\s*=\s*["']?([\w-]+)/i.exec(tag)?.[1];
    if (key) keys.push(key);
  }
  // npm / React installs are bundled, so the page source only has the key inline.
  return keys;
}

export function verdictFor(html: string, projectKey: string): Pick<SiteCheck, "verdict" | "foundKeys"> {
  const keys = widgetKeysIn(html);
  if (keys.includes(projectKey) || html.includes(projectKey)) return { verdict: "found" };
  if (keys.length) return { verdict: "key_mismatch", foundKeys: [...new Set(keys)].slice(0, 5) };
  return { verdict: "script_missing" };
}

async function checkSite(
  site: string,
  url: string,
  projectKey: string,
  fetcher: OutboundFetch,
): Promise<SiteCheck> {
  let current = url;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await fetcher(current, {
        timeoutMs: TIMEOUT_MS,
        maxBytes: MAX_BYTES,
        truncate: true,
        headers: { accept: "text/html", "user-agent": "Pinwren-InstallCheck/1" },
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return { site, url, verdict: "unreachable", reason: "failed", status: res.status };
        current = new URL(loc, current).toString();
        continue;
      }
      if (res.status >= 400)
        return { site, url, verdict: "unreachable", reason: "status", status: res.status };
      return { site, url, status: res.status, ...verdictFor(await res.text(), projectKey) };
    }
    return { site, url, verdict: "unreachable", reason: "failed" };
  } catch (err) {
    const reason = err instanceof OutboundError ? err.category : "failed";
    return {
      site,
      url,
      verdict: "unreachable",
      reason: reason === "invalid_url" || reason === "connection_failed" ? "failed" : reason,
    };
  }
}

export async function checkInstall(
  p: {
    publicKey: string;
    allowedOrigins: string[];
    lastSeenAt: Date | null;
    rejectedOrigins: { origin: string }[];
  },
  fetcher: OutboundFetch = safeFetch,
): Promise<InstallCheck> {
  const targets = p.allowedOrigins
    .map((site) => ({ site, url: siteUrl(site) }))
    .filter((t): t is { site: string; url: string } => t.url !== null)
    .slice(0, MAX_SITES);
  const sites = await Promise.all(targets.map((t) => checkSite(t.site, t.url, p.publicKey, fetcher)));
  return {
    checkedAt: new Date().toISOString(),
    sites,
    lastSeenAt: p.lastSeenAt?.toISOString() ?? null,
    refusedOrigins: p.rejectedOrigins
      .map((r) => r.origin)
      .filter((o) => !p.allowedOrigins.some((a) => originMatches(o, a)))
      .slice(0, 5),
    noSites: targets.length === 0,
  };
}
