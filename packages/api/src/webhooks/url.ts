import { getDb, webhookEndpoint } from "@pinwren/db";
import { and, eq, inArray, not, like } from "drizzle-orm";
import { decryptSecret, encryptSecret } from "../crypto";

// Slack and Discord webhook URLs are credentials (anyone holding one can post to the channel), so they
// are stored encrypted like other secrets and only ever shown masked. Generic endpoint URLs are not
// secret (the signing secret is) and stay in clear text.

type Kind = (typeof webhookEndpoint.$inferSelect)["kind"];

const isCiphertext = (stored: string) => stored.startsWith("v1.");

/** The value to store for a URL entered by an admin. */
export const storedWebhookUrl = (kind: Kind, url: string): string =>
  kind === "generic" ? url : encryptSecret(url);

/** The URL to POST to; null when the ciphertext can't be read (PINWREN_SECRET changed). */
export function webhookTargetUrl(e: { url: string }): string | null {
  if (!isCiphertext(e.url)) return e.url;
  try {
    return decryptSecret(e.url);
  } catch {
    return null;
  }
}

/** What the API returns: generic URLs in full; chat URLs as origin + last 4 characters only. */
export function maskedWebhookUrl(e: { url: string; kind: Kind }): string {
  const plain = webhookTargetUrl(e);
  if (plain === null) return "…";
  if (e.kind === "generic") return plain;
  try {
    return `${new URL(plain).origin}/…${plain.slice(-4)}`;
  } catch {
    return "…";
  }
}

/** Encrypt chat webhook URLs stored in clear text before this change (runs at startup, idempotent). */
export async function encryptLegacyChatWebhookUrls(): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ id: webhookEndpoint.id, url: webhookEndpoint.url })
    .from(webhookEndpoint)
    .where(and(inArray(webhookEndpoint.kind, ["slack", "discord"]), not(like(webhookEndpoint.url, "v1.%"))));
  for (const r of rows) {
    await db
      .update(webhookEndpoint)
      .set({ url: encryptSecret(r.url) })
      .where(and(eq(webhookEndpoint.id, r.id), eq(webhookEndpoint.url, r.url)));
  }
  return rows.length;
}
