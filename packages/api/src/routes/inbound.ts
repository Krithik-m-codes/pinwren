import { brandAsset, getDb, issueIntegration } from "@pinwren/db";
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";
import { decryptSecret, hmacSha256Hex, sha256Hex, safeEqualStr as timingSafeEqualStr } from "../crypto";
import { ApiError, notFound } from "../errors";
import {
  jiraIssueEvent,
  linearFresh,
  linearIssueEvent,
  verifyJiraSignature,
  verifyLinearSignature,
} from "../integrations/inbound";
import { applyInboundState } from "../integrations/issues";
import { hasFeature } from "../license";
import { clientIp } from "../net";
import { consume } from "../rate-limit";
import { storage } from "../storage";

// Routes that run without a dashboard session: logos (loaded by email clients and the widget on a
// customer's site) and the GitHub/GitLab/Linear/Jira webhooks that close/reopen items. Mounted before the
// session middleware.

type Integration = typeof issueIntegration.$inferSelect;

const MAX_BODY = 1024 * 1024;

async function candidates(provider: Integration["provider"], repo: unknown): Promise<Integration[]> {
  if (typeof repo !== "string" || !repo || repo.length > 300) return [];
  return getDb()
    .select()
    .from(issueIntegration)
    .where(
      and(
        eq(issueIntegration.provider, provider),
        eq(issueIntegration.active, true),
        sql`lower(${issueIntegration.repo}) = lower(${repo})`,
      ),
    );
}

function secretOf(i: Integration): string | null {
  try {
    return decryptSecret(i.webhookSecret);
  } catch {
    return null;
  }
}

/** Deliveries per sender address and minute, counted before the body is read. */
const INBOUND_PER_MIN = 120;
/** How long a delivery id is remembered: longer than every provider's redelivery window. */
const REPLAY_WINDOW_S = 7 * 24 * 3600;

/** Rate limit, then a streamed size cap — both before any parsing or signature work. */
const inboundGuard = [
  createMiddleware(async (c, next) => {
    if (!(await consume(`in:${clientIp(c)}`, INBOUND_PER_MIN, 60))) {
      throw new ApiError(429, "RATE_LIMITED", "Too many deliveries — slow down");
    }
    await next();
  }),
  bodyLimit({
    maxSize: MAX_BODY,
    onError: () => {
      throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Payload too large");
    },
  }),
] as const;

/**
 * Replay protection: a verified delivery is acted on once. Keyed by the provider's delivery id (or the
 * body's hash when there is none) and remembered for a week in the rate-limit table.
 */
async function firstDelivery(provider: string, integrationId: string, id: string | undefined, raw: string) {
  const key = `in:seen:${provider}:${integrationId}:${id && id.length <= 100 ? id : sha256Hex(raw)}`;
  return consume(key, 1, REPLAY_WINDOW_S);
}

