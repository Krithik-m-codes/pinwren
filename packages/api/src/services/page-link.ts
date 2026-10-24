import { createHmac, hkdfSync } from "node:crypto";
import { DEEP_LINK_PARAM, PAGE_LINK_TOKEN_PARAM } from "@pinwren/core";
import { safeEqualStr } from "../crypto";
import { env } from "../env";

// Signed page links (wave-5 contract §3.3). "Open on page" in the dashboard and the thread links in reporter
// emails open the item in the widget even when the project keeps pins private (`publicRead` off), so the URL
// carries its own proof: `?pinwren=<feedbackId>&pwt=<token>`.
//
//   token = base64url("<feedbackId>.<expiresAtSeconds>[.repin]") "." base64url(HMAC-SHA256)
//
// keyed with HKDF from PINWREN_SECRET (like `email/unsubscribe.ts`). A token reads that one item and its public
// replies, and lets the reader reply. A `repin` token (team only, short-lived) also lets the widget move the
// item's pin (PATCH /w/feedback/:id/anchor); the widget reads the scope from the clear-text part to enter
// re-pin mode, and the server checks it again.

export const PAGE_LINK_TTL_DAYS = 7;
export const REPIN_LINK_TTL_HOURS = 24;
const MAX_TTL_DAYS = 90;

export type PageLinkScope = "read" | "repin";
export type PageLinkClaim = { feedbackId: string; expiresAt: Date; scope: PageLinkScope };

let key: Buffer | undefined;
const linkKey = () =>
  (key ??= Buffer.from(hkdfSync("sha256", env().PINWREN_SECRET, "pinwren", "page-link v1", 32)));

const mac = (part: string) => createHmac("sha256", linkKey()).update(part).digest("base64url");

/** A token for `feedbackId`, valid for `ttlMs`. */
export function pageLinkToken(
  feedbackId: string,
  opts: { ttlMs?: number; scope?: PageLinkScope; now?: number } = {},
): { token: string; expiresAt: Date } {
  const now = opts.now ?? Date.now();
  const ttl = Math.min(opts.ttlMs ?? PAGE_LINK_TTL_DAYS * 86_400_000, MAX_TTL_DAYS * 86_400_000);
  const exp = Math.floor((now + ttl) / 1000);
  const raw = opts.scope === "repin" ? `${feedbackId}.${exp}.repin` : `${feedbackId}.${exp}`;
  const part = Buffer.from(raw).toString("base64url");
  return { token: `${part}.${mac(part)}`, expiresAt: new Date(exp * 1000) };
}

/** The claim inside a valid, unexpired token; null for anything forged, malformed or expired. */
export function verifyPageLinkToken(
  token: string | null | undefined,
  now = Date.now(),
): PageLinkClaim | null {
  if (!token || token.length > 500) return null;
  const [part, sig, extra] = token.split(".");
  if (!part || !sig || extra !== undefined || !safeEqualStr(mac(part), sig)) return null;
  const [id, exp, scope, more] = Buffer.from(part, "base64url").toString("utf8").split(".");
  if (!id || !exp || more !== undefined || !/^[0-9a-f-]{36}$/i.test(id) || !/^\d{1,12}$/.test(exp))
    return null;
  if (scope !== undefined && scope !== "repin") return null;
  const expiresAt = new Date(Number(exp) * 1000);
  if (expiresAt.getTime() <= now) return null;
  return { feedbackId: id, expiresAt, scope: scope === "repin" ? "repin" : "read" };
}

/**
 * The item's page URL with `?pinwren=<id>&pwt=<token>` (any earlier deep-link parameters replaced; the page's
 * own query and hash kept). Email templates embed it as `threadUrl`.
 */
export function pageLinkUrl(
  feedbackId: string,
  pageUrl: string,
  ttlDays: number = PAGE_LINK_TTL_DAYS,
  scope: PageLinkScope = "read",
): { url: string; expiresAt: Date } {
  const { token, expiresAt } = pageLinkToken(feedbackId, { ttlMs: ttlDays * 86_400_000, scope });
  const u = new URL(pageUrl);
  u.searchParams.set(DEEP_LINK_PARAM, feedbackId);
  u.searchParams.set(PAGE_LINK_TOKEN_PARAM, token);
  return { url: u.href, expiresAt };
}
