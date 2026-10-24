import { hmacSha256Hex, safeEqualStr } from "../crypto";
import { keyNumber } from "./trackers";

// Pure parsing and verification for the Linear and Jira status webhooks (`routes/inbound.ts` does the I/O).
// Each returns what the delivery means for an issue link, or null when it is nothing to act on.

export type InboundIssueState = { key: string; number: number; state: "open" | "closed" };

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** Linear deliveries older than this are refused (replay protection on top of the delivery-id check). */
export const LINEAR_MAX_AGE_MS = 5 * 60 * 1000;

/** `Linear-Signature`: hex HMAC-SHA256 of the raw body with the webhook's signing secret. */
export function verifyLinearSignature(secret: string, raw: string, signature: string): boolean {
  return /^[0-9a-f]{64}$/.test(signature) && safeEqualStr(hmacSha256Hex(secret, raw), signature);
}

/** `webhookTimestamp` (ms) is within the allowed age (and not from the future beyond the same skew). */
export function linearFresh(body: Record<string, unknown>, now = Date.now()): boolean {
  const ts = Number(body.webhookTimestamp);
  return Number.isFinite(ts) && Math.abs(now - ts) <= LINEAR_MAX_AGE_MS;
}

/**
 * A Linear `Issue` `update` whose workflow state changed: `completed` / `canceled` states close the item,
 * any other state reopens it.
 */
export function linearIssueEvent(body: Record<string, unknown>): InboundIssueState | null {
  if (body.type !== "Issue" || body.action !== "update") return null;
  if (!("stateId" in obj(body.updatedFrom))) return null;
  const data = obj(body.data);
  const identifier = typeof data.identifier === "string" ? data.identifier : null;
  const teamKey = obj(data.team).key ?? identifier?.split("-")[0];
  const number = Number(data.number ?? keyNumber(identifier));
  const type = obj(data.state).type;
  if (typeof teamKey !== "string" || !Number.isInteger(number) || number <= 0 || typeof type !== "string") {
    return null;
  }
  return { key: teamKey, number, state: type === "completed" || type === "canceled" ? "closed" : "open" };
}

/** Jira `X-Hub-Signature`: `sha256=<hex HMAC-SHA256 of the raw body>` with the webhook's secret. */
export function verifyJiraSignature(secret: string, raw: string, signature: string): boolean {
  return (
    /^sha256=[0-9a-f]{64}$/.test(signature) && safeEqualStr(`sha256=${hmacSha256Hex(secret, raw)}`, signature)
  );
}

/**
 * A Jira `jira:issue_updated` whose status changed: a status in the "done" category closes the item, any
 * other reopens it.
 */
export function jiraIssueEvent(body: Record<string, unknown>): InboundIssueState | null {
  if (body.webhookEvent !== "jira:issue_updated") return null;
  const items = obj(body.changelog).items;
  if (!Array.isArray(items) || !items.some((i) => obj(i).field === "status")) return null;
  const issue = obj(body.issue);
  const key = issue.key;
  const number = keyNumber(key);
  const fields = obj(issue.fields);
  const projectKey = obj(fields.project).key ?? (typeof key === "string" ? key.split("-")[0] : undefined);
  const category = obj(obj(fields.status).statusCategory).key;
  if (typeof projectKey !== "string" || number === null || typeof category !== "string") return null;
  return { key: projectKey, number, state: category === "done" ? "closed" : "open" };
}
