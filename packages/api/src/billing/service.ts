import {
  BILLING_PLANS,
  type BillingInfo,
  type BillingInterval,
  effectivePlan,
  reportQuota,
  SUBSCRIPTION_STATUSES,
  type SubscriptionState,
  type SubscriptionStatus,
} from "@pinwren/core";
import { billingEvent, billingSubscription, feedback, getDb, member, project, withOrg } from "@pinwren/db";
import { and, count, eq, gte, isNull } from "drizzle-orm";
import { env } from "../env";
import { ApiError } from "../errors";
import { billingEnabled, configuredIntervals, dodoBaseUrl, intervalForProduct, productFor } from "./config";
import { createDodoClient, type DodoClient, dodoOverride } from "./dodo";

type Row = typeof billingSubscription.$inferSelect;
/** A request-scoped handle (`getDb()`) or a `withOrg` transaction. */
type Db = ReturnType<typeof getDb>;

export function dodo(): DodoClient {
  const injected = dodoOverride();
  if (injected) return injected;
  const apiKey = env().DODO_PAYMENTS_API_KEY;
  if (!apiKey) {
    throw new ApiError(
      503,
      "BILLING_NOT_CONFIGURED",
      "Billing is not configured: DODO_PAYMENTS_API_KEY is not set",
    );
  }
  return createDodoClient({ apiKey, baseUrl: dodoBaseUrl() });
}

const isStatus = (s: string): s is SubscriptionStatus =>
  (SUBSCRIPTION_STATUSES as readonly string[]).includes(s);
const asInterval = (s: string | null): BillingInterval | null =>
  s === "annual" || s === "monthly" ? s : null;

export const toState = (row: Row | undefined): SubscriptionState | null =>
  row
    ? {
        plan: row.plan === "pro" ? "pro" : "free",
        interval: asInterval(row.interval),
        status: isStatus(row.status) ? row.status : "none",
        currentPeriodEnd: row.currentPeriodEnd,
        pastDueSince: row.pastDueSince,
      }
    : null;

async function loadRow(db: Db, orgId: string): Promise<Row | undefined> {
  const [row] = await db.select().from(billingSubscription).where(eq(billingSubscription.orgId, orgId));
  return row;
}

const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

/** Seats, live projects and reports received this (UTC) month. Deleting a report does not free quota. */
export async function orgUsage(db: Db, orgId: string, now = new Date()) {
  const [seats] = await db.select({ n: count() }).from(member).where(eq(member.organizationId, orgId));
  const [projects] = await db
    .select({ n: count() })
    .from(project)
    .where(and(eq(project.orgId, orgId), isNull(project.archivedAt)));
  const [reports] = await db
    .select({ n: count() })
    .from(feedback)
    .where(and(eq(feedback.orgId, orgId), gte(feedback.createdAt, monthStart(now))));
  return { seats: seats?.n ?? 0, projects: projects?.n ?? 0, reports: reports?.n ?? 0 };
}

/** The plan in force for an organisation (the entitlement code consumes this in Cloud). */
export async function planFor(db: Db, orgId: string, now = new Date()) {
  const row = await loadRow(db, orgId);
  const { plan, dunning } = effectivePlan(toState(row), now);
  return { plan, dunning, row, definition: BILLING_PLANS[plan] };
}

export async function getBillingInfo(orgId: string, now = new Date()): Promise<BillingInfo> {
  const db = getDb();
  const { plan, dunning, row, definition } = await planFor(db, orgId, now);
  const used = await orgUsage(db, orgId, now);
  const intervals = configuredIntervals();
  const l = definition.limits;
  return {
    plan,
    planName: definition.name,
    status: row && isStatus(row.status) ? row.status : "none",
    interval: asInterval(row?.interval ?? null),
    currentPeriodEnd: row?.currentPeriodEnd?.toISOString() ?? null,
    dunning: dunning
      ? { endsAt: dunning.endsAt.toISOString(), daysLeft: dunning.daysLeft, downgraded: plan === "free" }
      : null,
    usage: {
      seats: { used: used.seats, limit: l.seats },
      projects: { used: used.projects, limit: l.projects },
      reports: { used: used.reports, limit: l.reportsPerMonth },
    },
    checkout: {
      available: billingEnabled() && intervals.length > 0,
      intervals,
      manageable: !!row?.dodoCustomerId,
    },
    prices: BILLING_PLANS.pro.price ?? { monthly: 0, annualPerMonth: 0 },
  };
}

