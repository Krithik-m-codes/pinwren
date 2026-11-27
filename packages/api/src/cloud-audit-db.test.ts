import type * as ApiModule from "./index";
import type * as BossModule from "./jobs/boss";
import type * as BusModule from "./realtime/bus";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getRuntimeDb } from "../../db/src/connection";
import { closeIdentityDatabase } from "../../db/src/identity";
import { createCloudFixture } from "./test-helpers/cloud-fixture";

/**
 * Audit log end to end on the Cloud stack (WP-24, ADR 0044): entitlement gating, role checks, recording the
 * admin actions, tenant isolation, filters and paging, the exports, append-only grants and 30-day retention.
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

// Excel needs a byte-order mark to open UTF-8 CSV.
const BOM = String.fromCharCode(0xfeff);
type Json = Record<string, unknown>;
type Jar = Map<string, string>;

describe.skipIf(!process.env.PINWREN_ISOLATION_ADMIN_URL)("Cloud audit log", () => {
  let fixture: Awaited<ReturnType<typeof createCloudFixture>> | undefined;
  let api: typeof ApiModule.app;
  const suffix = randomUUID();
  const password = randomUUID();
  // Business workspaces A and B, and a Free workspace F.
  const orgA = `audit-a-${suffix}`,
    orgB = `audit-b-${suffix}`,
    orgF = `audit-f-${suffix}`;
  const users = {
    ownerA: `owner-a-${suffix}`,
    editorA: `editor-a-${suffix}`,
    viewerA: `viewer-a-${suffix}`,
    ownerB: `owner-b-${suffix}`,
    ownerF: `owner-f-${suffix}`,
  };
  const jars: Record<keyof typeof users, Jar> = {
    ownerA: new Map(),
    editorA: new Map(),
    viewerA: new Map(),
    ownerB: new Map(),
    ownerF: new Map(),
  };
  const db = () => {
    if (!fixture) throw new Error("fixture not ready");
    return fixture.db;
  };

  const take = (response: Response, into: Jar) => {
    for (const cookie of response.headers.getSetCookie()) {
      const part = cookie.split(";")[0] ?? "";
      const eq = part.indexOf("=");
      if (eq > 0 && part.slice(eq + 1)) into.set(part.slice(0, eq), part.slice(eq + 1));
    }
  };
  const request = (as: keyof typeof users, path: string, init: { method?: string; body?: unknown } = {}) => {
    const headers = new Headers({ origin: "http://localhost:3100", "content-type": "application/json" });
    const jar = jars[as];
    if (jar.size) headers.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
    return api.request(`http://localhost:3100${path}`, {
      method: init.method ?? "GET",
      headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  };
  const list = async (as: keyof typeof users, query = "") =>
    (await (await request(as, `/api/audit${query}`)).json()) as {
      items: { action: string; actorLabel: string; targetType: string | null; data: Json }[];
      nextCursor: string | null;
    };
  const makeToken = (as: keyof typeof users, name: string) =>
    request(as, "/api/tokens", { method: "POST", body: { name, scopes: ["feedback:read"] } });

  beforeAll(async () => {
    fixture = await createCloudFixture();
    vi.stubEnv("PINWREN_MODE", "cloud");
    vi.stubEnv("DATABASE_URL", fixture.runtimeUrl);
    vi.stubEnv("PINWREN_SERVICE_DATABASE_URL", fixture.serviceUrl);
    vi.stubEnv("PINWREN_URL", "http://localhost:3100");
    vi.stubEnv("PINWREN_SECRET", randomUUID() + randomUUID());
    vi.stubEnv("PINWREN_DISABLE_SIGNUP", "false");
    vi.stubEnv("PINWREN_ADMIN_EMAILS", undefined);
    // Billing configured: plans decide entitlements (a Business subscription carries `audit_log`).
    vi.stubEnv("DODO_PAYMENTS_API_KEY", "fixture-key-not-a-secret");
    vi.stubEnv(
      "DODO_PAYMENTS_WEBHOOK_KEY",
      `whsec_${Buffer.from("audit-db-webhook-key-0123456789").toString("base64")}`,
    );
    const d = fixture.db;
    const hash = await hashPassword(password);
    for (const org of [orgA, orgB, orgF])
      await d`insert into organization (id,name,slug) values (${org},${org},${org})`;
    for (const org of [orgA, orgB])
      await d`insert into billing_subscription (org_id,plan,status,interval) values (${org},'business','active','monthly')`;
    const seats: [keyof typeof users, string, string][] = [
      ["ownerA", orgA, "owner"],
      ["editorA", orgA, "member"],
      ["viewerA", orgA, "viewer"],
      ["ownerB", orgB, "owner"],
      ["ownerF", orgF, "owner"],
    ];
    for (const [key, org, role] of seats) {
      const id = users[key];
      await d`insert into "user" (id,name,email,email_verified) values (${id},${key},${`${id}@test.invalid`},true)`;
      await d`insert into account (id,account_id,provider_id,user_id,password) values (${randomUUID()},${id},'credential',${id},${hash})`;
      await d`insert into member (id,organization_id,user_id,role) values (${randomUUID()},${org},${id},${role})`;
    }
    api = (await import("./index")).app;
    for (const [key, org] of seats) {
      const signed = await request(key, "/api/auth/sign-in/email", {
        method: "POST",
        body: { email: `${users[key]}@test.invalid`, password },
      });
      expect(signed.status).toBe(200);
      take(signed, jars[key]);
      const active = await request(key, "/api/auth/organization/set-active", {
        method: "POST",
        body: { organizationId: org },
      });
      expect(active.status).toBe(200);
      take(active, jars[key]);
    }
  }, 180_000);
  beforeEach(() => {
    effects.enqueue.mockReset().mockResolvedValue(undefined);
    effects.publish.mockReset().mockResolvedValue(undefined);
  });
  afterAll(async () => {
    if (fixture) {
      await closeIdentityDatabase();
      await getRuntimeDb().$client.end();
      await fixture.dispose();
    }
    vi.unstubAllEnvs();
  });

  it("refuses a Free workspace and records nothing while not entitled", async () => {
    const response = await request("ownerF", "/api/audit");
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "LICENSE_REQUIRED" });
    expect((await request("ownerF", "/api/audit/export")).status).toBe(403);
    expect((await makeToken("ownerF", "while free")).status).toBe(201);
    expect(await db()`select id from audit_log where org_id=${orgF}`).toHaveLength(0);
  });

  it("refuses editors and viewers, allows the owner", async () => {
    for (const who of ["editorA", "viewerA"] as const) {
      const response = await request(who, "/api/audit");
      expect(response.status, who).toBe(403);
      expect(await response.json()).toMatchObject({ code: "FORBIDDEN_ROLE" });
      expect((await request(who, "/api/audit/export")).status, who).toBe(403);
    }
    expect((await request("ownerA", "/api/audit")).status).toBe(200);
  });

  it("records an admin action with the actor snapshot, target and no secret", async () => {
    const created = await makeToken("ownerA", "ci deploy");
    expect(created.status).toBe(201);
    const { secret } = (await created.json()) as { secret: string };
    const { items } = await list("ownerA");
    expect(items[0]).toMatchObject({
      action: "api_token.created",
      targetType: "api_token",
      data: { name: "ci deploy", scopes: ["feedback:read"] },
    });
    expect(items[0]?.actorLabel).toContain(`${users.ownerA}@test.invalid`);
    const [row] = await db()`select * from audit_log where org_id=${orgA} order by created_at desc limit 1`;
    expect(JSON.stringify(row)).not.toContain(secret);
    expect(row?.actor_id).toBe(users.ownerA);
  });

  it("does not record an action whose request fails", async () => {
    const before = (await list("ownerA")).items.length;
    const refused = await request("ownerA", "/api/members/does-not-exist", { method: "DELETE" });
    expect(refused.status).toBe(404);
    expect((await list("ownerA")).items).toHaveLength(before);
  });

  it("keeps each workspace's history to itself", async () => {
    expect((await makeToken("ownerB", "b only")).status).toBe(201);
    const a = await list("ownerA");
    const b = await list("ownerB");
    expect(JSON.stringify(a)).not.toContain("b only");
    expect(JSON.stringify(b)).not.toContain("ci deploy");
    expect(b.items.length).toBeGreaterThan(0);
    const rows = await db()`select distinct org_id from audit_log`;
    expect(rows.map((r) => r.org_id as string).sort()).toEqual([orgA, orgB].sort());
  });

  it("filters by action prefix, actor, target type and date, and pages with a cursor", async () => {
    for (const name of ["one", "two", "three"]) expect((await makeToken("ownerA", name)).status).toBe(201);
    expect((await request("ownerA", "/api/tokens")).status).toBe(200);
    expect(
      (await list("ownerA", "?action=api_token")).items.every((i) => i.action.startsWith("api_token")),
    ).toBe(true);
    expect((await list("ownerA", "?action=member.")).items).toHaveLength(0);
    expect((await list("ownerA", `?actor=${users.ownerA}`)).items.length).toBeGreaterThan(0);
    expect((await list("ownerA", "?actor=nobody-here")).items).toHaveLength(0);
    expect((await list("ownerA", "?targetType=api_token")).items.length).toBeGreaterThan(0);
    const future = encodeURIComponent(new Date(Date.now() + 86_400_000).toISOString());
    expect((await list("ownerA", `?from=${future}`)).items).toHaveLength(0);
    const first = await list("ownerA", "?limit=2");
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await list("ownerA", `?limit=2&cursor=${encodeURIComponent(first.nextCursor ?? "")}`);
    expect(second.items.length).toBeGreaterThan(0);
    const seen = new Set([...first.items, ...second.items].map((i) => JSON.stringify(i)));
    expect(seen.size).toBe(first.items.length + second.items.length);
    expect((await request("ownerA", "/api/audit?cursor=garbage")).status).toBe(400);
  });

  it("exports CSV and JSON lines, neutralising spreadsheet formulas", async () => {
    expect((await makeToken("ownerA", '=HYPERLINK("http://evil.test")')).status).toBe(201);
    const csv = await request("ownerA", "/api/audit/export?format=csv");
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-type")).toContain("text/csv");
    expect(csv.headers.get("content-disposition")).toContain("attachment");
    const text = await csv.text();
    expect(text.startsWith(BOM + "time,actor")).toBe(true);
    expect(text).not.toMatch(/(^|,)=HYPERLINK/);
    expect(text).not.toContain("b only");
    const jsonl = await request("ownerA", "/api/audit/export?format=jsonl");
    const lines = (await jsonl.text()).trim().split("\n");
    expect(lines.length).toBeGreaterThan(1);
    expect(JSON.parse(lines[0] ?? "")).toHaveProperty("action");
    expect((await list("ownerA", "?action=audit.exported")).items.length).toBeGreaterThan(0);
  });

  it("is append-only for the runtime role: no UPDATE, and no access across workspaces", async () => {
    const runtime = postgres(fixture?.runtimeUrl ?? "", { max: 1, onnotice: () => undefined });
    try {
      await expect(
        runtime.begin(async (tx) => {
          await tx`select set_config('pinwren.org_id', ${orgA}, true)`;
          await tx`update audit_log set action='forged' where org_id=${orgA}`;
        }),
      ).rejects.toMatchObject({ code: "42501" });
      const seen = await runtime.begin(async (tx) => {
        await tx`select set_config('pinwren.org_id', ${orgA}, true)`;
        return tx`select org_id from audit_log`;
      });
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every((r) => r.org_id === orgA)).toBe(true);
    } finally {
      await runtime.end();
    }
  });

  it("prunes entries older than 30 days in Cloud and keeps recent ones", async () => {
    const old = randomUUID();
    for (const org of [orgA, orgB])
      await db()`insert into audit_log (org_id,actor_label,action,created_at) values (${org},${old},'member.removed',now() - interval '40 days')`;
    const { applyRetention } = await import("./jobs/maintenance");
    await applyRetention();
    expect(await db()`select id from audit_log where actor_label=${old}`).toHaveLength(0);
    expect((await list("ownerA")).items.length).toBeGreaterThan(0);
  });

  it("hides history after a downgrade and records nothing, then shows it again on upgrade", async () => {
    await db()`update billing_subscription set plan='free', status='none' where org_id=${orgA}`;
    const [{ n: before } = { n: 0 }] = await db()`select count(*)::int n from audit_log where org_id=${orgA}`;
    expect((await request("ownerA", "/api/audit")).status).toBe(403);
    expect((await makeToken("ownerA", "while downgraded")).status).toBe(201);
    const [{ n: after } = { n: 0 }] = await db()`select count(*)::int n from audit_log where org_id=${orgA}`;
    expect(after).toBe(before);
    await db()`update billing_subscription set plan='business', status='active' where org_id=${orgA}`;
    const { items } = await list("ownerA", "?limit=200");
    expect(items.length).toBe(before);
    expect(JSON.stringify(items)).not.toContain("while downgraded");
  });
});
