import { createHmac, hkdfSync } from "node:crypto";
import { safeEqualStr } from "../crypto";
import { env } from "../env";

// "Link your account" tokens. A Slack member whose email doesn't match a Pinwren member gets an ephemeral
// message with a link carrying one of these; opening it signed in to the workspace maps that Slack user
// to the signed-in member. The token proves *which Slack user* asked (only Slack's signed request could
// have produced it); the dashboard session proves who is accepting.
//
//   token = base64url("<workspaceId>.<slackUserId>.<expiresAtSeconds>") "." base64url(HMAC-SHA256)
//
// keyed with HKDF from PINWREN_SECRET (like page links). Valid for an hour.

export const SLACK_LINK_TTL_MS = 60 * 60 * 1000;
export type SlackLinkTokenClaim = { workspaceId: string; slackUserId: string; expiresAt: Date };

let key: Buffer | undefined;
const linkKey = () =>
  (key ??= Buffer.from(hkdfSync("sha256", env().PINWREN_SECRET, "pinwren", "slack-link v1", 32)));
const mac = (part: string) => createHmac("sha256", linkKey()).update(part).digest("base64url");

export function slackLinkToken(workspaceId: string, slackUserId: string, now = Date.now()): string {
  const exp = Math.floor((now + SLACK_LINK_TTL_MS) / 1000);
  const part = Buffer.from(`${workspaceId}.${slackUserId}.${exp}`).toString("base64url");
  return `${part}.${mac(part)}`;
}

/** The claim inside a valid, unexpired token; null for anything forged, malformed or expired. */
export function verifySlackLinkToken(
  token: string | null | undefined,
  now = Date.now(),
): SlackLinkTokenClaim | null {
  if (!token || token.length > 500) return null;
  const [part, sig, extra] = token.split(".");
  if (!part || !sig || extra !== undefined || !safeEqualStr(mac(part), sig)) return null;
  const [workspaceId, slackUserId, exp, more] = Buffer.from(part, "base64url").toString("utf8").split(".");
  if (!workspaceId || !slackUserId || !exp || more !== undefined) return null;
  if (
    !/^[0-9a-f-]{36}$/i.test(workspaceId) ||
    !/^[A-Z0-9]{9,15}$/.test(slackUserId) ||
    !/^\d{1,12}$/.test(exp)
  )
    return null;
  const expiresAt = new Date(Number(exp) * 1000);
  if (expiresAt.getTime() <= now) return null;
  return { workspaceId, slackUserId, expiresAt };
}

export const slackLinkUrl = (token: string) =>
  `${env().PINWREN_URL.replace(/\/$/, "")}/slack/link?token=${encodeURIComponent(token)}`;
