import type * as ApiModule from "./index";
import type * as BossModule from "./jobs/boss";
import type * as BusModule from "./realtime/bus";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getRuntimeDb } from "../../db/src/connection";
import { closeIdentityDatabase } from "../../db/src/identity";
import { createCloudFixture } from "./test-helpers/cloud-fixture";

/**
 * Custom fields and the form builder (ADR 0032) against a real database with row security: saving the form,
 * the widget's config and submission checks, editing answers, the inbox filter, exports (with privacy mode),
 * deleting a field with its answers, and tenant isolation.
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

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- the cases read parsed JSON responses and SQL rows */
type Json = Record<string, any>;

describe.skipIf(!process.env.PINWREN_ISOLATION_ADMIN_URL)("Custom fields", () => {
  let fixture: Awaited<ReturnType<typeof createCloudFixture>> | undefined;
  let api: typeof ApiModule.app;
  const suffix = randomUUID();
  const orgA = `cf-a-${suffix}`;
  const orgB = `cf-b-${suffix}`;
  const owner = `owner-${suffix}`;
  const outsider = `outsider-${suffix}`;
  const password = randomUUID();
  const jar = new Map<string, string>();
  const ids = { projectA: randomUUID(), projectB: randomUUID() };
  const origin = "https://customer.test";
  const db = () => {
    if (!fixture) throw new Error("fixture not ready");
    return fixture.db;
  };

  const request = (path: string, init: { method?: string; body?: unknown } = {}) => {
    const headers = new Headers({ origin: "http://localhost:3100", "content-type": "application/json" });
    if (jar.size) headers.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
    return api.request(`http://localhost:3100${path}`, {
      method: init.method ?? "GET",
      headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  };
  const widget = (path: string, init: { method?: string; body?: unknown } = {}) => {
    const body = init.body === undefined ? undefined : JSON.stringify(init.body);
    return api.request(`http://localhost:3100/w${path}`, {
      method: init.method ?? "GET",
      headers: {
        origin,
        "x-pinwren-key": ids.projectA,
        "content-type": "application/json",
        ...(body === undefined ? {} : { "content-length": String(Buffer.byteLength(body)) }),
      },
      ...(body === undefined ? {} : { body }),
    });
  };
  const take = (response: Response) => {
    for (const cookie of response.headers.getSetCookie()) {
      const part = cookie.split(";")[0] ?? "";
      const eq = part.indexOf("=");
      if (eq > 0 && part.slice(eq + 1)) jar.set(part.slice(0, eq), part.slice(eq + 1));
    }
  };
  const json = async (response: Response) => (await response.json()) as Json;
  const save = (fields: Json[], project = ids.projectA) =>
    request(`/api/projects/${project}/custom-fields`, { method: "PUT", body: { fields } });

  const report = (customFields?: Json, kind = "bug") => ({
    clientId: randomUUID(),
    kind,
    body: "The button does nothing",
    page: { url: "https://customer.test/checkout" },
    environment: { userAgent: "Mozilla/5.0 Chrome/120", viewport: { w: 1280, h: 800 }, dpr: 1 },
    ...(customFields ? { customFields } : {}),
  });

  const FORM: Json[] = [
    { key: "order", type: "text", label: "Order number", required: true, validation: { maxLength: 12 } },
    {
      key: "plan",
      type: "select",
      label: "Plan",
      options: [
        { value: "free", label: "Free" },
        { value: "pro", label: "Pro" },
      ],
      defaultValue: "free",
    },
    { key: "contact", type: "email", label: "Contact", pii: true },
    { key: "triage_note", type: "textarea", label: "Triage note", audience: "internal" },
    { key: "idea_only", type: "text", label: "Idea only", kinds: ["idea"] },
  ];

  beforeAll(async () => {
    fixture = await createCloudFixture();
    vi.stubEnv("PINWREN_MODE", "cloud");
    vi.stubEnv("DATABASE_URL", fixture.runtimeUrl);
    vi.stubEnv("PINWREN_SERVICE_DATABASE_URL", fixture.serviceUrl);
    vi.stubEnv("PINWREN_URL", "http://localhost:3100");
    vi.stubEnv("PINWREN_SECRET", randomUUID() + randomUUID());
    vi.stubEnv("PINWREN_DISABLE_SIGNUP", "false");
    const d = fixture.db;
    const hashed = await hashPassword(password);
    for (const org of [orgA, orgB])
      await d`insert into organization (id,name,slug) values (${org},${org},${org})`;
    for (const [user, org] of [
      [owner, orgA],
      [outsider, orgB],
    ] as const) {
      await d`insert into "user" (id,name,email,email_verified) values (${user},${user},${`${user}@test.invalid`},true)`;
      await d`insert into account (id,account_id,provider_id,user_id,password) values (${randomUUID()},${user},'credential',${user},${hashed})`;
      await d`insert into member (id,organization_id,user_id,role) values (${randomUUID()},${org},${user},'owner')`;
    }
    for (const [org, project] of [
      [orgA, ids.projectA],
      [orgB, ids.projectB],
    ] as const)
      await d`insert into project (id,org_id,name,slug,public_key,allowed_origins,identity_secret,action_secret,widget_rate_limit_per_min) values (${project},${org},'P',${org},${project},${d.array([origin])},${randomUUID()},${randomUUID()},1000)`;
    api = (await import("./index")).app;
    const signed = await request("/api/auth/sign-in/email", {
      method: "POST",
      body: { email: `${owner}@test.invalid`, password },
    });
    expect(signed.status).toBe(200);
    take(signed);
    take(
      await request("/api/auth/organization/set-active", {
        method: "POST",
        body: { organizationId: orgA },
      }),
    );
  }, 120_000);
  afterAll(async () => {
    if (fixture) {
      await closeIdentityDatabase();
      await getRuntimeDb().$client.end();
      await fixture.dispose();
    }
    vi.unstubAllEnvs();
  });

  it("saves the whole form in order, and rejects bad definitions", async () => {
    expect((await save([])).status).toBe(200);
    expect((await save([{ key: "Bad Key", type: "text", label: "x" }])).status).toBe(400);
    expect((await save([{ key: "a", type: "select", label: "No options" }])).status).toBe(400);
    expect((await save([...FORM.slice(0, 1), ...FORM.slice(0, 1)])).status).toBe(400);
    const many = Array.from({ length: 21 }, (_, i) => ({ key: `f${i}`, type: "text", label: "x" }));
    expect((await save(many)).status).toBe(400);

    const ok = await save(FORM);
    expect(ok.status).toBe(200);
    const fields = (await json(ok)).fields as Json[];
    expect(fields.map((f) => f.key)).toEqual(["order", "plan", "contact", "triage_note", "idea_only"]);
    expect(fields.map((f) => f.position)).toEqual([0, 1, 2, 3, 4]);
    const again = await json(await request(`/api/projects/${ids.projectA}/custom-fields`));
    expect(again.fields).toEqual(fields);
    // Reordering is just another save.
    const swapped = await json(await save([...FORM.slice(1, 2), ...FORM.slice(0, 1), ...FORM.slice(2)]));
    expect(swapped.fields.map((f: Json) => f.key).slice(0, 2)).toEqual(["plan", "order"]);
    await save(FORM);
  });

  it("is invisible to another workspace", async () => {
    expect((await request(`/api/projects/${ids.projectB}/custom-fields`)).status).toBe(404);
    expect((await save(FORM, ids.projectB)).status).toBe(404);
    expect(await db()`select 1 from custom_field where project_id = ${ids.projectB}`).toHaveLength(0);
  });

  it("gives the widget the reporter's fields only, without internal flags", async () => {
    const config = await json(await widget("/config"));
    const fields = config.widget.customFields as Json[];
    expect(fields.map((f) => f.key)).toEqual(["order", "plan", "contact", "idea_only"]);
    for (const f of fields) {
      expect(f).not.toHaveProperty("audience");
      expect(f).not.toHaveProperty("pii");
    }
    expect(JSON.stringify(config)).not.toContain("Triage note");
  });

  it("validates answers on the server, whatever the widget did", async () => {
    const missing = await widget("/feedback", { method: "POST", body: report({ plan: "pro" }) });
    expect(missing.status).toBe(400);
    expect((await json(missing)).title).toContain("Order number is required");
    expect(
      (await widget("/feedback", { method: "POST", body: report({ order: "x".repeat(13) }) })).status,
    ).toBe(400);
    expect(
      (await widget("/feedback", { method: "POST", body: report({ order: "A-1", plan: "platinum" }) }))
        .status,
    ).toBe(400);
    expect(
      (await widget("/feedback", { method: "POST", body: report({ order: "A-1", contact: "nope" }) })).status,
    ).toBe(400);
    const tooBig = await widget("/feedback", {
      method: "POST",
      body: report({ order: "A-1", filler: "x".repeat(70_000) }),
    });
    expect(tooBig.status).toBe(400);

    const body = report({
      order: " A-1 ",
      contact: "dana@example.com",
      triage_note: "reporter tries to write the internal note",
      idea_only: "wrong type of report",
      ghost: "unknown",
    });
    const sent = await widget("/feedback", { method: "POST", body });
    expect(sent.status).toBe(201);
    const id = (await json(sent)).feedback.id as string;
    const [row] = await db()`select custom_fields from feedback where id = ${id}`;
    // Trimmed, defaulted, and nothing from internal, other-kind or unknown fields.
    expect(row?.custom_fields).toEqual({ order: "A-1", plan: "free", contact: "dana@example.com" });
    // The retry of the same report is answered with the stored record.
    expect((await widget("/feedback", { method: "POST", body })).status).toBe(200);
  });

  it("lets the team edit answers (internal ones too), with a timeline entry", async () => {
    const created = await json(
      await widget("/feedback", { method: "POST", body: report({ order: "B-2", plan: "pro" }) }),
    );
    const id = created.feedback.id as string;
    const patch = (customFields: Json) =>
      request(`/api/feedback/${id}`, { method: "PATCH", body: { customFields } });

    expect((await patch({ ghost: "x" })).status).toBe(400);
    expect((await patch({ plan: "platinum" })).status).toBe(400);
    expect((await patch({ order: null })).status).toBe(400); // required
    expect((await patch({ idea_only: "x" })).status).toBe(400); // belongs to ideas
    expect((await patch({ triage_note: "Looks like a duplicate of #4", plan: "free" })).status).toBe(200);

    const detail = await json(await request(`/api/feedback/${id}`));
    expect(detail.feedback.customFields).toEqual({
      order: "B-2",
      plan: "free",
      triage_note: "Looks like a duplicate of #4",
    });
    const entries = (detail.activity as Json[]).filter((a) => a.type === "customField_changed");
    expect(entries.map((a) => a.data.key).sort()).toEqual(["plan", "triage_note"]);
    expect(entries.find((a) => a.data.key === "plan")?.data).toMatchObject({
      label: "Plan",
      fromText: "Pro",
      toText: "Free",
    });
    // Clearing an optional answer removes it.
    expect((await patch({ triage_note: null })).status).toBe(200);
    const [row] = await db()`select custom_fields from feedback where id = ${id}`;
    expect(row?.custom_fields).toEqual({ order: "B-2", plan: "free" });
    // Unchanged answers log nothing.
    const count = async () =>
      (await db()`select count(*)::int as n from activity where feedback_id = ${id}`)[0]?.n;
    const before = await count();
    expect((await patch({ plan: "free" })).status).toBe(200);
    expect(await count()).toBe(before);
  });

  it("filters the inbox by a field and puts the answers in exports, masking PII in privacy mode", async () => {
    const mk = async (answers: Json) =>
      (await json(await widget("/feedback", { method: "POST", body: report(answers) }))).feedback
        .id as string;
    const pro = await mk({ order: "F-1", plan: "pro", contact: "pro@example.com" });
    const free = await mk({ order: "F-2", plan: "free" });
    const list = async (cf: string) =>
      (
        (
          await json(
            await request(`/api/feedback?projectId=${ids.projectA}&status=all&cf=${encodeURIComponent(cf)}`),
          )
        ).items as Json[]
      ).map((i) => i.id);

    expect(await list("plan:pro")).toContain(pro);
    expect(await list("plan:pro")).not.toContain(free);
    expect(await list("contact:*")).toContain(pro);
    expect(await list("contact:*")).not.toContain(free);
    expect(await list("contact:!")).toContain(free);
    expect(await list("contact:!")).not.toContain(pro);
    expect(await list("order:F-2")).toEqual([free]); // text: substring
    expect(await list("nokey:x")).toEqual([]);
    expect(await list("plan:%")).toEqual([]); // LIKE characters are literal, and plan is a choice

    const exported = await json(
      await request(`/api/feedback/export?projectId=${ids.projectA}&status=all&format=json&cf=contact:*`),
    );
    expect((exported.items as Json[]).find((i) => i.id === pro)?.customFields).toMatchObject({
      order: "F-1",
      plan: "pro",
      contact: "pro@example.com",
    });
    const csv = await (
      await request(`/api/feedback/export?projectId=${ids.projectA}&status=all&format=csv`)
    ).text();
    expect(csv.split("\r\n")[0]).toContain("Order number,Plan,Contact,Triage note");
    expect(csv).toContain("F-1");

    await db()`update project set widget_config = ${db().json({ privacyMode: true })} where id = ${ids.projectA}`;
    try {
      const masked = await json(
        await request(`/api/feedback/export?projectId=${ids.projectA}&status=all&format=json&cf=contact:*`),
      );
      expect((masked.items as Json[]).find((i) => i.id === pro)?.customFields).toMatchObject({
        plan: "pro",
        contact: "[redacted]",
      });
      expect(JSON.stringify(masked)).not.toContain("pro@example.com");
    } finally {
      await db()`update project set widget_config = '{}'::jsonb where id = ${ids.projectA}`;
    }
  });

  it("deletes a field's answers with the field, and a retyped field's too", async () => {
    const made = await json(
      await widget("/feedback", {
        method: "POST",
        body: report({ order: "D-1", plan: "pro", contact: "d@example.com" }),
      }),
    );
    expect(made.feedback, JSON.stringify(made)).toBeTruthy();
    const id = made.feedback.id as string;
    const answers = async () =>
      ((await db()`select custom_fields from feedback where id = ${id}`)[0] as Json).custom_fields;
    // Text <-> long text keeps answers; a new type does not; a removed key is gone everywhere.
    const next = FORM.filter((f) => f.key !== "contact").map((f) =>
      f.key === "order"
        ? { ...f, type: "textarea", validation: {} }
        : f.key === "plan"
          ? { ...f, type: "text", options: [] }
          : f,
    );
    expect((await save(next)).status).toBe(200);
    expect(await answers()).toEqual({ order: "D-1" });
    expect(
      await db()`select 1 from custom_field where project_id = ${ids.projectA} and key = 'contact'`,
    ).toHaveLength(0);
    await save(FORM);
  });

  it("checks automation conditions against the project's fields", async () => {
    const rule = (condition: Json) =>
      request(`/api/projects/${ids.projectA}/automations`, {
        method: "POST",
        body: {
          name: "Pro first",
          trigger: { event: "feedback_created" },
          conditions: [condition],
          actions: [{ type: "set_priority", priority: "high" }],
        },
      });
    expect((await rule({ field: "customField", key: "ghost", op: "equals", value: "x" })).status).toBe(400);
    expect((await rule({ field: "customField", key: "plan", op: "equals" })).status).toBe(400);
    expect((await rule({ field: "customField", key: "plan", op: "equals", value: "pro" })).status).toBe(201);
    expect((await rule({ field: "customField", key: "plan", op: "is_set" })).status).toBe(201);
  });
});
