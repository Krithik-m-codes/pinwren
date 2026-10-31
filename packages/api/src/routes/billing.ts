import { checkoutRequest } from "@pinwren/core";
import { getDb, user } from "@pinwren/db";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";
import { assertBillingAvailable } from "../billing/config";
import { verifyStandardWebhook } from "../billing/signature";
import {
  type DodoEvent,
  getBillingInfo,
  portalLink,
  processWebhook,
  startCheckout,
} from "../billing/service";
import { requireOrgAdmin, type SessionVars } from "../context";
import { env } from "../env";
import { ApiError } from "../errors";
import { clientIp } from "../net";
import { consume } from "../rate-limit";

// Cloud billing (WP-22, Dodo Payments). Settings › Billing is for workspace admins; the webhook has no
// session and is authenticated by its Standard Webhooks signature alone.

const cloudOnly = createMiddleware(async (_c, next) => {
  assertBillingAvailable();
  await next();
});

/** Mounted after the dashboard router: its session and viewer guards have already run. */
export const billing = new Hono<{ Variables: SessionVars }>()
  .get("/billing", cloudOnly, requireOrgAdmin, async (c) => c.json(await getBillingInfo(c.var.orgId)))
  .post("/billing/checkout", cloudOnly, requireOrgAdmin, zValidator("json", checkoutRequest), async (c) => {
    const [u] = await getDb()
      .select({ email: user.email, name: user.name })
      .from(user)
      .where(eq(user.id, c.var.userId));
    if (!u) throw new ApiError(403, "FORBIDDEN", "Not allowed");
    return c.json(
      await startCheckout({ orgId: c.var.orgId, interval: c.req.valid("json").interval, user: u }),
    );
  })
  .post("/billing/portal", cloudOnly, requireOrgAdmin, async (c) => c.json(await portalLink(c.var.orgId)));

const MAX_BODY = 256 * 1024;
const WEBHOOKS_PER_MIN = 300;

/** Mounted before the dashboard router: no session. */
export const billingWebhook = new Hono().post(
  "/billing/webhook",
  cloudOnly,
  createMiddleware(async (c, next) => {
    if (!(await consume(`in:dodo:${clientIp(c)}`, WEBHOOKS_PER_MIN, 60))) {
      throw new ApiError(429, "RATE_LIMITED", "Too many deliveries - slow down");
    }
    await next();
  }),
  bodyLimit({
    maxSize: MAX_BODY,
    onError: () => {
      throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Payload too large");
    },
  }),
  async (c) => {
    const secret = env().DODO_PAYMENTS_WEBHOOK_KEY;
    // 503, not 401: Dodo retries non-2xx, so deliveries are not lost while the key is being set up.
    if (!secret) {
      throw new ApiError(
        503,
        "BILLING_NOT_CONFIGURED",
        "Billing is not configured: DODO_PAYMENTS_WEBHOOK_KEY is not set",
      );
    }
    const raw = await c.req.text();
    const id = c.req.header("webhook-id") ?? "";
    const verdict = verifyStandardWebhook({
      secret,
      id,
      timestamp: c.req.header("webhook-timestamp") ?? "",
      signature: c.req.header("webhook-signature") ?? "",
      body: raw,
    });
    if (verdict === "malformed")
      throw new ApiError(400, "INVALID_WEBHOOK", "Missing or malformed webhook headers");
    if (verdict !== "ok") throw new ApiError(401, "INVALID_SIGNATURE", "Signature verification failed");
    if (id.length > 200) throw new ApiError(400, "INVALID_WEBHOOK", "Webhook id too long");
    let event: DodoEvent;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || typeof (parsed as DodoEvent).type !== "string")
        throw new Error();
      event = parsed as DodoEvent;
    } catch {
      throw new ApiError(400, "INVALID_PAYLOAD", "Expected a JSON event");
    }
    const result = await processWebhook(id, event);
    return c.json({ received: true, result });
  },
);
