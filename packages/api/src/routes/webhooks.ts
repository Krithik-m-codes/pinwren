import { webhookCreate, webhookUpdate } from "@pinwren/core";
import { getDb, project, webhookDelivery, webhookEndpoint } from "@pinwren/db";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { requireOrgAdmin, type SessionVars } from "../context";
import { encryptSecret, randomToken } from "../crypto";
import { env } from "../env";
import { ApiError, notFound } from "../errors";
import { runDelivery } from "../webhooks/deliver";
import { WEBHOOK_API_VERSION, type WebhookPayload } from "../webhooks/format";

type Endpoint = typeof webhookEndpoint.$inferSelect;

/** Chat webhook URLs are credentials themselves: show only enough to recognise them. */
function displayUrl(e: Endpoint): string {
  if (e.kind === "generic") return e.url;
  try {
    const u = new URL(e.url);
    return `${u.origin}/…${e.url.slice(-4)}`;
  } catch {
    return "…";
  }
}

const endpointOut = (e: Endpoint) => ({
  id: e.id,
  name: e.name,
  url: displayUrl(e),
  kind: e.kind,
  events: e.events,
  projectId: e.projectId,
  active: e.active,
  failingSince: e.failingSince,
  hasSecret: e.secret !== null,
  createdAt: e.createdAt,
  updatedAt: e.updatedAt,
});

const deliveryOut = (d: typeof webhookDelivery.$inferSelect) => ({
  id: d.id,
  eventId: d.eventId,
  event: d.event,
  attempt: d.attempt,
  status: d.status,
  responseCode: d.responseCode,
  responseBody: d.responseBody,
  error: d.error,
  durationMs: d.durationMs,
  nextRetryAt: d.nextRetryAt,
  createdAt: d.createdAt,
});

const newSecret = () => `whsec_${randomToken(24)}`;

function pingPayload(): WebhookPayload {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    event: "ping",
    apiVersion: WEBHOOK_API_VERSION,
    createdAt: now,
    data: {
      feedback: {
        id: "00000000-0000-0000-0000-000000000000",
        number: 0,
        projectId: "00000000-0000-0000-0000-000000000000",
        projectName: "Pinwren",
        kind: "comment",
        status: "open",
        priority: "none",
        title: "Test delivery",
        body: "This is a test delivery from Pinwren. If you can read this, the webhook works.",
        pageUrl: null,
        reporterName: null,
        assigneeIds: [],
        createdAt: now,
        updatedAt: now,
        url: `${env().PINWREN_URL.replace(/\/$/, "")}/settings`,
      },
    },
  };
}

async function ownEndpoint(orgId: string, id: string): Promise<Endpoint> {
  const [e] = await getDb()
    .select()
    .from(webhookEndpoint)
    .where(and(eq(webhookEndpoint.id, id), eq(webhookEndpoint.orgId, orgId)));
  if (!e) throw notFound("Webhook");
  return e;
}

async function assertProject(orgId: string, projectId: string | null | undefined) {
  if (!projectId) return;
  const [p] = await getDb()
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.orgId, orgId)));
  if (!p) throw notFound("Project");
}

async function deliverNow(e: Endpoint, payload: WebhookPayload) {
  const [d] = await getDb()
    .insert(webhookDelivery)
    .values({
      orgId: e.orgId,
      endpointId: e.id,
      eventId: payload.id,
      event: payload.event,
      payload: payload as unknown as Record<string, unknown>,
      status: "pending",
    })
    .returning({ id: webhookDelivery.id });
  if (!d) throw new Error("delivery insert failed");
  const result = await runDelivery(d.id, { retry: false });
  if (!result) throw new ApiError(409, "WEBHOOK_DISABLED", "This webhook is disabled");
  return deliveryOut(result);
}