export async function startCheckout(input: {
  orgId: string;
  interval: BillingInterval;
  user: { email: string; name: string };
}): Promise<{ url: string }> {
  const productId = productFor(input.interval);
  const row = await loadRow(getDb(), input.orgId);
  const { plan } = effectivePlan(toState(row));
  if (plan === "pro" && row?.status === "active") {
    throw new ApiError(
      409,
      "ALREADY_SUBSCRIBED",
      "This workspace already has an active subscription - manage it from the billing portal",
    );
  }
  const base = env().PINWREN_URL.replace(/\/$/, "");
  const session = await dodo().createCheckout({
    productId,
    email: input.user.email,
    name: input.user.name,
    customerId: row?.dodoCustomerId ?? null,
    returnUrl: `${base}/settings/billing?checkout=return`,
    cancelUrl: `${base}/settings/billing?checkout=cancelled`,
    // The webhook maps events back to the workspace with this; it is the only link between the two.
    metadata: { pinwren_org_id: input.orgId },
  });
  return { url: session.url };
}

export async function portalLink(orgId: string): Promise<{ url: string }> {
  const row = await loadRow(getDb(), orgId);
  if (!row?.dodoCustomerId) {
    throw new ApiError(
      409,
      "NO_BILLING_ACCOUNT",
      "This workspace has no billing account yet - subscribe first",
    );
  }
  return dodo().createPortalSession(
    row.dodoCustomerId,
    `${env().PINWREN_URL.replace(/\/$/, "")}/settings/billing`,
  );
}

// --- Limits ---------------------------------------------------------------------------------------------

async function limitsFor(db: Db, orgId: string) {
  return (await planFor(db, orgId)).definition.limits;
}

/** Refuse creating a project beyond the plan (hard: projects have no soft zone). No-op without billing. */
export async function assertProjectQuota(db: Db, orgId: string): Promise<void> {
  if (!billingEnabled()) return;
  const limit = (await limitsFor(db, orgId)).projects;
  if (limit !== null && (await orgUsage(db, orgId)).projects >= limit) {
    throw new ApiError(
      402,
      "PLAN_LIMIT_PROJECTS",
      `Your plan includes ${limit} project${limit === 1 ? "" : "s"}. Upgrade to add more.`,
    );
  }
}

/** Refuse adding a team member beyond the plan's seats. No-op without billing. */
export async function assertSeatQuota(db: Db, orgId: string): Promise<void> {
  if (!billingEnabled()) return;
  const limit = (await limitsFor(db, orgId)).seats;
  if (limit !== null && (await orgUsage(db, orgId)).seats >= limit) {
    throw new ApiError(
      402,
      "PLAN_LIMIT_SEATS",
      `Your plan includes ${limit} team seats. Upgrade to add more people.`,
    );
  }
}

/** Widget intake: blocked at 120% of the monthly allowance (the widget queues locally). */
export async function assertReportQuota(orgId: string): Promise<void> {
  if (!billingEnabled()) return;
  await withOrg(orgId, async (db) => {
    const limit = (await limitsFor(db, orgId)).reportsPerMonth;
    if (reportQuota((await orgUsage(db, orgId)).reports, limit) === "blocked") {
      throw new ApiError(429, "FEEDBACK_UNAVAILABLE", "Feedback is temporarily unavailable for this site");
    }
  });
}

// --- Webhook --------------------------------------------------------------------------------------------

export type DodoEvent = {
  type: string;
  timestamp?: string;
  data?: {
    subscription_id?: string;
    status?: string;
    product_id?: string;
    customer?: { customer_id?: string };
    metadata?: Record<string, unknown>;
    next_billing_date?: string;
    cancel_at_next_billing_date?: boolean;
  };
};

export const eventOrgId = (e: DodoEvent): string | null => {
  const v = e.data?.metadata?.pinwren_org_id;
  return typeof v === "string" && v.length > 0 && v.length <= 200 ? v : null;
};

export type Patch = Partial<
  Pick<
    Row,
    | "plan"
    | "interval"
    | "status"
    | "dodoCustomerId"
    | "dodoSubscriptionId"
    | "productId"
    | "currentPeriodEnd"
    | "cancelAtPeriodEnd"
    | "pastDueSince"
    | "lastEventAt"
  >
>;

