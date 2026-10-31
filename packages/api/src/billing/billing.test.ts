import type { applyEvent as applyEventType } from "./service";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Dodo client, product mapping and the webhook state machine. No database and no network: the HTTP function
// is injected and the transition is a pure function.

const KEY = "fixture-api-key-value";
const env = {
  DATABASE_URL: "postgres://unused@127.0.0.1:1/none",
  PINWREN_URL: "http://localhost:3100",
  PINWREN_SECRET: "x".repeat(48),
  PINWREN_MODE: "cloud",
  PINWREN_SERVICE_DATABASE_URL: "postgres://unused@127.0.0.1:1/none",
  DODO_PRO_MONTHLY_PRODUCT_ID: "prod_m",
  DODO_PRO_ANNUAL_PRODUCT_ID: "prod_a",
};

beforeEach(() => {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
});
afterEach(() => vi.unstubAllEnvs());

describe("Dodo client", () => {
  const sent: { url: string; init: RequestInit }[] = [];
  const respond =
    (body: unknown, status = 200) =>
    (url: string, init: RequestInit) => {
      sent.push({ url, init });
      return Promise.resolve(Response.json(body, { status }));
    };
  beforeEach(() => {
    sent.length = 0;
  });

  it("creates a subscription checkout with the cart, customer and metadata", async () => {
    const { createDodoClient } = await import("./dodo");
    const client = createDodoClient({
      apiKey: KEY,
      baseUrl: "https://test.dodopayments.com",
      fetch: respond({ session_id: "cks_1", checkout_url: "https://checkout.test/cks_1" }),
    });
    const out = await client.createCheckout({
      productId: "prod_a",
      email: "a@example.test",
      name: "Ada",
      returnUrl: "https://app.test/ok",
      cancelUrl: "https://app.test/no",
      metadata: { pinwren_org_id: "org_1" },
    });
    expect(out).toEqual({ sessionId: "cks_1", url: "https://checkout.test/cks_1" });
    expect(sent[0]?.url).toBe("https://test.dodopayments.com/checkouts");
    expect(new Headers(sent[0]?.init.headers).get("authorization")).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(sent[0]?.init.body as string)).toEqual({
      product_cart: [{ product_id: "prod_a", quantity: 1 }],
      customer: { email: "a@example.test", name: "Ada" },
      return_url: "https://app.test/ok",
      cancel_url: "https://app.test/no",
      metadata: { pinwren_org_id: "org_1" },
    });
  });

  it("reuses a known customer instead of creating one", async () => {
    const { createDodoClient } = await import("./dodo");
    const client = createDodoClient({
      apiKey: KEY,
      baseUrl: "https://x.test",
      fetch: respond({ session_id: "s", checkout_url: "https://c.test/s" }),
    });
    await client.createCheckout({
      productId: "p",
      email: "a@example.test",
      name: "Ada",
      customerId: "cus_9",
      returnUrl: "https://a.test",
      cancelUrl: "https://a.test",
      metadata: {},
    });
    expect((JSON.parse(sent[0]?.init.body as string) as { customer: unknown }).customer).toEqual({
      customer_id: "cus_9",
    });
  });

  it("opens a portal session for the customer", async () => {
    const { createDodoClient } = await import("./dodo");
    const client = createDodoClient({
      apiKey: KEY,
      baseUrl: "https://x.test",
      fetch: respond({ link: "https://portal.test/s" }),
    });
    expect(await client.createPortalSession("cus 1", "https://app.test/b")).toEqual({
      url: "https://portal.test/s",
    });
    expect(sent[0]?.url).toBe(
      "https://x.test/customers/cus%201/customer-portal/session?return_url=https%3A%2F%2Fapp.test%2Fb",
    );
    expect(sent[0]?.init.method).toBe("POST");
  });

  it("maps provider failures to a 502 without echoing the provider body or the key", async () => {
    const { createDodoClient } = await import("./dodo");
    const failing = createDodoClient({
      apiKey: KEY,
      baseUrl: "https://x.test",
      fetch: respond({ message: `secret detail ${KEY}` }, 401),
    });
    const err = await failing.createPortalSession("c", "https://a.test").catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 502, code: "BILLING_PROVIDER_ERROR" });
    expect(JSON.stringify(err) + (err as Error).message).not.toContain(KEY);
    const down = createDodoClient({
      apiKey: KEY,
      baseUrl: "https://x.test",
      fetch: () => Promise.reject(new Error(`connect ECONNREFUSED ${KEY}`)),
    });
    const err2 = await down.createPortalSession("c", "https://a.test").catch((e: unknown) => e);
    expect(err2).toMatchObject({ status: 502, code: "BILLING_PROVIDER_UNREACHABLE" });
    expect((err2 as Error).message).not.toContain(KEY);
  });

  it("rejects an unexpected response shape", async () => {
    const { createDodoClient } = await import("./dodo");
    const client = createDodoClient({ apiKey: KEY, baseUrl: "https://x.test", fetch: respond({}) });
    await expect(client.createPortalSession("c", "https://a.test")).rejects.toMatchObject({ status: 502 });
  });
});

