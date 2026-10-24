import { createHmac, hkdfSync } from "node:crypto";
import { safeEqualStr } from "../crypto";
import { env } from "../env";

// Signed links inside team emails (wave-5 contract §3.2). Recipients aren't signed in when they click, so
// each link carries its own proof: base64url(JSON) "." base64url(HMAC-SHA256), keyed per purpose with
// HKDF from PINWREN_SECRET (like the reporter unsubscribe in `unsubscribe.ts`).
//
// - Team unsubscribe: `{ v, k: "m", u: userId, p: projectId }` turns off email in that member's
//   preference row for the project; `{ v, k: "x", p, e: address }` removes an extra address
//   (Notifications › General) from the project. Never expires: an old email's link must keep working.
// - Screenshot: `{ v, a: assetId, x: expiresAtSeconds }`, so an email client can load the image without
//   a session. Long-lived but not forever (EMAIL_IMAGE_TTL_DAYS).

export const EMAIL_IMAGE_TTL_DAYS = 180;

type Purpose = "team-unsubscribe v1" | "email-image v1";
const keys = new Map<Purpose, Buffer>();
const keyFor = (purpose: Purpose) => {
  let k = keys.get(purpose);
  if (!k) {
    k = Buffer.from(hkdfSync("sha256", env().PINWREN_SECRET, "pinwren", purpose, 32));
    keys.set(purpose, k);
  }
  return k;
};

function sign(purpose: Purpose, value: object): string {
  const part = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part}.${createHmac("sha256", keyFor(purpose)).update(part).digest("base64url")}`;
}

function verify(purpose: Purpose, token: string): Record<string, unknown> | null {
  if (!token || token.length > 2000) return null;
  const [part, mac, extra] = token.split(".");
  if (!part || !mac || extra !== undefined) return null;
  if (!safeEqualStr(createHmac("sha256", keyFor(purpose)).update(part).digest("base64url"), mac)) return null;
  try {
    const v = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const base = () => env().PINWREN_URL.replace(/\/$/, "");

export type TeamUnsubscribe =
  | { kind: "member"; userId: string; projectId: string }
  | { kind: "address"; email: string; projectId: string };

export function teamUnsubscribeToken(t: TeamUnsubscribe): string {
  return t.kind === "member"
    ? sign("team-unsubscribe v1", { v: 1, k: "m", u: t.userId, p: t.projectId })
    : sign("team-unsubscribe v1", { v: 1, k: "x", e: t.email.trim().toLowerCase(), p: t.projectId });
}

export function verifyTeamUnsubscribeToken(token: string): TeamUnsubscribe | null {
  const v = verify("team-unsubscribe v1", token);
  if (v?.v !== 1 || typeof v.p !== "string") return null;
  if (v.k === "m" && typeof v.u === "string") return { kind: "member", userId: v.u, projectId: v.p };
  if (v.k === "x" && typeof v.e === "string") return { kind: "address", email: v.e, projectId: v.p };
  return null;
}

export const teamUnsubscribeUrl = (t: TeamUnsubscribe) =>
  `${base()}/api/unsubscribe/team?token=${encodeURIComponent(teamUnsubscribeToken(t))}`;

/** Settings › Notifications › My notifications (the footer link of every team email). */
export const manageNotificationsUrl = () => `${base()}/settings/notifications?tab=mine`;

export function emailImageToken(assetId: string, now = Date.now()): string {
  const x = Math.floor(now / 1000) + EMAIL_IMAGE_TTL_DAYS * 86_400;
  return sign("email-image v1", { v: 1, a: assetId, x });
}

/** The asset id, or null when the token is forged or expired. */
export function verifyEmailImageToken(token: string, now = Date.now()): string | null {
  const v = verify("email-image v1", token);
  if (v?.v !== 1 || typeof v.a !== "string" || typeof v.x !== "number") return null;
  return v.x * 1000 > now ? v.a : null;
}

export const emailImageUrl = (assetId: string) =>
  `${base()}/api/email-assets/${encodeURIComponent(emailImageToken(assetId))}`;
