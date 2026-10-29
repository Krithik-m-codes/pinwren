/** Build the guest portal's capability fragment without loading server-side core into the MIT widget. */
export function guestPortalUrl(
  endpoint: string,
  projectKey: string,
  entries: readonly unknown[],
): string | null {
  try {
    const url = new URL(endpoint);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) return null;
    const tokens = new Set<string>();
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const { id, token } = entry as { id?: unknown; token?: unknown };
      if (
        typeof id !== "string" ||
        !id ||
        id.startsWith("tmp:") ||
        typeof token !== "string" ||
        !/^[A-Za-z0-9_-]{16,128}$/.test(token)
      )
        continue;
      tokens.add(token);
      if (tokens.size === 50) break;
    }
    if (!tokens.size) return null;
    url.pathname = `${trimTrailingSlashes(url.pathname)}/guest/${encodeURIComponent(projectKey)}`;
    url.search = "";
    url.hash = `access=${encodeURIComponent(JSON.stringify({ reporterTokens: [...tokens], pageTokens: [] }))}`;
    return url.href;
  } catch {
    return null;
  }
}
import { trimTrailingSlashes } from "./slashes";
