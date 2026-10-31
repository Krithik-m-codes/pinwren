import { z } from "zod";
import type { LICENSE_FEATURES } from "./license";

// Cloud billing (WP-22, blueprint 07 §3/§5). The plan table is the single source of truth for limits and
// public prices: the dashboard, the API and apps/www all read it. It holds no secrets and no provider ids;
// Dodo product ids come from the server environment.

export const BILLING_PLAN_IDS = ["free", "pro"] as const;
export type BillingPlanId = (typeof BILLING_PLAN_IDS)[number];
export const BILLING_INTERVALS = ["monthly", "annual"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

/** Dodo subscription statuses, plus `none` (never subscribed) and `past_due` (renewal failed, in grace). */
export const SUBSCRIPTION_STATUSES = [
  "none",
  "pending",
  "active",
  "past_due",
  "on_hold",
  "cancelled",
  "expired",
  "failed",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export type PlanLimits = {
  /** null = unlimited. */
  seats: number | null;
  projects: number | null;
  reportsPerMonth: number | null;
};

export type BillingPlan = {
  id: BillingPlanId;
  name: string;
  limits: PlanLimits;
  /** Licence features the plan switches on in Cloud (existing entitlement model, F-098). */
  features: readonly (typeof LICENSE_FEATURES)[number][];
  /** USD per month, billed monthly / billed annually (per month); null for the free plan. */
  price: { monthly: number; annualPerMonth: number } | null;
};

export const BILLING_PLANS: Readonly<Record<BillingPlanId, BillingPlan>> = {
  free: {
    id: "free",
    name: "Free",
    limits: { seats: 3, projects: 1, reportsPerMonth: 100 },
    features: [],
    price: null,
  },
  pro: {
    id: "pro",
    name: "Pro",
    limits: { seats: 10, projects: 10, reportsPerMonth: 2000 },
    // Blueprint: Pro removes the "Powered by Pinwren" badge.
    features: ["white_label"],
    price: { monthly: 29, annualPerMonth: 24 },
  },
};

/** Days a failed renewal keeps the paid plan (blueprint 07 §5). */
export const DUNNING_GRACE_DAYS = 14;
/** Reports are refused at this multiple of the monthly limit; between 100% and this only a banner shows. */
export const REPORT_HARD_LIMIT_FACTOR = 1.2;

export type SubscriptionState = {
  plan: BillingPlanId;
  interval: BillingInterval | null;
  status: SubscriptionStatus;
  currentPeriodEnd: Date | null;
  pastDueSince: Date | null;
};

const DAY = 86_400_000;

/** The plan in force now. Pure, so the same rule runs at read time and in tests (no downgrade job needed). */
export function effectivePlan(
  s: SubscriptionState | null,
  now = new Date(),
): { plan: BillingPlanId; dunning: { since: Date; endsAt: Date; daysLeft: number } | null } {
  if (!s || s.plan === "free") return { plan: "free", dunning: null };
  switch (s.status) {
    case "active":
      return { plan: s.plan, dunning: null };
    case "past_due":
    case "on_hold": {
      const since = s.pastDueSince ?? now;
      const endsAt = new Date(since.getTime() + DUNNING_GRACE_DAYS * DAY);
      const daysLeft = Math.max(0, Math.ceil((endsAt.getTime() - now.getTime()) / DAY));
      return { plan: now < endsAt ? s.plan : "free", dunning: { since, endsAt, daysLeft } };
    }
    case "cancelled":
      // Cancelled by the customer: the paid period they already paid for still runs.
      return { plan: s.currentPeriodEnd && s.currentPeriodEnd > now ? s.plan : "free", dunning: null };
    default:
      return { plan: "free", dunning: null };
  }
}

/** ok below the limit; soft at 100% (banner only); blocked at 120% (widget queues locally). */
export function reportQuota(used: number, limit: number | null): "ok" | "soft" | "blocked" {
  if (limit === null || used < limit) return "ok";
  return used >= Math.floor(limit * REPORT_HARD_LIMIT_FACTOR) ? "blocked" : "soft";
}

const usageEntry = z.object({ used: z.number().int(), limit: z.number().int().nullable() });

/** `GET /api/billing` (cloud only). */
export const billingResponse = z.object({
  plan: z.enum(BILLING_PLAN_IDS),
  planName: z.string(),
  status: z.enum(SUBSCRIPTION_STATUSES),
  interval: z.enum(BILLING_INTERVALS).nullable(),
  currentPeriodEnd: z.string().nullable(),
  /** Set while a failed renewal is in grace (or the grace is over and the plan was lowered). */
  dunning: z.object({ endsAt: z.string(), daysLeft: z.number().int(), downgraded: z.boolean() }).nullable(),
  usage: z.object({ seats: usageEntry, projects: usageEntry, reports: usageEntry }),
  /** Which paid intervals the server can sell (product ids configured). */
  checkout: z.object({
    available: z.boolean(),
    intervals: z.array(z.enum(BILLING_INTERVALS)),
    manageable: z.boolean(),
  }),
  prices: z.object({ monthly: z.number(), annualPerMonth: z.number() }),
});
export type BillingInfo = z.infer<typeof billingResponse>;

export const checkoutRequest = z.object({ interval: z.enum(BILLING_INTERVALS) });
export const billingLinkResponse = z.object({ url: z.url() });