function parse(text: string): Record<string, unknown> {
  try {
    const v = JSON.parse(text) as unknown;
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new ApiError(400, "INVALID_PAYLOAD", "Expected a JSON object");
}

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const invalidSignature = () => new ApiError(401, "INVALID_SIGNATURE", "Signature verification failed");

export const inbound = new Hono()
  /** Logos for branding. Random ids; images only (never SVG), sandboxed, cacheable. */
  .get("/brand-assets/:id", async (c) => {
    const [a] = await getDb()
      .select()
      .from(brandAsset)
      .where(eq(brandAsset.id, c.req.param("id")));
    if (!a) throw notFound("Asset");
    const file = await storage().get(a.storageKey);
    if (!file) throw notFound("Asset file");
    return new Response(file.body, {
      headers: {
        "content-type": a.contentType,
        "cache-control": "public, max-age=86400",
        "content-security-policy": "default-src 'none'; sandbox",
        "x-content-type-options": "nosniff",
        // The widget shows the logo on customers' sites.
        "cross-origin-resource-policy": "cross-origin",
        ...(file.bytes ? { "content-length": String(file.bytes) } : {}),
      },
    });
  })

  /**
   * GitHub `issues` webhook. Verified with `X-Hub-Signature-256` (HMAC-SHA256 of the raw body with
   * the integration's webhook secret). Several projects may sync the same repository, so each
   * candidate's secret is tried; only the one that verifies is acted on.
   */
  .post("/integrations/github/webhook", ...inboundGuard, async (c) => {
    const raw = await c.req.text();
    const sig = c.req.header("x-hub-signature-256") ?? "";
    if (!/^sha256=[0-9a-f]{64}$/.test(sig)) throw invalidSignature();
    const body = parse(raw);
    const repo = obj(body.repository).full_name;
    const match = (await candidates("github", repo)).find((i) => {
      const secret = secretOf(i);
      return !!secret && timingSafeEqualStr(`sha256=${hmacSha256Hex(secret, raw)}`, sig);
    });
    if (!match) throw invalidSignature();
    if (!(await firstDelivery("github", match.id, c.req.header("x-github-delivery"), raw))) {
      return c.json({ ok: true, duplicate: true });
    }
    const event = c.req.header("x-github-event");
    if (event === "ping") return c.json({ ok: true, event: "ping" });
    const action = body.action;
    const number = Number(obj(body.issue).number);
    if (event !== "issues" || (action !== "closed" && action !== "reopened") || !Number.isInteger(number)) {
      return c.json({ ok: true, ignored: true });
    }
    const result = await applyInboundState(match, number, action === "closed" ? "closed" : "open");
    return c.json({ ok: true, ...(result ? { feedback: result } : { ignored: true }) });
  })

  /** GitLab issue hook. Verified with `X-Gitlab-Token` (the integration's webhook secret). */
  .post("/integrations/gitlab/webhook", ...inboundGuard, async (c) => {
    const raw = await c.req.text();
    const token = c.req.header("x-gitlab-token") ?? "";
    if (!token || token.length > 200) throw invalidSignature();
    const body = parse(raw);
    const repo = obj(body.project).path_with_namespace;
    const match = (await candidates("gitlab", repo)).find((i) => {
      const secret = secretOf(i);
      return !!secret && timingSafeEqualStr(secret, token);
    });
    if (!match) throw invalidSignature();
    const deliveryId = c.req.header("x-gitlab-event-uuid") ?? c.req.header("idempotency-key");
    if (!(await firstDelivery("gitlab", match.id, deliveryId, raw))) {
      return c.json({ ok: true, duplicate: true });
    }
    const attrs = obj(body.object_attributes);
    const action = attrs.action;
    const number = Number(attrs.iid);
    if (
      body.object_kind !== "issue" ||
      (action !== "close" && action !== "reopen") ||
      !Number.isInteger(number)
    ) {
      return c.json({ ok: true, ignored: true });
    }
    const result = await applyInboundState(match, number, action === "close" ? "closed" : "open");
    return c.json({ ok: true, ...(result ? { feedback: result } : { ignored: true }) });
  })

  /**
   * Linear issue webhook. Verified with `Linear-Signature` (hex HMAC-SHA256 of the raw body with the signing
   * secret Linear shows, pasted into the integration), refused when `webhookTimestamp` is over 5 minutes
   * off, and acted on once per `Linear-Delivery`.
   */
  .post("/integrations/linear/webhook", ...inboundGuard, async (c) => {
    const raw = await c.req.text();
    const sig = c.req.header("linear-signature") ?? "";
    if (!/^[0-9a-f]{64}$/.test(sig)) throw invalidSignature();
    const body = parse(raw);
    const data = obj(body.data);
    const teamKey =
      obj(data.team).key ?? (typeof data.identifier === "string" ? data.identifier.split("-")[0] : null);
    const match = (await candidates("linear", teamKey)).find((i) => {
      const secret = secretOf(i);
      return !!secret && verifyLinearSignature(secret, raw, sig);
    });
    if (!match) throw invalidSignature();
    if (!linearFresh(body)) throw new ApiError(401, "STALE_DELIVERY", "Delivery timestamp is too old");
    if (!(await firstDelivery("linear", match.id, c.req.header("linear-delivery"), raw))) {
      return c.json({ ok: true, duplicate: true });
    }
    const ev = linearIssueEvent(body);
    if (!ev) return c.json({ ok: true, ignored: true });
    const result = await applyInboundState(match, ev.number, ev.state);
    return c.json({ ok: true, ...(result ? { feedback: result } : { ignored: true }) });
  })

  /**
   * Jira Cloud webhook (Enterprise: needs the `jira` licence feature). Verified with `X-Hub-Signature`
   * (`sha256=` HMAC of the raw body with the secret entered in Jira) and acted on once per
   * `X-Atlassian-Webhook-Identifier`.
   */
  .post("/integrations/jira/webhook", ...inboundGuard, async (c) => {
    const raw = await c.req.text();
    const sig = c.req.header("x-hub-signature") ?? "";
    if (!/^sha256=[0-9a-f]{64}$/.test(sig)) throw invalidSignature();
    const body = parse(raw);
    const issue = obj(body.issue);
    const projectKey =
      obj(obj(issue.fields).project).key ?? (typeof issue.key === "string" ? issue.key.split("-")[0] : null);
    const match = (await candidates("jira", projectKey)).find((i) => {
      const secret = secretOf(i);
      return !!secret && verifyJiraSignature(secret, raw, sig);
    });
    if (!match) throw invalidSignature();
    if (!(await firstDelivery("jira", match.id, c.req.header("x-atlassian-webhook-identifier"), raw))) {
      return c.json({ ok: true, duplicate: true });
    }
    if (!(await hasFeature("jira"))) return c.json({ ok: true, ignored: true, reason: "license" });
    const ev = jiraIssueEvent(body);
    if (!ev) return c.json({ ok: true, ignored: true });
    const result = await applyInboundState(match, ev.number, ev.state);
    return c.json({ ok: true, ...(result ? { feedback: result } : { ignored: true }) });
  });
