import { createHmac, hkdfSync } from "node:crypto";
import { SHARE_TOKEN_RE, trimTrailingSlashes, type ShareLinkOut } from "@pinwren/core";
import { getDb, shareLink } from "@pinwren/db";
import { and, eq } from "drizzle-orm";
import { safeEqualStr, sha256Hex } from "../crypto";
import { env } from "../env";

// Share links (see packages/core/src/share.ts): token handling shared by the dashboard routes that make and
// revoke them and the public routes that serve them. Only the SHA-256 of the token is stored.

/** New links per workspace per hour. */
export const SHARE_LINKS_PER_HOUR = 100;
/** Reads / writes per visitor address and project per minute on the public routes. */
export const SHARE_READS_PER_MIN = 120;
export const SHARE_WRITES_PER_MIN = 20;
/** Password attempts per visitor address and link per 10 minutes. */
export const SHARE_UNLOCKS_PER_10MIN = 8;
/** Sign-offs and comments per link per hour, whoever sends them. */
export const SHARE_POSTS_PER_HOUR = 30;
/** A password check stays valid this long. */
const UNLOCK_TTL_MS = 12 * 3_600_000;

type LinkRow = typeof shareLink.$inferSelect;

export const plausibleShareToken = (token: string | undefined): token is string =>
  !!token && SHARE_TOKEN_RE.test(token);

export function linkStatus(
  l: Pick<LinkRow, "revokedAt" | "expiresAt">,
  now = new Date(),
): ShareLinkOut["status"] {
  if (l.revokedAt) return "revoked";
  return l.expiresAt <= now ? "expired" : "active";
}

/** A link as the dashboard lists it. The token-bearing URL is never stored. */
export function shareLinkOut(l: LinkRow, now = new Date()): ShareLinkOut {
  return {
    id: l.id,
    kind: l.roundId ? "round" : "report",
    feedbackId: l.feedbackId,
    roundId: l.roundId,
    label: l.label,
    allowComments: l.allowComments,
    hasPassword: l.passwordHash !== null,
    expiresAt: l.expiresAt.toISOString(),
    createdAt: l.createdAt.toISOString(),
    lastViewedAt: l.lastViewedAt?.toISOString() ?? null,
    viewCount: l.viewCount,
    revokedAt: l.revokedAt?.toISOString() ?? null,
    status: linkStatus(l, now),
  };
}

/** The shareable URL: the project key in the path, the token in the fragment (never sent to any server). */
export function shareUrl(projectKey: string, token: string): string {
  return `${trimTrailingSlashes(env().PINWREN_URL)}/share/${encodeURIComponent(projectKey)}#t=${token}`;
}

/** The project's link for this token, whatever its state (the caller decides what a dead link means). */
export async function findShareLink(projectId: string, token: string): Promise<LinkRow | null> {
  const [row] = await getDb()
    .select()
    .from(shareLink)
    .where(and(eq(shareLink.tokenHash, sha256Hex(token)), eq(shareLink.projectId, projectId)));
  return row ?? null;
}

// --- Password unlock ---------------------------------------------------------------------------------------
// After the password is verified (scrypt), the visitor gets `base64url("<linkId>.<expiresMs>").<hmac>`, bound to
// that one link, so the password itself is sent once and the expensive hash runs once.

let key: Buffer | undefined;
const unlockKey = () =>
  (key ??= Buffer.from(hkdfSync("sha256", env().PINWREN_SECRET, "pinwren", "share-unlock v1", 32)));
const mac = (part: string) => createHmac("sha256", unlockKey()).update(part).digest("base64url");

export function unlockToken(linkId: string, now = Date.now()): string {
  const part = Buffer.from(`${linkId}.${now + UNLOCK_TTL_MS}`).toString("base64url");
  return `${part}.${mac(part)}`;
}

export function verifyUnlockToken(token: string | undefined, linkId: string, now = Date.now()): boolean {
  if (!token || token.length > 300) return false;
  const [part, sig, extra] = token.split(".");
  if (!part || !sig || extra !== undefined || !safeEqualStr(mac(part), sig)) return false;
  const [id, exp, more] = Buffer.from(part, "base64url").toString("utf8").split(".");
  return id === linkId && more === undefined && /^\d{1,15}$/.test(exp ?? "") && Number(exp) > now;
}
