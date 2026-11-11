import { hmacSha256Hex, safeEqualStr } from "../crypto";

// Slack request signing (https://api.slack.com/authentication/verifying-requests-from-slack): the app's
// signing secret HMACs `v0:<timestamp>:<raw body>`. The timestamp is checked against a short window so a
// captured request can't be replayed later; `routes/slack.ts` additionally remembers each trigger id.

/** Requests older (or newer) than this are refused, as Slack recommends. */
export const SLACK_MAX_AGE_S = 5 * 60;

export type SlackSignatureVerdict = "ok" | "malformed" | "stale" | "mismatch";

export function verifySlackSignature(
  secret: string,
  rawBody: string,
  headers: { timestamp: string | undefined; signature: string | undefined },
  nowMs = Date.now(),
): SlackSignatureVerdict {
  const { timestamp, signature } = headers;
  if (!timestamp || !signature || !/^\d{9,12}$/.test(timestamp) || !/^v0=[0-9a-f]{64}$/.test(signature)) {
    return "malformed";
  }
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > SLACK_MAX_AGE_S) return "stale";
  const expected = `v0=${hmacSha256Hex(secret, `v0:${timestamp}:${rawBody}`)}`;
  return safeEqualStr(expected, signature) ? "ok" : "mismatch";
}

/** The signature headers for `rawBody`, as Slack sends them (used by tests and the settings self-check). */
export function signSlackRequest(secret: string, rawBody: string, nowMs = Date.now()) {
  const timestamp = String(Math.floor(nowMs / 1000));
  return {
    "x-slack-request-timestamp": timestamp,
    "x-slack-signature": `v0=${hmacSha256Hex(secret, `v0:${timestamp}:${rawBody}`)}`,
  };
}