/** Outbound webhooks (F-075, Slack F-071, Discord F-072). Org admins only. */
export const webhooks = new Hono<{ Variables: SessionVars }>()
  .get("/webhooks", requireOrgAdmin, async (c) => {
    const rows = await getDb()
      .select()
      .from(webhookEndpoint)
      .where(eq(webhookEndpoint.orgId, c.var.orgId))
      .orderBy(desc(webhookEndpoint.createdAt));
    return c.json({ webhooks: rows.map(endpointOut) });
  })

  .post("/webhooks", requireOrgAdmin, zValidator("json", webhookCreate), async (c) => {
    const body = c.req.valid("json");
    await assertProject(c.var.orgId, body.projectId);
    const secret = body.kind === "generic" ? newSecret() : null;
    const [e] = await getDb()
      .insert(webhookEndpoint)
      .values({
        orgId: c.var.orgId,
        projectId: body.projectId ?? null,
        name: body.name ?? null,
        url: body.url,
        kind: body.kind,
        events: [...new Set(body.events)],
        secret: secret ? encryptSecret(secret) : null,
        active: body.active,
        createdBy: c.var.userId,
      })
      .returning();
    if (!e) throw new Error("webhook insert failed");
    // The signing secret is shown exactly once.
    return c.json({ webhook: endpointOut(e), secret }, 201);
  })

  .get("/webhooks/:id", requireOrgAdmin, async (c) =>
    c.json({ webhook: endpointOut(await ownEndpoint(c.var.orgId, c.req.param("id"))) }),
  )

  .patch("/webhooks/:id", requireOrgAdmin, zValidator("json", webhookUpdate), async (c) => {
    const body = c.req.valid("json");
    const current = await ownEndpoint(c.var.orgId, c.req.param("id"));
    await assertProject(c.var.orgId, body.projectId);
    const set: Partial<typeof webhookEndpoint.$inferInsert> = {};
    if (body.name !== undefined) set.name = body.name;
    if (body.url !== undefined) set.url = body.url;
    if (body.events !== undefined) set.events = [...new Set(body.events)];
    if (body.projectId !== undefined) set.projectId = body.projectId;
    if (body.active !== undefined) {
      set.active = body.active;
      if (body.active) set.failingSince = null; // re-enabling starts a fresh failure window
    }
    if (!Object.keys(set).length) return c.json({ webhook: endpointOut(current) });
    const [e] = await getDb()
      .update(webhookEndpoint)
      .set(set)
      .where(eq(webhookEndpoint.id, current.id))
      .returning();
    if (!e) throw notFound("Webhook");
    return c.json({ webhook: endpointOut(e) });
  })

  .delete("/webhooks/:id", requireOrgAdmin, async (c) => {
    const e = await ownEndpoint(c.var.orgId, c.req.param("id"));
    await getDb().delete(webhookEndpoint).where(eq(webhookEndpoint.id, e.id));
    return c.body(null, 204);
  })

  .post("/webhooks/:id/rotate-secret", requireOrgAdmin, async (c) => {
    const e = await ownEndpoint(c.var.orgId, c.req.param("id"));
    if (e.kind !== "generic") throw new ApiError(400, "NO_SECRET", "Only generic webhooks are signed");
    const secret = newSecret();
    await getDb()
      .update(webhookEndpoint)
      .set({ secret: encryptSecret(secret) })
      .where(eq(webhookEndpoint.id, e.id));
    return c.json({ secret });
  })

  /** Send a `ping` event now and return the recorded attempt. */
  .post("/webhooks/:id/test", requireOrgAdmin, async (c) => {
    const e = await ownEndpoint(c.var.orgId, c.req.param("id"));
    return c.json({ delivery: await deliverNow(e, pingPayload()) });
  })

  .get("/webhooks/:id/deliveries", requireOrgAdmin, async (c) => {
    const e = await ownEndpoint(c.var.orgId, c.req.param("id"));
    const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 50) || 50, 1), 100);
    const rows = await getDb()
      .select()
      .from(webhookDelivery)
      .where(eq(webhookDelivery.endpointId, e.id))
      .orderBy(desc(webhookDelivery.createdAt))
      .limit(limit);
    return c.json({ deliveries: rows.map(deliveryOut) });
  })

  /** Re-send a recorded delivery's payload now (same event id, so receivers can de-duplicate). */
  .post("/webhook-deliveries/:id/redeliver", requireOrgAdmin, async (c) => {
    const [d] = await getDb()
      .select()
      .from(webhookDelivery)
      .where(and(eq(webhookDelivery.id, c.req.param("id")), eq(webhookDelivery.orgId, c.var.orgId)));
    if (!d) throw notFound("Delivery");
    const e = await ownEndpoint(c.var.orgId, d.endpointId);
    if (!e.active) throw new ApiError(409, "WEBHOOK_DISABLED", "Enable the webhook before redelivering");
    return c.json({ delivery: await deliverNow(e, d.payload as unknown as WebhookPayload) });
  });
