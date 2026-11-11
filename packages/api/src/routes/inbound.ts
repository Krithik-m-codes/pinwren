import { withOrg } from "@pinwren/db";
import {
  brandAssetOwner,
  integrationSignatureCandidateById,
  integrationSignatureCandidates,
} from "../db/bootstrap";
import type { BoardProvider } from "@pinwren/core";
import { brandAsset, issueIntegration } from "@pinwren/db";
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";
import type { Context } from "hono";
import {
  decryptSecret,
  encryptSecret,
  hmacSha256Hex,
  sha256Hex,
  safeEqualStr as timingSafeEqualStr,
} from "../crypto";
import { ApiError, notFound } from "../errors";
import {
  jiraIssueEvent,
  linearFresh,
  linearIssueEvent,
  verifyJiraSignature,
  verifyLinearSignature,
} from "../integrations/inbound";
import { applyInboundState, trackerConfig, webhookUrlFor } from "../integrations/issues";
import { adapterFor, TrackerError } from "../integrations/trackers";
import type { InboundEvent } from "../integrations/sdk/types";
import { safeFetch } from "../outbound/safe-fetch";
import { hasFeature } from "../license";
import { clientIp } from "../net";
import { consume } from "../rate-limit";
import { storage } from "../storage";

// Routes that run without a dashboard session: logos (loaded by email clients and the widget on a
// customer's site) and the GitHub/GitLab/Linear/Jira webhooks that close/reopen items. Mounted before the
// session middleware.

type Integration = typeof issueIntegration.$inferSelect;

const MAX_BODY = 1024 * 1024;

type SignatureCandidate = Awaited<ReturnType<typeof integrationSignatureCandidates>>[number];
async function applyVerifiedInbound(
  i: SignatureCandidate,
  target: number | Pick<InboundEvent, "number" | "externalId">,
  state: "open" | "closed",
) {
  return withOrg(i.orgId, async (db) => {
    const [current] = await db
      .select()
      .from(issueIntegration)
      .where(
        and(
          eq(issueIntegration.id, i.id),
          eq(issueIntegration.projectId, i.projectId),
          eq(issueIntegration.provider, i.provider),
          eq(issueIntegration.active, true),
          eq(issueIntegration.webhookSecret, i.webhookSecret),
          sql`lower(${issueIntegration.repo})=lower(${i.repo})`,
        ),
      );
    if (!current) throw invalidSignature();
    return applyInboundState(current, target, state);
  });
}

/** The full integration row of a candidate whose signature has verified (same predicate as applying a state). */
function loadVerified(i: SignatureCandidate) {
  return withOrg(i.orgId, async (db) => {
    const [current] = await db
      .select()
      .from(issueIntegration)
      .where(
        and(
          eq(issueIntegration.id, i.id),
          eq(issueIntegration.projectId, i.projectId),
          eq(issueIntegration.provider, i.provider),
          eq(issueIntegration.active, true),
          eq(issueIntegration.webhookSecret, i.webhookSecret),
        ),
      );
    if (!current) throw invalidSignature();
    return current;
  });
}