const toDate = (v: string | undefined) => {
  const d = v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

const ACTIVATING = new Set(["subscription.active", "subscription.renewed", "subscription.unpaused"]);
const SYNCING = new Set([
  "subscription.updated",
  "subscription.plan_changed",
  "subscription.update_payment_method",
]);
const DUNNING: Record<string, SubscriptionStatus> = {
  "subscription.past_due": "past_due",
  "subscription.on_hold": "on_hold",
  "subscription.paused": "on_hold",
};
const ENDING: Record<string, SubscriptionStatus> = {
  "subscription.cancelled": "cancelled",
  "subscription.expired": "expired",
  "subscription.failed": "failed",
};

/**
 * Pure transition: the row changes after an event, or null when the event changes nothing here (unknown
 * type, foreign product, another subscription, or older than what is stored).
 */
export function applyEvent(current: Row | undefined, e: DodoEvent, now = new Date()): Patch | null {
  const data = e.data ?? {};
  const at = toDate(e.timestamp) ?? now;
  if (current?.lastEventAt && at < current.lastEventAt) return null;
  const subId = data.subscription_id ?? null;
  const sameSub = !current?.dodoSubscriptionId || current.dodoSubscriptionId === subId;

  let status: SubscriptionStatus | null = null;
  if (ACTIVATING.has(e.type)) status = "active";
  else if (e.type in DUNNING) status = DUNNING[e.type] ?? null;
  else if (e.type in ENDING) status = ENDING[e.type] ?? null;
  else if (SYNCING.has(e.type)) {
    const s = data.status;
    status =
      s === "active" || s === "on_hold" || s === "cancelled" || s === "expired" || s === "failed" ? s : null;
  } else if (e.type === "payment.failed") {
    // Only a payment of the subscription we know opens the grace period.
    if (!subId || current?.dodoSubscriptionId !== subId || current.status !== "active") return null;
    status = "past_due";
  } else if (e.type === "payment.succeeded") {
    if (!subId || current?.dodoSubscriptionId !== subId) return null;
    if (current.status !== "past_due" && current.status !== "on_hold") return null;
    status = "active";
  }
  if (!status) return null;

  const interval = intervalForProduct(data.product_id);
  if (status === "active") {
    // Never grant a paid plan for a product that is not one of ours.
    if (!interval) return null;
  } else if (!sameSub) {
    // A late event of a replaced subscription must not touch the one in force.
    return null;
  }

  const patch: Patch = { status, lastEventAt: at };
  if (subId) patch.dodoSubscriptionId = subId;
  if (data.customer?.customer_id) patch.dodoCustomerId = data.customer.customer_id;
  if (data.product_id) patch.productId = data.product_id;
  const next = toDate(data.next_billing_date);
  if (next) patch.currentPeriodEnd = next;
  if (status === "active") {
    patch.plan = "pro";
    if (interval) patch.interval = interval;
    patch.pastDueSince = null;
    patch.cancelAtPeriodEnd = data.cancel_at_next_billing_date === true;
  } else if (status === "past_due" || status === "on_hold") {
    // The grace runs from the first failure, not from each retry.
    patch.pastDueSince = current?.pastDueSince ?? at;
  } else if (status === "cancelled") {
    patch.cancelAtPeriodEnd = true;
  }
  return patch;
}

export type WebhookResult = "applied" | "duplicate" | "ignored";

/** Apply one verified event atomically with its idempotency record (a failure rolls both back). */
export async function processWebhook(
  webhookId: string,
  event: DodoEvent,
  now = new Date(),
): Promise<WebhookResult> {
  const orgId = eventOrgId(event);
  if (!orgId) return "ignored";
  try {
    return await withOrg(orgId, async (db) => {
      const inserted = await db
        .insert(billingEvent)
        .values({ orgId, webhookId, type: event.type.slice(0, 100) })
        .onConflictDoNothing()
        .returning({ id: billingEvent.webhookId });
      if (!inserted.length) return "duplicate";
      const current = await loadRow(db, orgId);
      const patch = applyEvent(current, event, now);
      if (!patch) return "ignored";
      await db
        .insert(billingSubscription)
        .values({ orgId, ...patch })
        .onConflictDoUpdate({ target: billingSubscription.orgId, set: patch });
      return "applied";
    });
  } catch (err) {
    // Metadata naming an organisation that does not exist: nothing to update, nothing to retry.
    if ((err as { cause?: { code?: string } }).cause?.code === "23503") return "ignored";
    throw err;
  }
}
