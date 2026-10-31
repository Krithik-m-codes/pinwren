import { createHmac, timingSafeEqual } from "node:crypto";

// Standard Webhooks (standardwebhooks.com), which Dodo Payments uses: the signed content is
// `${webhook-id}.${webhook-timestamp}.${raw body}`, HMAC-SHA256 with the base64-decoded secret (after the
// `whsec_` prefix), sent as space-separated `v1,<base64>` entries in `webhook-signature`.

export type SignatureVerdict = "ok" | "malformed" | "stale" | "bad_signature";

/** Accepted clock skew in either direction. */
export const WEBHOOK_TOLERANCE_S = 5 * 60;

export function verifyStandardWebhook(input: {
  secret: string;
  id: string;
  timestamp: string;
  signature: string;
  body: string;
  now?: Date;
}): SignatureVerdict {
  const { secret, id, timestamp, signature, body } = input;
  if (!secret || !id || !signature || !/^\d{1,12}$/.test(timestamp)) return "malformed";
  const now = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (Math.abs(now - Number(timestamp)) > WEBHOOK_TOLERANCE_S) return "stale";
  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();
  let match = false;
  for (const entry of signature.split(" ")) {
    const [version, value] = entry.split(",");
    if (version !== "v1" || !value) continue;
    const given = Buffer.from(value, "base64");
    // timingSafeEqual needs equal lengths; the length of a v1 signature is public. Every entry is
    // compared (no early exit) so timing doesn't reveal which one matched.
    if (given.length === expected.length && timingSafeEqual(given, expected)) match = true;
  }
  return match ? "ok" : "bad_signature";
}