describe("product mapping", () => {
  it("reads product ids from the environment and names the missing variable", async () => {
    const config = await import("./config");
    expect(config.productFor("monthly")).toBe("prod_m");
    expect(config.intervalForProduct("prod_a")).toBe("annual");
    expect(config.intervalForProduct("prod_other")).toBeNull();
    expect(config.configuredIntervals()).toEqual(["monthly", "annual"]);
    vi.resetModules();
    vi.stubEnv("DODO_PRO_ANNUAL_PRODUCT_ID", "");
    const again = await import("./config");
    expect(() => again.productFor("annual")).toThrow(/DODO_PRO_ANNUAL_PRODUCT_ID is not set/);
    expect(again.configuredIntervals()).toEqual(["monthly"]);
  });

  it("derives the API origin from the environment", async () => {
    let config = await import("./config");
    expect(config.dodoBaseUrl()).toBe("https://test.dodopayments.com");
    vi.resetModules();
    vi.stubEnv("DODO_PAYMENTS_ENVIRONMENT", "live_mode");
    config = await import("./config");
    expect(config.dodoBaseUrl()).toBe("https://live.dodopayments.com");
    vi.resetModules();
    vi.stubEnv("DODO_PAYMENTS_BASE_URL", "http://127.0.0.1:9/");
    config = await import("./config");
    expect(config.dodoBaseUrl()).toBe("http://127.0.0.1:9");
  });

  it("is off outside Cloud and until an API key is set", async () => {
    let config = await import("./config");
    expect(config.billingEnabled()).toBe(false);
    vi.resetModules();
    vi.stubEnv("DODO_PAYMENTS_API_KEY", KEY);
    config = await import("./config");
    expect(config.billingEnabled()).toBe(true);
    vi.resetModules();
    vi.stubEnv("PINWREN_MODE", "selfhost");
    config = await import("./config");
    expect(config.billingEnabled()).toBe(false);
    expect(() => config.assertBillingAvailable()).toThrow(/only available on Pinwren Cloud/);
  });
});

