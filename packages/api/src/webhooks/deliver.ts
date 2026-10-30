import { withOrg, afterOrgCommit } from "@pinwren/db";
import { getDb, webhookDelivery, webhookEndpoint } from "@pinwren/db";
import { and, eq, lt, sql } from "drizzle-orm";
import { decryptSecret } from "../crypto";
import { enqueue, enqueueAfter, QUEUES } from "../jobs/boss";
import { type OutboundFetch, outboundErrorText, safeFetch } from "../outbound/safe-fetch";
import { notifyWebhookDisabled } from "./disabled";
import { buildRequest, type WebhookPayload } from "./format";
import { webhookTargetUrl } from "./url";

/** Delay before attempt n+1 after attempt n fails (blueprint 04 §5): 1m, 5m, 30m, 2h, 6h, 12h. */
export const RETRY_DELAYS_S = [60, 300, 1800, 7200, 21600, 43200] as const;
const DISABLE_AFTER_MS = 3 * 24 * 3600 * 1000;
const TIMEOUT_MS = 10_000;

type Endpoint = typeof webhookEndpoint.$inferSelect;
type Delivery = typeof webhookDelivery.$inferSelect;

/**
 * What an attempt records: status and a short error category. The receiver's response body is never
 * stored or shown — with it, a webhook pointed at an internal service would read that service back.
 */
export type AttemptResult = {
  ok: boolean;
  responseCode: number | null;
  durationMs: number;
  error: string | null;
};

/** One HTTP attempt. Never throws. */
export async function sendOnce(
  endpoint: Endpoint,
  payload: WebhookPayload,
  fetchImpl: OutboundFetch = safeFetch,
): Promise<AttemptResult> {
  let secret: string | null = null;
  if (endpoint.secret) {
    try {
      secret = decryptSecret(endpoint.secret);
    } catch {
      return {
        ok: false,
        responseCode: null,
        durationMs: 0,
        error: "signing secret unreadable (PINWREN_SECRET changed?)",
      };
    }
  }
  const url = webhookTargetUrl(endpoint);
  if (url === null) {
    return {
      ok: false,
      responseCode: null,
      durationMs: 0,
      error: "URL unreadable (PINWREN_SECRET changed?)",
    };
  }
  let req: ReturnType<typeof buildRequest>;
  try {
    req = buildRequest(endpoint.kind, payload, secret, undefined, url);
  } catch {
    return { ok: false, responseCode: null, durationMs: 0, error: "stored URL is not valid for this kind" };
  }
  const started = performance.now();
  try {
    // Redirects are reported (3xx), never followed; the body is drained up to 1 KiB and dropped.
    const res = await fetchImpl(req.url ?? url, {
      method: "POST",
      headers: req.headers,
      body: req.body,
      timeoutMs: TIMEOUT_MS,
      maxBytes: 1024,
      truncate: true,
    });
    const durationMs = Math.round(performance.now() - started);
    const ok = res.status >= 200 && res.status < 300;
    return { ok, responseCode: res.status, durationMs, error: ok ? null : `HTTP ${res.status}` };
  } catch (err) {
    const durationMs = Math.round(performance.now() - started);
    return { ok: false, responseCode: null, durationMs, error: outboundErrorText(err) };
  }
}

/**
 * Create the first delivery row for an event and queue its attempt. With `domainEventId`, a second call for
 * the same event and endpoint (a retried dispatch job) does nothing and returns null.
 */
export async function queueDelivery(
  endpoint: Endpoint,
  payload: WebhookPayload,
  domainEventId?: string,
): Promise<string | null> {
  const [d] = await getDb()
    .insert(webhookDelivery)
    .values({
      orgId: endpoint.orgId,
      endpointId: endpoint.id,
      eventId: payload.id,
      event: payload.event,
      payload: payload,
      attempt: 1,
      status: "pending",
      domainEventId: domainEventId ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: webhookDelivery.id });
  if (!d) {
    if (domainEventId) return null;
    throw new Error("delivery insert failed");
  }
  // First attempts go ahead of retries, so endpoints that keep failing can't delay everyone else's events.
  await enqueue(QUEUES.webhook, { deliveryId: d.id }, { priority: 1 });
  return d.id;
}

