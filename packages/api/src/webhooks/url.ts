import { getDb, webhookEndpoint } from "@pinwren/db";
import { and, eq, inArray, not, like } from "drizzle-orm";
import { decryptSecret, encryptSecret } from "../crypto";

// Chat webhook URLs (Slack, Discord, Teams), Telegram bot targets and ntfy topic URLs are credentials
// (anyone holding one can post to the channel, or read the topic), so they are stored encrypted like other
// secrets and only ever shown masked. Generic endpoint URLs are not secret (the signing secret is) and stay
// in clear text.

type Kind = (typeof webhookEndpoint.$inferSelect)["kind"];

const isCiphertext = (stored: string) => stored.startsWith("v1.");

export const TELEGRAM_API = "https://api.telegram.org";

/**
 * A Telegram endpoint is stored as one URL, `https://api.telegram.org/bot<token>/sendMessage?chat_id=<id>`,
 * so it needs no extra column; the sender moves `chat_id` into the JSON body.
 */
export const telegramTarget = (botToken: string, chatId: string): string =>
  `${TELEGRAM_API}/bot${botToken}/sendMessage?chat_id=${encodeURIComponent(chatId)}`;

/** The bot token, chat id and bare API URL of a stored Telegram target; null when it isn't one. */
export function parseTelegramTarget(
  target: string,
): { botToken: string; chatId: string; url: string } | null {
  try {
    const u = new URL(target);
    const m = /^\/bot([^/]+)\/sendMessage$/.exec(u.pathname);
    const chatId = u.searchParams.get("chat_id");
    if (!m?.[1] || !chatId) return null;
    return { botToken: decodeURIComponent(m[1]), chatId, url: `${u.origin}${u.pathname}` };
  } catch {
    return null;
  }
}

/** The value to store for a URL entered by an admin (or a Telegram target built from its parts). */
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

/**
 * What the API returns: generic URLs in full; chat URLs as origin + last 4 characters only; Telegram as the
 * bot id with the token's secret half hidden.
 */
export function maskedWebhookUrl(e: { url: string; kind: Kind }): string {
  const plain = webhookTargetUrl(e);
  if (plain === null) return "…";
  if (e.kind === "generic") return plain;
  if (e.kind === "telegram") {
    const t = parseTelegramTarget(plain);
    return t ? `${TELEGRAM_API}/bot${t.botToken.split(":")[0] ?? ""}:…${t.botToken.slice(-4)}` : "…";
  }
  try {
    return `${new URL(plain).origin}/…${plain.slice(-4)}`;
  } catch {
    return "…";
  }
}

/** The chat a Telegram endpoint posts to (not a secret: shown so admins can tell endpoints apart). */
export function telegramChatOf(e: { url: string; kind: Kind }): string | null {
  if (e.kind !== "telegram") return null;
  const plain = webhookTargetUrl(e);
  return plain ? (parseTelegramTarget(plain)?.chatId ?? null) : null;
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
