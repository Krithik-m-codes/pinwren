import type { BillingInterval, PaidPlanId } from "@pinwren/core";
import { BILLING_INTERVALS, PAID_PLAN_IDS } from "@pinwren/core";
import { env } from "../env";
import { ApiError } from "../errors";

// Plan -> Dodo product mapping, data-driven from the environment: the owner creates the products in the Dodo
// dashboard and pastes their ids. Nothing here (or in @pinwren/core) names a real product.

type ProductVar =
  | "DODO_PRO_MONTHLY_PRODUCT_ID"
  | "DODO_PRO_ANNUAL_PRODUCT_ID"
  | "DODO_BUSINESS_MONTHLY_PRODUCT_ID"
  | "DODO_BUSINESS_ANNUAL_PRODUCT_ID";
const PRODUCT_ENV: Record<PaidPlanId, Record<BillingInterval, ProductVar>> = {
  pro: { monthly: "DODO_PRO_MONTHLY_PRODUCT_ID", annual: "DODO_PRO_ANNUAL_PRODUCT_ID" },
  business: { monthly: "DODO_BUSINESS_MONTHLY_PRODUCT_ID", annual: "DODO_BUSINESS_ANNUAL_PRODUCT_ID" },
};

/** Billing exists only in Cloud, and only once an API key is configured (staging and tests run without). */
export const billingEnabled = (): boolean => env().PINWREN_MODE === "cloud" && !!env().DODO_PAYMENTS_API_KEY;

export function assertBillingAvailable(): void {
  if (env().PINWREN_MODE !== "cloud") {
    throw new ApiError(404, "BILLING_UNAVAILABLE", "Billing is only available on Pinwren Cloud");
  }
}

/** Product id for a paid plan's interval; a clear 503 naming the missing variable when it is not set. */
export function productFor(interval: BillingInterval, plan: PaidPlanId = "pro"): string {
  const name = PRODUCT_ENV[plan][interval];
  const id = env()[name];
  if (!id) {
    throw new ApiError(503, "BILLING_NOT_CONFIGURED", `Billing is not configured: ${name} is not set`);
  }
  return id;
}

/** The intervals a paid plan can be sold in (a product id is configured for them). */
export const configuredIntervals = (plan: PaidPlanId = "pro"): BillingInterval[] =>
  BILLING_INTERVALS.filter((i) => !!env()[PRODUCT_ENV[plan][i]]);

/** The plan and interval a Dodo product id stands for, or null for a product that is not one of ours. */
export function planForProduct(
  productId: string | null | undefined,
): { plan: PaidPlanId; interval: BillingInterval } | null {
  if (!productId) return null;
  for (const plan of PAID_PLAN_IDS) {
    for (const interval of BILLING_INTERVALS) {
      if (env()[PRODUCT_ENV[plan][interval]] === productId) return { plan, interval };
    }
  }
  return null;
}

/** The interval a Dodo product id stands for, or null for a product that is not one of ours. */
export const intervalForProduct = (productId: string | null | undefined): BillingInterval | null =>
  planForProduct(productId)?.interval ?? null;

export const dodoBaseUrl = (): string =>
  (
    env().DODO_PAYMENTS_BASE_URL ??
    (env().DODO_PAYMENTS_ENVIRONMENT === "live_mode"
      ? "https://live.dodopayments.com"
      : "https://test.dodopayments.com")
  ).replace(/\/$/, "");
