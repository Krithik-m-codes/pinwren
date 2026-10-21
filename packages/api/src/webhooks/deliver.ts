import { getDb, webhookDelivery, webhookEndpoint } from "@annota/db";
import { and, eq, lt, sql } from "drizzle-orm";
import { decryptSecret } from "../crypto";
import { enqueue, enqueueAfter, QUEUES } from "../jobs/boss";
import { buildRequest, type WebhookPayload } from "./format";

/** Delay before attempt n+1 after attempt n fails (blueprint 04 §5): 1m, 5m, 30m, 2h, 6h, 12h. */
export const RETRY_DELAYS_S = [60, 300, 1800, 7200, 21600, 43200] as const;
const DISABLE_AFTER_MS = 3 * 24 * 3600 * 1000;
const TIMEOUT_MS = 10_000;

type Endpoint = typeof webhookEndpoint.$inferSelect;
type Delivery = typeof webhookDelivery.$inferSelect;

export type AttemptResult = {
  ok: boolean;
  responseCode: number | null;
  durationMs: number;
  error: string | null;
  responseBody: string | null;
};

async function readSome(res: Response, max = 1024): Promise<string> {
  try {
    const t = await res.text();
    return t.length > max ? `${t.slice(0, max)}…` : t;
  } catch {
    return "";
  }
}

/** One HTTP attempt. Never throws. */
export async function sendOnce(
  endpoint: Endpoint,
  payload: WebhookPayload,
  fetchImpl: typeof fetch = fetch,
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
        error: "signing secret unreadable (ANNOTA_SECRET changed?)",
        responseBody: null,
      };
    }
  }
  const req = buildRequest(endpoint.kind, payload, secret);
  const started = performance.now();
  try {
    const res = await fetchImpl(endpoint.url, {
      method: "POST",
      headers: req.headers,
      body: req.body,
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const responseBody = await readSome(res);
    const durationMs = Math.round(performance.now() - started);
    const ok = res.status >= 200 && res.status < 300;
    return {
      ok,
      responseCode: res.status,
      durationMs,
      error: ok ? null : `HTTP ${res.status}`,
      responseBody,
    };
  } catch (err) {
    const durationMs = Math.round(performance.now() - started);
    const msg =
      err instanceof Error
        ? err.name === "TimeoutError"
          ? "timed out after 10 s"
          : err.message
        : "request failed";
    return { ok: false, responseCode: null, durationMs, error: msg, responseBody: null };
  }
}

/** Create the first delivery row for an event and queue its attempt. */
export async function queueDelivery(endpoint: Endpoint, payload: WebhookPayload): Promise<string> {
  const [d] = await getDb()
    .insert(webhookDelivery)
    .values({
      orgId: endpoint.orgId,
      endpointId: endpoint.id,
      eventId: payload.id,
      event: payload.event,
      payload: payload as unknown as Record<string, unknown>,
      attempt: 1,
      status: "pending",
    })
    .returning({ id: webhookDelivery.id });
  if (!d) throw new Error("delivery insert failed");
  await enqueue(QUEUES.webhook, { deliveryId: d.id });
  return d.id;
}

/**
 * Run one delivery attempt and record it. On failure, a new row for the next attempt is created
 * and scheduled (`retry: true`), so the log shows every attempt with its own response.
 */
export async function runDelivery(
  deliveryId: string,
  opts: { retry: boolean } = { retry: true },
): Promise<(Delivery & AttemptResult) | null> {
  const db = getDb();
  const [row] = await db
    .select({ d: webhookDelivery, e: webhookEndpoint })
    .from(webhookDelivery)
    .innerJoin(webhookEndpoint, eq(webhookEndpoint.id, webhookDelivery.endpointId))
    .where(eq(webhookDelivery.id, deliveryId));
  if (!row) return null;
  const { d, e } = row;
  if (d.status !== "pending") return null; // already attempted (job redelivered after a crash)
  if (!e.active && d.event !== "ping") {
    await db
      .update(webhookDelivery)
      .set({ status: "failed", error: "endpoint disabled" })
      .where(eq(webhookDelivery.id, d.id));
    return null;
  }

  const result = await sendOnce(e, d.payload as unknown as WebhookPayload);
  const canRetry = opts.retry && !result.ok && d.attempt <= RETRY_DELAYS_S.length;
  const delay = canRetry ? (RETRY_DELAYS_S[d.attempt - 1] ?? null) : null;
  const nextRetryAt = delay !== null ? new Date(Date.now() + delay * 1000) : null;

  const [updated] = await db
    .update(webhookDelivery)
    .set({
      status: result.ok ? "success" : nextRetryAt ? "retrying" : "failed",
      responseCode: result.responseCode,
      responseBody: result.responseBody,
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
      await db.update(webhookEndpoint).set({ failingSince: new Date() }).where(eq(webhookEndpoint.id, e.id));
    } else if (Date.now() - e.failingSince.getTime() > DISABLE_AFTER_MS) {
      // Three days of continuous failure: stop sending until an admin re-enables it.
      await db.update(webhookEndpoint).set({ active: false }).where(eq(webhookEndpoint.id, e.id));
      console.warn(`[annota] webhook ${e.id} disabled after 3 days of failures`);
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
    if (next) await enqueueAfter(QUEUES.webhook, { deliveryId: next.id }, delay);
  }
  return updated ? { ...updated, ...result } : null;
}

/** Delete delivery logs older than 30 days. */
export async function pruneDeliveries(): Promise<number> {
  const rows = await getDb()
    .delete(webhookDelivery)
    .where(and(lt(webhookDelivery.createdAt, sql`now() - interval '30 days'`)))
    .returning({ id: webhookDelivery.id });
  return rows.length;
}
