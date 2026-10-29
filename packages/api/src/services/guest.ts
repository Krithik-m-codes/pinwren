import { guestPortalAccess, trimTrailingSlashes, type GuestPortalAccess } from "@pinwren/core";
import { sha256Hex } from "../crypto";
import { env } from "../env";
import { pageLinkToken, verifyPageLinkToken } from "./page-link";

/** Reject oversized headers before splitting, parsing or touching Postgres. */
export function parseGuestAccess(
  reporters: string | undefined,
  pages: string | undefined,
): GuestPortalAccess | null {
  if ((reporters?.length ?? 0) + (pages?.length ?? 0) > 16_000) return null;
  const split = (value: string | undefined) => (value ? value.split(",").map((s) => s.trim()) : []);
  const parsed = guestPortalAccess.safeParse({ reporterTokens: split(reporters), pageTokens: split(pages) });
  if (!parsed.success) return null;
  const access = {
    reporterTokens: [...new Set(parsed.data.reporterTokens)],
    pageTokens: [...new Set(parsed.data.pageTokens)],
  };
  return access.reporterTokens.length || access.pageTokens.length ? access : null;
}

/** Only signed, unexpired ids and SHA-256 hashes ever reach the ownership query. */
export function guestClaims(access: GuestPortalAccess): { hashes: string[]; ids: string[] } {
  return {
    hashes: access.reporterTokens.map(sha256Hex),
    ids: [
      ...new Set(
        access.pageTokens.flatMap((token) => {
          const claim = verifyPageLinkToken(token);
          return claim ? [claim.feedbackId] : [];
        }),
      ),
    ],
  };
}

/** An email capability stays in the fragment: it never reaches request logs or Referer headers. */
export function guestPortalUrl(projectKey: string, feedbackId: string, ttlDays = 30): string {
  const { token } = pageLinkToken(feedbackId, { ttlMs: ttlDays * 86_400_000 });
  const url = new URL(`${trimTrailingSlashes(env().PINWREN_URL)}/guest/${encodeURIComponent(projectKey)}`);
  url.hash = `access=${encodeURIComponent(JSON.stringify({ reporterTokens: [], pageTokens: [token] }))}`;
  return url.href;
}