function secretOf(i: Pick<Integration, "webhookSecret">): string | null {
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

/**
 * Webhook of a board tracker (Trello, Asana, ClickUp, Notion; ADR 0035). The URL names the integration
 * (`?i=`), so there is nothing to search for: the delivery is checked against that one integration's secret,
 * then read by the tracker's adapter. Order matters: size and rate limits (the guard) → the one-time secret
 * handshake, accepted only while the integration is waiting for it → signature → replay check → events.
 */
function boardWebhook(provider: BoardProvider) {
  return async (c: Context) => {
    const hooks = adapterFor(provider).webhooks;
    if (!hooks) throw notFound("Webhook");
    const raw = await c.req.text();
    const candidate = await integrationSignatureCandidateById(provider, c.req.query("i"));
    // An unknown id looks like a bad signature: nothing tells a caller which ids exist.
    if (!candidate) throw invalidSignature();
    const body = raw.trim() ? parse(raw) : {};
    const req = {
      raw,
      headers: c.req.raw.headers,
      body,
      callbackUrl: webhookUrlFor(provider, candidate.id),
    };

    const handshake = candidate.webhookPending ? hooks.handshake?.(req) : null;
    if (handshake) {
      // First write wins: the secret is taken once, while the admin has the integration waiting for it.
      const taken = await withOrg(candidate.orgId, (db) =>
        db
          .update(issueIntegration)
          .set({ webhookSecret: encryptSecret(handshake.secret), webhookPending: false, lastError: null })
          .where(
            and(
              eq(issueIntegration.id, candidate.id),
              eq(issueIntegration.webhookPending, true),
              eq(issueIntegration.active, true),
            ),
          )
          .returning({ id: issueIntegration.id }),
      );
      if (!taken[0]) throw invalidSignature();
      return c.json({ ok: true, handshake: true }, 200, handshake.reply ?? {});
    }

    const secret = secretOf(candidate);
    if (candidate.webhookPending || !secret || !hooks.verify(secret, req)) throw invalidSignature();
    if (!(await firstDelivery(provider, candidate.id, hooks.deliveryId(req), raw))) {
      return c.json({ ok: true, duplicate: true });
    }
    const current = await loadVerified(candidate);
    let events: InboundEvent[];
    try {
      events = await hooks.events(trackerConfig(current), req, safeFetch);
    } catch (err) {
      // Asana / Notion send ids and we read the values: if the tracker can't be reached, ask for a redelivery.
      throw new ApiError(
        503,
        "TRACKER_UNAVAILABLE",
        err instanceof TrackerError ? err.message : "Could not read the change from the tracker",
      );
    }
    const applied: { feedbackId: string; status: string }[] = [];
    for (const ev of events.slice(0, 20)) {
      const result = await applyVerifiedInbound(candidate, ev, ev.state);
      if (result) applied.push(result);
    }
    return c.json({
      ok: true,
      ...(applied[0] ? { feedback: applied[0], applied: applied.length } : { ignored: true }),
    });
  };
}

export const inbound = new Hono()
  /** Logos for branding. Random ids; images only (never SVG), sandboxed, cacheable. */
  .get("/brand-assets/:id", async (c) => {
    const owner = await brandAssetOwner(c.req.param("id"));
    if (!owner) throw notFound("Asset");
    const [a] = await withOrg(owner.orgId, (db) =>
      db
        .select()
        .from(brandAsset)
        .where(eq(brandAsset.id, c.req.param("id"))),
    );
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
    const match = (await integrationSignatureCandidates("github", repo)).find((i) => {
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
    const result = await applyVerifiedInbound(match, number, action === "closed" ? "closed" : "open");
    return c.json({ ok: true, ...(result ? { feedback: result } : { ignored: true }) });
  })

  /** GitLab issue hook. Verified with `X-Gitlab-Token` (the integration's webhook secret). */
  .post("/integrations/gitlab/webhook", ...inboundGuard, async (c) => {
    const raw = await c.req.text();
    const token = c.req.header("x-gitlab-token") ?? "";
    if (!token || token.length > 200) throw invalidSignature();
    const body = parse(raw);
    const repo = obj(body.project).path_with_namespace;
    const match = (await integrationSignatureCandidates("gitlab", repo)).find((i) => {
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
    const result = await applyVerifiedInbound(match, number, action === "close" ? "closed" : "open");
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
    const match = (await integrationSignatureCandidates("linear", teamKey)).find((i) => {
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
    const result = await applyVerifiedInbound(match, ev.number, ev.state);
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
    const match = (await integrationSignatureCandidates("jira", projectKey)).find((i) => {
      const secret = secretOf(i);
      return !!secret && verifyJiraSignature(secret, raw, sig);
    });
    if (!match) throw invalidSignature();
    if (!(await firstDelivery("jira", match.id, c.req.header("x-atlassian-webhook-identifier"), raw))) {
      return c.json({ ok: true, duplicate: true });
    }
    if (!(await withOrg(match.orgId, () => hasFeature("jira"))))
      return c.json({ ok: true, ignored: true, reason: "license" });
    const ev = jiraIssueEvent(body);
    if (!ev) return c.json({ ok: true, ignored: true });
    const result = await applyVerifiedInbound(match, ev.number, ev.state);
    return c.json({ ok: true, ...(result ? { feedback: result } : { ignored: true }) });
  })

  /** Trello checks that a new webhook's URL answers `HEAD` (Hono serves `HEAD` from this route). */
  .get("/integrations/trello/webhook", (c) => c.body(null, 200))

  /** Trello: `X-Trello-Webhook` = base64 HMAC-SHA1 of the body + callback URL with the Power-Up's app secret. */
  .post("/integrations/trello/webhook", ...inboundGuard, boardWebhook("trello"))

  /** Asana: a one-time `X-Hook-Secret` handshake, then `X-Hook-Signature` (hex HMAC-SHA256 of the body). */
  .post("/integrations/asana/webhook", ...inboundGuard, boardWebhook("asana"))

  /** ClickUp: `X-Signature` (hex HMAC-SHA256 of the body) with the secret returned when the webhook was made. */
  .post("/integrations/clickup/webhook", ...inboundGuard, boardWebhook("clickup"))

  /** Notion: a one-time `verification_token` post, then `X-Notion-Signature: sha256=…` keyed by that token. */
  .post("/integrations/notion/webhook", ...inboundGuard, boardWebhook("notion"));
