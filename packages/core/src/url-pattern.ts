// URL patterns for page scope (SitePing `urlPattern` parity, wave-4 contract §4). A pattern groups pins
// across pages that share a template, e.g. every `/product/:id`.
//
//   /product/:id     one non-empty path segment per `:name`
//   /blog/*          `*` matches any rest of the path (also across `/`)
//   /docs/*/intro    `*` in the middle matches anything up to the next fixed part
//
// Patterns match the URL's path only — origin, query and hash are ignored — and a trailing slash is
// optional on both sides. A pattern written as a full URL (`https://x.com/a/:b`) uses its path.

import { cutAt, trimTrailingSlashes } from "./strings";

const MAX_PATTERN = 500;

/** The path a pattern applies to, normalised: leading `/`, no trailing `/`, no query/hash. */
function patternPath(pattern: string): string | null {
  let p = pattern.trim();
  if (!p || p.length > MAX_PATTERN) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(p)) {
    p = p.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, "");
  }
  p = cutAt(p, "?#");
  if (!p.startsWith("/")) p = `/${p}`;
  return p.length > 1 ? trimTrailingSlashes(p) || "/" : p;
}

/**
 * A regular-expression source (anchored, for the path only) equivalent to the pattern. Shared by the
 * API, which runs it in Postgres (`~`), and by `urlPatternMatches`. Only `:name` and `*` are special;
 * every other character is matched literally. Returns null for an empty or oversized pattern.
 */
export function urlPatternRegexSource(pattern: string): string | null {
  const p = patternPath(pattern);
  if (p === null) return null;
  let out = "";
  for (let i = 0; i < p.length; i++) {
    const ch = p.charAt(i);
    if (ch === "*") {
      out += ".*";
    } else if (ch === ":" && /[A-Za-z_]/.test(p.charAt(i + 1))) {
      while (/\w/.test(p.charAt(i + 1))) i++;
      out += "[^/]+";
    } else {
      out += /[\\^$.|?+()[\]{}]/.test(ch) ? `\\${ch}` : ch;
    }
  }
  return `^${out === "/" ? "" : out}/?$`;
}

/** The path part of a URL (or of a bare path) — what patterns are matched against. */
export function urlPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return cutAt(url, "?#") || "/";
  }
}

export function urlPatternMatches(pattern: string, url: string): boolean {
  const src = urlPatternRegexSource(pattern);
  if (src === null) return false;
  return new RegExp(src).test(urlPath(url));
}
