import type { BillingInterval } from "@pinwren/core";
import { BILLING_INTERVALS } from "@pinwren/core";
import { env } from "../env";
import { ApiError } from "../errors";

// Plan -> Dodo product mapping, data-driven from the environment: the owner creates the products in the Dodo
// dashboard and pastes their ids. Nothing here (or in @pinwren/core) names a real product.

const PRODUCT_ENV: Record<BillingInterval, "DODO_PRO_MONTHLY_PRODUCT_ID" | "DODO_PRO_ANNUAL_PRODUCT_ID"> = {
  monthly: "DODO_PRO_MONTHLY_PRODUCT_ID",
  annual: "DODO_PRO_ANNUAL_PRODUCT_ID",
};

/** Billing exists only in Cloud, and only once an API key is configured (staging and tests run without). */
export const billingEnabled = (): boolean => env().PINWREN_MODE === "cloud" && !!env().DODO_PAYMENTS_API_KEY;

export function assertBillingAvailable(): void {
  if (env().PINWREN_MODE !== "cloud") {
    throw new ApiError(404, "BILLING_UNAVAILABLE", "Billing is only available on Pinwren Cloud");
  }
}

/** Product id for a paid interval; a clear 503 naming the missing variable when it is not set. */
export function productFor(interval: BillingInterval): string {
  const name = PRODUCT_ENV[interval];
  const id = env()[name];
  if (!id) {
    throw new ApiError(503, "BILLING_NOT_CONFIGURED", `Billing is not configured: ${name} is not set`);
  }
  return id;
}

export const configuredIntervals = (): BillingInterval[] =>
  BILLING_INTERVALS.filter((i) => !!env()[PRODUCT_ENV[i]]);

/** The interval a Dodo product id stands for, or null for a product that is not one of ours. */
export function intervalForProduct(productId: string | null | undefined): BillingInterval | null {
  if (!productId) return null;
  return BILLING_INTERVALS.find((i) => env()[PRODUCT_ENV[i]] === productId) ?? null;
}

export const dodoBaseUrl = (): string =>
  (
    env().DODO_PAYMENTS_BASE_URL ??
    (env().DODO_PAYMENTS_ENVIRONMENT === "live_mode"
      ? "https://live.dodopayments.com"
      : "https://test.dodopayments.com")
  ).replace(/\/$/, "");
