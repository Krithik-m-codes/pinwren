import { createHmac, hkdfSync } from "node:crypto";
import { emailSuppression, getDb } from "@pinwren/db";
import { and, eq } from "drizzle-orm";
import { safeEqualStr } from "../crypto";
import { env } from "../env";

// Reporter unsubscribe (wave-4 contract §6). Reporters aren't users, so the link carries a signed
// token instead of a session: base64url({ v, o: orgId, e: email }) "." base64url(HMAC-SHA256). The key
// is derived from PINWREN_SECRET; tokens don't expire (an old email's link must keep working).

let key: Buffer | undefined;
const unsubscribeKey = () =>
  (key ??= Buffer.from(hkdfSync("sha256", env().PINWREN_SECRET, "pinwren", "unsubscribe v1", 32)));

const sign = (part: string) => createHmac("sha256", unsubscribeKey()).update(part).digest("base64url");
const norm = (email: string) => email.trim().toLowerCase();

export function unsubscribeToken(orgId: string, email: string): string {
  const part = Buffer.from(JSON.stringify({ v: 1, o: orgId, e: norm(email) })).toString("base64url");
  return `${part}.${sign(part)}`;
}

export function verifyUnsubscribeToken(token: string): { orgId: string; email: string } | null {
  if (token.length > 2000) return null;
  const [part, mac, extra] = token.split(".");
  if (!part || !mac || extra !== undefined || !safeEqualStr(sign(part), mac)) return null;
  try {
    const v = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as {
      v?: unknown;
      o?: unknown;
      e?: unknown;
    };
    if (v.v !== 1 || typeof v.o !== "string" || typeof v.e !== "string") return null;
    return { orgId: v.o, email: v.e };
  } catch {
    return null;
  }
}

export const unsubscribeUrl = (orgId: string, email: string) =>
  `${env().PINWREN_URL.replace(/\/$/, "")}/api/unsubscribe?token=${encodeURIComponent(unsubscribeToken(orgId, email))}`;

export async function isSuppressed(orgId: string, email: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ email: emailSuppression.email })
    .from(emailSuppression)
    .where(and(eq(emailSuppression.orgId, orgId), eq(emailSuppression.email, norm(email))));
  return !!row;
}

export async function suppress(orgId: string, email: string, reason = "unsubscribe"): Promise<void> {
  await getDb()
    .insert(emailSuppression)
    .values({ orgId, email: norm(email), reason })
    .onConflictDoNothing();
}

/** RFC 2369 / RFC 8058 headers for one-click unsubscribe from mail clients. */
export const unsubscribeHeaders = (url: string) => ({
  "List-Unsubscribe": `<${url}>`,
  "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
});