describe("webhook state machine", () => {
  type Row = Parameters<typeof applyEventType>[0];
  const t0 = new Date("2026-11-01T00:00:00Z");
  const at = (m: number) => new Date(t0.getTime() + m * 60_000).toISOString();
  const data = (extra: Record<string, unknown> = {}) => ({
    subscription_id: "sub_1",
    product_id: "prod_a",
    customer: { customer_id: "cus_1" },
    ...extra,
  });
  const row = (over: Partial<NonNullable<Row>> = {}): Row => ({
    orgId: "o",
    plan: "pro",
    interval: "annual",
    status: "active",
    dodoCustomerId: "cus_1",
    dodoSubscriptionId: "sub_1",
    productId: "prod_a",
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    pastDueSince: null,
    lastEventAt: null,
    updatedAt: t0,
    ...over,
  });

  it("activates Pro for a known product and records the customer and period", async () => {
    const { applyEvent } = await import("./service");
    const patch = applyEvent(
      undefined,
      {
        type: "subscription.active",
        timestamp: at(0),
        data: data({ next_billing_date: "2027-11-01T00:00:00Z" }),
      },
      t0,
    );
    expect(patch).toMatchObject({
      plan: "pro",
      interval: "annual",
      status: "active",
      dodoCustomerId: "cus_1",
      dodoSubscriptionId: "sub_1",
      pastDueSince: null,
    });
    expect(patch?.currentPeriodEnd?.toISOString()).toBe("2027-11-01T00:00:00.000Z");
  });

  it("never grants Pro for a product that is not configured", async () => {
    const { applyEvent } = await import("./service");
    expect(
      applyEvent(undefined, { type: "subscription.active", data: data({ product_id: "prod_x" }) }),
    ).toBeNull();
  });

  it("starts the grace on the first failure and keeps its start across retries", async () => {
    const { applyEvent } = await import("./service");
    const first = applyEvent(row(), { type: "subscription.on_hold", timestamp: at(1), data: data() });
    expect(first).toMatchObject({ status: "on_hold" });
    expect(first?.pastDueSince?.toISOString()).toBe(at(1));
    const retry = applyEvent(
      row({ status: "on_hold", pastDueSince: new Date(at(1)), lastEventAt: new Date(at(1)) }),
      { type: "subscription.past_due", timestamp: at(60), data: data() },
    );
    expect(retry?.pastDueSince?.toISOString()).toBe(at(1));
  });

  it("clears the grace on renewal or a successful payment", async () => {
    const { applyEvent } = await import("./service");
    const held = row({ status: "on_hold", pastDueSince: new Date(at(1)) });
    expect(applyEvent(held, { type: "subscription.renewed", timestamp: at(5), data: data() })).toMatchObject({
      status: "active",
      pastDueSince: null,
    });
    expect(applyEvent(held, { type: "payment.succeeded", timestamp: at(5), data: data() })).toMatchObject({
      status: "active",
    });
    // A successful payment of an unrelated subscription changes nothing.
    expect(
      applyEvent(held, { type: "payment.succeeded", data: data({ subscription_id: "sub_other" }) }),
    ).toBeNull();
  });

  it("opens the grace on payment.failed only for the known active subscription", async () => {
    const { applyEvent } = await import("./service");
    expect(applyEvent(row(), { type: "payment.failed", timestamp: at(2), data: data() })).toMatchObject({
      status: "past_due",
    });
    expect(applyEvent(undefined, { type: "payment.failed", data: data() })).toBeNull();
    expect(
      applyEvent(row(), { type: "payment.failed", data: data({ subscription_id: "sub_other" }) }),
    ).toBeNull();
  });

  it("records cancellation, expiry and failure without changing the subscription id", async () => {
    const { applyEvent } = await import("./service");
    for (const [type, status] of [
      ["subscription.cancelled", "cancelled"],
      ["subscription.expired", "expired"],
      ["subscription.failed", "failed"],
    ] as const)
      expect(applyEvent(row(), { type, timestamp: at(3), data: data() })).toMatchObject({ status });
  });

  it("ignores events of a replaced subscription and events older than the stored one", async () => {
    const { applyEvent } = await import("./service");
    expect(
      applyEvent(row(), { type: "subscription.cancelled", data: data({ subscription_id: "sub_old" }) }),
    ).toBeNull();
    expect(
      applyEvent(row({ lastEventAt: new Date(at(10)) }), {
        type: "subscription.on_hold",
        timestamp: at(5),
        data: data(),
      }),
    ).toBeNull();
    // A new subscription replaces the old one.
    expect(
      applyEvent(row({ status: "cancelled" }), {
        type: "subscription.active",
        timestamp: at(20),
        data: data({ subscription_id: "sub_new" }),
      }),
    ).toMatchObject({ status: "active", dodoSubscriptionId: "sub_new" });
  });

  it("follows the status of generic update events and ignores unknown types", async () => {
    const { applyEvent } = await import("./service");
    expect(
      applyEvent(row(), { type: "subscription.updated", data: data({ status: "on_hold" }) }),
    ).toMatchObject({ status: "on_hold" });
    expect(applyEvent(row(), { type: "subscription.updated", data: data({ status: "pending" }) })).toBeNull();
    expect(applyEvent(row(), { type: "refund.succeeded", data: data() })).toBeNull();
  });

  it("maps events to a workspace only through the checkout metadata", async () => {
    const { eventOrgId } = await import("./service");
    expect(eventOrgId({ type: "x", data: { metadata: { pinwren_org_id: "org_1" } } })).toBe("org_1");
    expect(eventOrgId({ type: "x", data: { metadata: {} } })).toBeNull();
    expect(eventOrgId({ type: "x", data: { metadata: { pinwren_org_id: 5 } } })).toBeNull();
    expect(eventOrgId({ type: "x" })).toBeNull();
  });
});

describe("entitlements in Cloud", () => {
  it("adds the plan's features and seat limit to a licence-less workspace", async () => {
    vi.stubEnv("DODO_PAYMENTS_API_KEY", KEY);
    const { withCloudPlan, entitlementsFor } = await import("../license");
    const { BILLING_PLANS } = await import("@pinwren/core");
    const base = entitlementsFor(null, null, 2);
    const pro = withCloudPlan(base, { plan: "pro", definition: BILLING_PLANS.pro });
    expect(pro).toMatchObject({
      edition: "cloud",
      plan: "pro",
      features: ["white_label"],
      seats: { limit: 10, used: 2 },
    });
    expect(withCloudPlan(base, { plan: "free", definition: BILLING_PLANS.free })).toMatchObject({
      plan: "free",
      features: [],
      seats: { limit: 3 },
    });
  });

  it("leaves entitlements untouched while billing is not configured", async () => {
    const { withCloudPlan, entitlementsFor } = await import("../license");
    const { BILLING_PLANS } = await import("@pinwren/core");
    const base = entitlementsFor(null, null, 2);
    expect(withCloudPlan(base, { plan: "free", definition: BILLING_PLANS.free })).toBe(base);
  });
});
