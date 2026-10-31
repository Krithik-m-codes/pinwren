import type * as BossModule from "./jobs/boss";
import type * as ApiModule from "./index";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from "vitest";
import { getRuntimeDb } from "../../db/src/connection";
import { closeIdentityDatabase } from "../../db/src/identity";
import { createCloudFixture } from "./test-helpers/cloud-fixture";

/**
 * Cloud sign-up against real PostgreSQL with the production-like runtime and service roles (design
 * 2026-10-31): the kill switch, consent, abuse caps, email verification, and the Free personal workspace
 * created with the account, then proof the new account reaches only its own workspace.
 */
const effects = vi.hoisted(() => ({ enqueue: vi.fn<(queue: string, payload: unknown) => Promise<void>>() }));
vi.mock("./jobs/boss", async (original) => ({
  ...(await original<typeof BossModule>()),
  enqueue: effects.enqueue,
}));

describe.skipIf(!process.env.PINWREN_ISOLATION_ADMIN_URL)("Cloud sign-up", () => {
  let fixture: Awaited<ReturnType<typeof createCloudFixture>> | undefined;
  let api: typeof ApiModule.app;
  let resetEnv: () => void;
  const password = randomUUID();
  const run = randomUUID().slice(0, 8);
  const fx = () => {
    if (!fixture) throw new Error("fixture not ready");
    return fixture;
  };
  const setSignups = (mode: "open" | "closed", extra: Record<string, string> = {}) => {
    vi.stubEnv("PINWREN_CLOUD_SIGNUPS", mode);
    for (const [k, v] of Object.entries(extra)) vi.stubEnv(k, v);
    resetEnv();
  };
  const request = (path: string, body?: unknown, cookie?: string, ip = "198.51.100.1") =>
    api.request(`http://localhost:3100${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        origin: "http://localhost:3100",
        "content-type": "application/json",
        "x-forwarded-for": ip,
        ...(cookie ? { cookie } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const signUp = (email: string, extra: Record<string, unknown> = {}, ip?: string) =>
    request(
      "/api/auth/sign-up/email",
      { name: "Ada Lovelace", email, password, termsAccepted: true, callbackURL: "/onboarding", ...extra },
      undefined,
      ip,
    );
  const cookiesOf = (response: Response) =>
    response.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
  const count = async (email: string) => (await fx().db`select 1 from "user" where email=${email}`).length;

  beforeAll(async () => {
    fixture = await createCloudFixture();
    vi.stubEnv("PINWREN_MODE", "cloud");
    vi.stubEnv("DATABASE_URL", fixture.runtimeUrl);
    vi.stubEnv("PINWREN_SERVICE_DATABASE_URL", fixture.serviceUrl);
    vi.stubEnv("PINWREN_URL", "http://localhost:3100");
    vi.stubEnv("PINWREN_SECRET", randomUUID() + randomUUID());
    vi.stubEnv("PINWREN_TRUST_PROXY", "1");
    vi.stubEnv("SMTP_HOST", "smtp.invalid");
    vi.stubEnv("EMAIL_FROM", "Pinwren <no-reply@example.invalid>");
    api = (await import("./index")).app;
    resetEnv = (await import("./env")).resetEnvForTests;
  }, 120_000);
  afterAll(async () => {
    if (fixture) {
      await closeIdentityDatabase();
      await getRuntimeDb().$client.end();
      await fixture.dispose();
    }
    vi.unstubAllEnvs();
  });
  beforeEach(() => {
    effects.enqueue.mockReset();
    effects.enqueue.mockResolvedValue(undefined);
    setSignups("closed", { PINWREN_CLOUD_SIGNUPS_PER_IP_HOUR: "50", PINWREN_CLOUD_SIGNUPS_PER_HOUR: "500" });
  });

  it("is closed by default; the public setup answer says so and carries the legal links", async () => {
    const body = (await (await request("/api/setup")).json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      needed: false,
      signupOpen: false,
      cloud: {
        termsUrl: expect.stringContaining("/legal/terms") as unknown,
        privacyUrl: expect.stringContaining("/legal/privacy") as unknown,
      },
    });
    const refused = await signUp(`closed-${run}@example.com`);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: "SIGNUP_CLOSED" });
    expect(await count(`closed-${run}@example.com`)).toBe(0);
  });

  it("reports open sign-up when an operator opens it", async () => {
    setSignups("open");
    expect(await (await request("/api/setup")).json()).toMatchObject({ signupOpen: true });
  });

  it("refuses sign-up without consent or with a disposable address, creating nothing", async () => {
    setSignups("open");
    const noConsent = await signUp(`noterms-${run}@example.com`, { termsAccepted: false });
    expect(noConsent.status).toBe(400);
    expect(await noConsent.json()).toMatchObject({ code: "TERMS_REQUIRED" });
    const burner = await signUp(`burner-${run}@mailinator.com`);
    expect(burner.status).toBe(400);
    expect(await burner.json()).toMatchObject({ code: "DISPOSABLE_EMAIL" });
    expect(await count(`noterms-${run}@example.com`)).toBe(0);
    expect(await count(`burner-${run}@mailinator.com`)).toBe(0);
  });

  it("creates the account, a Free owner workspace and the consent record; nothing works until verified", async () => {
    setSignups("open");
    const email = `ada-${run}@example.com`;
    const created = await signUp(email);
    expect(created.status).toBe(200);
    expect(cookiesOf(created)).not.toContain("session_token");

    const [account] = await fx().db`select id, email_verified from "user" where email=${email}`;
    expect(account?.email_verified).toBe(false);
    const memberships = await fx().db`
      select m.role, o.name from member m join organization o on o.id=m.organization_id where m.user_id=${account?.id as string}`;
    expect(memberships).toEqual([{ role: "owner", name: "Ada Lovelace's workspace" }]);
    // Free is the absence of a subscription row.
    expect(
      await fx()
        .db`select 1 from billing_subscription b join member m on m.organization_id=b.org_id where m.user_id=${account?.id as string}`,
    ).toHaveLength(0);
    const [consent] = await fx()
      .db`select value from setting where key=${`consent.${account?.id as string}`}`;
    expect(consent?.value).toMatchObject({
      termsUrl: expect.any(String) as unknown,
      privacyUrl: expect.any(String) as unknown,
    });

    // Unverified: no sign-in, and the verification mail went through the mailer queue.
    const early = await request("/api/auth/sign-in/email", { email, password });
    expect(early.status).toBe(403);
    const mails = effects.enqueue.mock.calls.map(([, payload]) => JSON.stringify(payload));
    const link = /http:\/\/localhost:3100\/api\/auth\/verify-email\?token=[^"\s\\<]+/.exec(
      mails.join(" "),
    )?.[0];
    expect(link).toBeTruthy();

    // Confirming signs the person in, inside their workspace, and the dashboard API answers.
    const verified = await request((link ?? "").replace("http://localhost:3100", ""));
    expect([200, 302]).toContain(verified.status);
    const cookie = cookiesOf(verified);
    expect(cookie).toContain("session_token");
    const projects = await request("/api/projects", undefined, cookie);
    expect(projects.status).toBe(200);
    const [session] = await fx()
      .db`select active_organization_id from session where user_id=${account?.id as string}`;
    expect(session?.active_organization_id).toBeTruthy();
  });

  it("limits sign-ups per client address and across the instance, creating no account past a cap", async () => {
    setSignups("open", { PINWREN_CLOUD_SIGNUPS_PER_IP_HOUR: "2" });
    const ip = `192.0.2.${Math.floor(Math.random() * 200) + 1}`;
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) statuses.push((await signUp(`ip${i}-${run}@example.com`, {}, ip)).status);
    expect(statuses).toEqual([200, 200, 429]);
    expect(await count(`ip2-${run}@example.com`)).toBe(0);
    // A different address is fine until the instance-wide cap trips.
    setSignups("open", { PINWREN_CLOUD_SIGNUPS_PER_IP_HOUR: "50", PINWREN_CLOUD_SIGNUPS_PER_HOUR: "1" });
    const over = await signUp(`all-${run}@example.com`, {}, "192.0.2.250");
    expect(over.status).toBe(429);
    expect(await count(`all-${run}@example.com`)).toBe(0);
  });

  it("never creates an account from an email link or social sign-in", async () => {
    setSignups("open");
    const response = await request("/api/auth/sign-in/magic-link", { email: `link-${run}@example.com` });
    expect(response.status).toBeLessThan(500);
    expect(await count(`link-${run}@example.com`)).toBe(0);
  });

  it("lets an invited address sign up while sign-ups are closed", async () => {
    const [owner] = await fx().db`select id from "user" where email=${`ada-${run}@example.com`}`;
    const [org] = await fx().db`select organization_id from member where user_id=${owner?.id as string}`;
    await fx()
      .db`insert into invitation (id,organization_id,email,expires_at,inviter_id,status,role) values (${randomUUID()},${org?.organization_id as string},${`friend-${run}@example.com`},now()+interval '1 day',${owner?.id as string},'pending','member')`;
    const created = await signUp(`friend-${run}@example.com`, {}, "192.0.2.99");
    expect(created.status).toBe(200);
  });

  it("rolls back the whole sign-up when the workspace cannot be created", async () => {
    setSignups("open");
    const email = `broken-${run}@example.com`;
    const role = new URL(fx().serviceUrl).username;
    await fx().db.unsafe(`revoke insert on organization from "${role}"`);
    try {
      const response = await signUp(email, {}, "192.0.2.77");
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(await count(email)).toBe(0);
    } finally {
      await fx().db.unsafe(`grant insert on organization to "${role}"`);
    }
  });
});
