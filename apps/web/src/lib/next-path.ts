/**
 * Where to go after signing in (`?next=`): only a path on this site, never another origin. The proxy
 * adds it when it sends a signed-out visitor to /sign-in; sign-up and invitations pass it along.
 */
export function safeNext(raw: string | null | undefined, fallback = "/inbox"): string {
  if (!raw || raw.length > 2000) return fallback;
  // A same-origin relative path: one leading slash, no protocol-relative `//host` or `/\host`.
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  // Control characters (incl. tab/newline, which browsers strip inside URLs) could smuggle a host.
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return fallback;
  }
  try {
    const url = new URL(raw, "https://pinwren.invalid");
    if (url.origin !== "https://pinwren.invalid") return fallback;
    // The auth pages themselves would loop.
    if (/^\/(sign-in|sign-up|forgot-password|reset-password|setup)(\/|$)/.test(url.pathname)) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

/** `path` with `?next=` carried over when there is one worth keeping. */
export function withNext(path: string, next: string | null | undefined): string {
  const safe = safeNext(next, "");
  return safe ? `${path}?next=${encodeURIComponent(safe)}` : path;
}