/**
 * Run one delivery attempt and record it. On failure, a new row for the next attempt is created
 * and scheduled (`retry: true`), so the log shows every attempt with its own response.
 */
export async function runDelivery(
  deliveryId: string,
  opts: { retry: boolean; orgId?: string } = { retry: true },
): Promise<(Delivery & AttemptResult) | null> {
  const read = () =>
    getDb()
      .select({ d: webhookDelivery, e: webhookEndpoint })
      .from(webhookDelivery)
      .innerJoin(webhookEndpoint, eq(webhookEndpoint.id, webhookDelivery.endpointId))
      .where(eq(webhookDelivery.id, deliveryId));
  const [row] = opts.orgId ? await withOrg(opts.orgId, read) : await read();
  if (!row) return null;
  const { d, e } = row;
  if (d.status !== "pending") return null; // already attempted (job redelivered after a crash)
  if (!e.active && d.event !== "ping") {
    await withOrg(d.orgId, (db) =>
      db
        .update(webhookDelivery)
        .set({ status: "failed", error: "endpoint disabled" })
        .where(eq(webhookDelivery.id, d.id)),
    );
    return null;
  }

  const result = await sendOnce(e, d.payload as unknown as WebhookPayload);
  const canRetry = opts.retry && !result.ok && d.attempt <= RETRY_DELAYS_S.length;
  const delay = canRetry ? (RETRY_DELAYS_S[d.attempt - 1] ?? null) : null;
  const nextRetryAt = delay !== null ? new Date(Date.now() + delay * 1000) : null;

  return withOrg(d.orgId, async (db) => {
    const [updated] = await db
      .update(webhookDelivery)
      .set({
        status: result.ok ? "success" : nextRetryAt ? "retrying" : "failed",
        responseCode: result.responseCode,
        responseBody: null,
        error: result.error,
        durationMs: result.durationMs,
        nextRetryAt,
      })
      .where(eq(webhookDelivery.id, d.id))
      .returning();

    if (d.event !== "ping") {
      if (result.ok) {
        if (e.failingSince)
          await db.update(webhookEndpoint).set({ failingSince: null }).where(eq(webhookEndpoint.id, e.id));
      } else if (!e.failingSince) {
        await db
          .update(webhookEndpoint)
          .set({ failingSince: new Date() })
          .where(eq(webhookEndpoint.id, e.id));
      } else if (Date.now() - e.failingSince.getTime() > DISABLE_AFTER_MS) {
        // Three days of continuous failure: stop sending until an admin re-enables it, and tell the admins.
        // Only the attempt that flips `active` notifies (concurrent attempts see no row returned).
        const [off] = await db
          .update(webhookEndpoint)
          .set({ active: false })
          .where(and(eq(webhookEndpoint.id, e.id), eq(webhookEndpoint.active, true)))
          .returning();
        if (off) {
          console.warn(`[pinwren] webhook ${e.id} disabled after 3 days of failures`);
          afterOrgCommit(async () => {
            await notifyWebhookDisabled(off, result.error).catch((err: unknown) =>
              console.warn("[pinwren] webhook-disabled notification failed", err),
            );
          });
        }
      }
    }

    if (nextRetryAt && delay !== null) {
      const [next] = await db
        .insert(webhookDelivery)
        .values({
          orgId: d.orgId,
          endpointId: d.endpointId,
          eventId: d.eventId,
          event: d.event,
          payload: d.payload,
          attempt: d.attempt + 1,
          status: "pending",
        })
        .returning({ id: webhookDelivery.id });
      if (next) afterOrgCommit(() => enqueueAfter(QUEUES.webhook, { deliveryId: next.id }, delay));
    }
    return updated ? { ...updated, ...result } : null;
  });
}

/** Delete delivery logs older than 30 days. */
export async function pruneDeliveries(): Promise<number> {
  const rows = await getDb()
    .delete(webhookDelivery)
    .where(and(lt(webhookDelivery.createdAt, sql`now() - interval '30 days'`)))
    .returning({ id: webhookDelivery.id });
  return rows.length;
}
