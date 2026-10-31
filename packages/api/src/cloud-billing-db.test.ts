import type * as ApiModule from "./index";
import type * as BossModule from "./jobs/boss";
import type * as BusModule from "./realtime/bus";
import { createHmac, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getRuntimeDb } from "../../db/src/connection";
import { closeIdentityDatabase } from "../../db/src/identity";
import { createCloudFixture } from "./test-helpers/cloud-fixture";

/**
 * Cloud billing end to end against a real database (WP-22): checkout and portal through an injected Dodo
 * client (no network), signed webhooks, plan -> entitlements, limits and the dunning downgrade.
 */
const effects = vi.hoisted(() => ({
  enqueue: vi.fn<(...args: unknown[]) => Promise<void>>(),
  publish: vi.fn<(...args: unknown[]) => Promise<void>>(),
}));
vi.mock("./jobs/boss", async (original) => ({
  ...(await original<typeof BossModule>()),
  enqueue: effects.enqueue,
}));
vi.mock("./realtime/bus", async (original) => ({
  ...(await original<typeof BusModule>()),
  publish: effects.publish,
}));

const WEBHOOK_KEY = `whsec_${Buffer.from("billing-db-webhook-key-0123456789").toString("base64")}`;
type Json = Record<string, unknown>;

describe.skipIf(!process.env.PINWREN_ISOLATION_ADMIN_URL)("Cloud billing", () => {
  let fixture: Awaited<ReturnType<typeof createCloudFixture>> | undefined;
  let api: typeof ApiModule.app;
  const suffix = randomUUID();
  const org = `bill-${suffix}`;
  const userId = `user-bill-${suffix}`;
  const password = randomUUID();
  const jar = new Map<string, string>();
  const dodoCalls = { checkout: [] as Json[], portal: [] as string[] };
  const db = () => {
    if (!fixture) throw new Error("fixture not ready");
    return fixture.db;
  };

  const request = (
    path: string,
    init: {
      method?: string;
      body?: unknown;
      headers?: Record<string, string>;
      cookies?: Map<string, string>;
    } = {},
  ) => {
    const headers = new Headers({
      origin: "http://localhost:3100",
      "content-type": "application/json",
      ...init.headers,
    });
    const cookies = init.cookies ?? jar;
    if (cookies.size) headers.set("cookie", [...cookies].map(([k, v]) => `${k}=${v}`).join("; "));
    return api.request(`http://localhost:3100${path}`, {
      method: init.method ?? "GET",
      headers,
      ...(init.body === undefined
        ? {}
        : { body: typeof init.body === "string" ? init.body : JSON.stringify(init.body) }),
    });
  };
  const take = (response: Response, into = jar) => {
    for (const cookie of response.headers.getSetCookie()) {
      const part = cookie.split(";")[0] ?? "";
      const eq = part.indexOf("=");
      if (eq > 0 && part.slice(eq + 1)) into.set(part.slice(0, eq), part.slice(eq + 1));
    }
  };
  const webhook = (id: string, type: string, data: Json, at = new Date()) => {
    const raw = JSON.stringify({
      type,
      timestamp: at.toISOString(),
      data: {
        subscription_id: "sub_1",
        customer: { customer_id: "cus_1" },
        metadata: { pinwren_org_id: org },
        ...data,
      },
    });
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = createHmac("sha256", Buffer.from(WEBHOOK_KEY.slice(6), "base64"))
      .update(`${id}.${ts}.${raw}`)
      .digest("base64");
    return request("/api/billing/webhook", {
      method: "POST",
      body: raw,
      cookies: new Map(),
      headers: { "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": `v1,${sig}` },
    });
  };
  const billing = async () => (await (await request("/api/billing")).json()) as Json;
  const entitlements = async () => (await (await request("/api/me/entitlements")).json()) as Json;
  const addProject = (name: string) =>
    request("/api/projects", { method: "POST", body: { name, allowedOrigins: ["https://customer.test"] } });

  beforeAll(async () => {
    fixture = await createCloudFixture();
    vi.stubEnv("PINWREN_MODE", "cloud");
    vi.stubEnv("DATABASE_URL", fixture.runtimeUrl);
    vi.stubEnv("PINWREN_SERVICE_DATABASE_URL", fixture.serviceUrl);
    vi.stubEnv("PINWREN_URL", "http://localhost:3100");
    vi.stubEnv("PINWREN_SECRET", randomUUID() + randomUUID());
    vi.stubEnv("PINWREN_DISABLE_SIGNUP", "false");
    vi.stubEnv("PINWREN_ADMIN_EMAILS", undefined);
    vi.stubEnv("DODO_PAYMENTS_API_KEY", "fixture-key-not-a-secret");
    vi.stubEnv("DODO_PAYMENTS_WEBHOOK_KEY", WEBHOOK_KEY);
    vi.stubEnv("DODO_PRO_MONTHLY_PRODUCT_ID", "prod_monthly");
    vi.stubEnv("DODO_PRO_ANNUAL_PRODUCT_ID", "prod_annual");
    const d = fixture.db;
    await d`insert into organization (id,name,slug) values (${org},${org},${org})`;
    await d`insert into "user" (id,name,email,email_verified) values (${userId},'Owner',${`${userId}@test.invalid`},true)`;
    await d`insert into account (id,account_id,provider_id,user_id,password) values (${randomUUID()},${userId},'credential',${userId},${await hashPassword(password)})`;
    await d`insert into member (id,organization_id,user_id,role) values (${randomUUID()},${org},${userId},'owner')`;
    const projectId = randomUUID();
    await d`insert into project (id,org_id,name,slug,public_key,allowed_origins,identity_secret,action_secret) values (${projectId},${org},'First','first',${projectId},${d.array(["https://customer.test"])},${randomUUID()},${randomUUID()})`;
    api = (await import("./index")).app;
    const { setDodoClient } = await import("./billing/dodo");
    setDodoClient({
      createCheckout: (input) => {
        dodoCalls.checkout.push(input);
        return Promise.resolve({ sessionId: "cks_1", url: "https://checkout.example.test/cks_1" });
      },
      createPortalSession: (customerId) => {
        dodoCalls.portal.push(customerId);
        return Promise.resolve({ url: "https://portal.example.test/session" });
      },
    });
    const signed = await request("/api/auth/sign-in/email", {
      method: "POST",
      body: { email: `${userId}@test.invalid`, password },
    });
    expect(signed.status).toBe(200);
    take(signed);
    const active = await request("/api/auth/organization/set-active", {
      method: "POST",
      body: { organizationId: org },
    });
    expect(active.status).toBe(200);
    take(active);
  }, 120_000);
  beforeEach(() => {
    effects.enqueue.mockReset().mockResolvedValue(undefined);
    effects.publish.mockReset().mockResolvedValue(undefined);
  });
  afterAll(async () => {
    const { setDodoClient } = await import("./billing/dodo");
    setDodoClient(undefined);
    if (fixture) {
      await closeIdentityDatabase();
      await getRuntimeDb().$client.end();
      await fixture.dispose();
    }
    vi.unstubAllEnvs();
  });

  it("starts on the free plan with its limits and offers both intervals", async () => {
    expect(await billing()).toMatchObject({
      plan: "free",
      status: "none",
      usage: { projects: { used: 1, limit: 1 }, seats: { used: 1, limit: 3 }, reports: { limit: 100 } },
      checkout: { available: true, intervals: ["monthly", "annual"], manageable: false },
    });
  });

  it("refuses a second project on Free with an upgrade message", async () => {
    const response = await addProject("Second");
    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({ code: "PLAN_LIMIT_PROJECTS" });
  });

  it("has no portal before the first subscription", async () => {
    expect((await request("/api/billing/portal", { method: "POST", body: {} })).status).toBe(409);
  });

  it("creates a checkout for the annual product carrying the workspace in metadata", async () => {
    const response = await request("/api/billing/checkout", { method: "POST", body: { interval: "annual" } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: "https://checkout.example.test/cks_1" });
    expect(dodoCalls.checkout[0]).toMatchObject({
      productId: "prod_annual",
      email: `${userId}@test.invalid`,
      metadata: { pinwren_org_id: org },
    });
    const bad = await request("/api/billing/checkout", { method: "POST", body: { interval: "weekly" } });
    expect(bad.status).toBe(400);
  });

  it("upgrades on the signed subscription.active webhook and lifts the limits", async () => {
    const response = await webhook("msg_1", "subscription.active", {
      status: "active",
      product_id: "prod_annual",
      next_billing_date: "2027-10-31T00:00:00Z",
    });
    expect(response.status).toBe(200);
    expect(await billing()).toMatchObject({
      plan: "pro",
      status: "active",
      interval: "annual",
      dunning: null,
      usage: { projects: { limit: 10 }, seats: { limit: 10 } },
      checkout: { manageable: true },
    });
    expect((await addProject("Second")).status).toBe(201);
  });

  it("feeds the existing entitlements: plan, edition and the plan's features", async () => {
    expect(await entitlements()).toMatchObject({
      edition: "cloud",
      plan: "pro",
      features: ["white_label"],
      seats: { limit: 10 },
    });
  });

  it("opens the portal for the stored customer", async () => {
    const response = await request("/api/billing/portal", { method: "POST", body: {} });
    expect(await response.json()).toEqual({ url: "https://portal.example.test/session" });
    expect(dodoCalls.portal).toEqual(["cus_1"]);
  });

  it("applies each webhook-id once and ignores a late event of an older timestamp", async () => {
    const hold = await webhook("msg_2", "subscription.on_hold", {}, new Date(Date.now() + 1000));
    expect(await hold.json()).toMatchObject({ result: "applied" });
    const again = await webhook("msg_2", "subscription.cancelled", {});
    expect(await again.json()).toMatchObject({ result: "duplicate" });
    const late = await webhook(
      "msg_3",
      "subscription.active",
      { product_id: "prod_annual" },
      new Date(Date.now() - 3600_000),
    );
    expect(await late.json()).toMatchObject({ result: "ignored" });
    expect(await billing()).toMatchObject({ plan: "pro", status: "on_hold", dunning: { downgraded: false } });
  });

  it("downgrades to Free once the 14-day grace has passed, keeping the data", async () => {
    await db()`update billing_subscription set past_due_since = now() - interval '15 days' where org_id=${org}`;
    expect(await billing()).toMatchObject({
      plan: "free",
      status: "on_hold",
      dunning: { downgraded: true, daysLeft: 0 },
      usage: { projects: { used: 2, limit: 1 } },
    });
    expect(await entitlements()).toMatchObject({ plan: "free", features: [] });
    expect((await addProject("Third")).status).toBe(402);
    const list = (await (await request("/api/projects")).json()) as { projects: unknown[] };
    expect(list.projects).toHaveLength(2);
  });

  it("recovers on a successful renewal", async () => {
    await webhook(
      "msg_4",
      "subscription.renewed",
      { product_id: "prod_annual", status: "active" },
      new Date(Date.now() + 5000),
    );
    expect(await billing()).toMatchObject({ plan: "pro", status: "active", dunning: null });
  });

  it("blocks widget reports at 120% of the monthly allowance on Free only", async () => {
    const { assertReportQuota } = await import("./billing/service");
    const d = db();
    const [project] = await d<{ id: string }[]>`select id from project where org_id=${org} limit 1`;
    for (let n = 1; n <= 120; n++) {
      await d`insert into feedback (id,org_id,project_id,number,kind,body,client_id) values (${randomUUID()},${org},${project?.id ?? ""},${n},'bug','q',${randomUUID()})`;
    }
    await expect(assertReportQuota(org)).resolves.toBeUndefined(); // Pro allows 2,000
    await webhook("msg_5", "subscription.expired", {}, new Date(Date.now() + 9000));
    expect(await billing()).toMatchObject({ plan: "free", usage: { reports: { used: 120, limit: 100 } } });
    await expect(assertReportQuota(org)).rejects.toMatchObject({ status: 429, code: "FEEDBACK_UNAVAILABLE" });
    await d`delete from feedback where org_id=${org} and number > 110`;
    await expect(assertReportQuota(org)).resolves.toBeUndefined(); // 110 < 120: soft zone, still accepted
  });

  it("refuses billing to non-admins", async () => {
    const memberId = `user-member-${suffix}`;
    await db()`insert into "user" (id,name,email,email_verified) values (${memberId},'Member',${`${memberId}@test.invalid`},true)`;
    await db()`insert into account (id,account_id,provider_id,user_id,password) values (${randomUUID()},${memberId},'credential',${memberId},${await hashPassword(password)})`;
    await db()`insert into member (id,organization_id,user_id,role) values (${randomUUID()},${org},${memberId},'member')`;
    const other = new Map<string, string>();
    const signed = await request("/api/auth/sign-in/email", {
      method: "POST",
      cookies: other,
      body: { email: `${memberId}@test.invalid`, password },
    });
    take(signed, other);
    await db()`update session set active_organization_id=${org} where user_id=${memberId}`;
    const statuses = [
      (await request("/api/billing", { cookies: other })).status,
      (
        await request("/api/billing/checkout", {
          method: "POST",
          cookies: other,
          body: { interval: "monthly" },
        })
      ).status,
      (await request("/api/billing/portal", { method: "POST", cookies: other, body: {} })).status,
    ];
    expect(statuses).toEqual([403, 403, 403]);
  });
});
