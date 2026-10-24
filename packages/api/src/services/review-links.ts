import { REVIEW_LINK_PARAM, REVIEW_TOKEN_RE } from "@pinwren/core";
import { feedback, getDb, reviewLink } from "@pinwren/db";
import { and, count, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { sha256Hex } from "../crypto";

// Review links (F-012, wave-5 contract §3.5): a shareable URL of the site with `?pinwren_review=<token>`
// that shows the widget to whoever opens it, whatever the project's visibility mode, and marks the
// reports sent through it with the link's name. Only the SHA-256 of the token is stored.

/** `last_used_at` is written at most this often per link (the widget checks on every page load). */
const LAST_USED_INTERVAL_MS = 60_000;
/** Token checks per visitor address and project per minute: one per page load is plenty. */
export const REVIEW_CHECKS_PER_MIN = 30;
/** New links per workspace per hour. */
export const REVIEW_LINKS_PER_HOUR = 50;

type LinkRow = typeof reviewLink.$inferSelect;

/** A link as the dashboard lists it; the token-bearing URL is never stored, so `url` is always null. */
export const linkOut = (l: LinkRow, feedbackCount = 0) => ({
  id: l.id,
  label: l.label,
  url: null,
  expiresAt: l.expiresAt,
  createdAt: l.createdAt,
  lastUsedAt: l.lastUsedAt,
  revokedAt: l.revokedAt,
  feedbackCount,
});

/** The page URL with the token added (any existing query and hash kept). */
export function reviewUrl(pageUrl: string, token: string): string {
  const u = new URL(pageUrl);
  u.searchParams.set(REVIEW_LINK_PARAM, token);
  return u.toString();
}

/** A link works until it is revoked or expires. */
export const reviewLinkActive = (l: Pick<LinkRow, "revokedAt" | "expiresAt">, now = new Date()) =>
  !l.revokedAt && (!l.expiresAt || l.expiresAt > now);

/** Whether `last_used_at` is stale enough to write again. */
export const shouldTouch = (lastUsedAt: Date | null, now = new Date()) =>
  !lastUsedAt || now.getTime() - lastUsedAt.getTime() > LAST_USED_INTERVAL_MS;

/** Only tokens shaped like the ones handed out reach the database. */
export const plausibleToken = (token: string | undefined): token is string =>
  !!token && REVIEW_TOKEN_RE.test(token);

/**
 * The project's active link for this token, or null (missing, malformed, foreign, revoked or expired).
 * `touch` records the use (throttled), for "Used 2 hours ago" in the dashboard.
 */
export async function findReviewLink(
  projectId: string,
  token: string | undefined,
  opts: { touch?: boolean } = {},
): Promise<{ id: string; label: string } | null> {
  if (!plausibleToken(token)) return null;
  const now = new Date();
  const [row] = await getDb()
    .select({ id: reviewLink.id, label: reviewLink.label, lastUsedAt: reviewLink.lastUsedAt })
    .from(reviewLink)
    .where(
      and(
        eq(reviewLink.tokenHash, sha256Hex(token)),
        eq(reviewLink.projectId, projectId),
        isNull(reviewLink.revokedAt),
        or(isNull(reviewLink.expiresAt), gt(reviewLink.expiresAt, now)),
      ),
    );
  if (!row) return null;
  if (opts.touch && shouldTouch(row.lastUsedAt, now)) {
    await getDb().update(reviewLink).set({ lastUsedAt: now }).where(eq(reviewLink.id, row.id));
  }
  return { id: row.id, label: row.label };
}

/** Live (not deleted) items sent through each of these links. */
export async function feedbackCounts(linkIds: string[]): Promise<Map<string, number>> {
  if (!linkIds.length) return new Map();
  const rows = await getDb()
    .select({ id: feedback.reviewLinkId, n: count() })
    .from(feedback)
    .where(and(inArray(feedback.reviewLinkId, linkIds), isNull(feedback.deletedAt)))
    .groupBy(feedback.reviewLinkId);
  return new Map(rows.flatMap((r) => (r.id ? [[r.id, r.n] as const] : [])));
}
