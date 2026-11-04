import type * as ApiModule from "./index";
import type * as BossModule from "./jobs/boss";
import type * as BusModule from "./realtime/bus";
import type * as EngineModule from "./services/automation-engine";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getRuntimeDb } from "../../db/src/connection";
import { closeIdentityDatabase } from "../../db/src/identity";
import { createCloudFixture } from "./test-helpers/cloud-fixture";

/**
 * Automation rules and AI label suggestions against a real database with row security (WP-28): the API, the
 * engine (`runAutomations`), loop protection, idempotent retries and tenant isolation of rule references.
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

describe.skipIf(!process.env.PINWREN_ISOLATION_ADMIN_URL)("Automation rules", () => {
  let fixture: Awaited<ReturnType<typeof createCloudFixture>> | undefined;
  let api: typeof ApiModule.app;
  let engine: typeof EngineModule;
  const suffix = randomUUID();
  const orgA = `auto-a-${suffix}`;
  const orgB = `auto-b-${suffix}`;
  const owner = `owner-${suffix}`;
  const second = `second-${suffix}`;
  const outsider = `outsider-${suffix}`;
  const password = randomUUID();
  const jar = new Map<string, string>();
  const ids = {
    projectA: randomUUID(),
    projectB: randomUUID(),
    labelA: randomUUID(),
    labelB: randomUUID(),
  };
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
  const take = (response: Response) => {
    for (const cookie of response.headers.getSetCookie()) {
      const part = cookie.split(";")[0] ?? "";
      const eq = part.indexOf("=");
      if (eq > 0 && part.slice(eq + 1)) jar.set(part.slice(0, eq), part.slice(eq + 1));
    }
  };
  const json = async (response: Response) => (await response.json()) as Json;

  const newItem = async (
    fields: { kind?: string; priority?: string; page?: string; status?: string } = {},
  ) => {
    const id = randomUUID();
    const [counted] =
      await db()`update project set feedback_counter = feedback_counter + 1 where id = ${ids.projectA} returning feedback_counter as n`;
    const n = Number(counted?.n ?? 0);
    let pageId: string | null = null;
    if (fields.page) {
      pageId = randomUUID();
      await db()`insert into page (id,org_id,project_id,url) values (${pageId},${orgA},${ids.projectA},${fields.page})`;
    }
    await db()`insert into feedback (id,org_id,project_id,page_id,number,kind,priority,status,body,client_id) values (${id},${orgA},${ids.projectA},${pageId},${n},${fields.kind ?? "bug"},${fields.priority ?? "none"},${fields.status ?? "open"},'It is broken',${randomUUID()})`;
    return id;
  };
  const createdEvent = (feedbackId: string, id: string = randomUUID(), extra: Json = {}) => ({
    id,
    type: "feedback.created" as const,
    orgId: orgA,
    feedbackId,
    actor: { kind: "guest" as const, id: null },
    at: new Date().toISOString(),
    ...extra,
  });
  const createRule = async (body: Json) => {
    const response = await request(`/api/projects/${ids.projectA}/automations`, { method: "POST", body });
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
    return ((await json(response)).rule as Json).id as string;
  };
  const item = async (id: string) => (await db()`select * from feedback where id = ${id}`)[0] as Json;
  const runsOf = (ruleId: string) =>
    db()`select * from automation_run where rule_id = ${ruleId} order by created_at`;

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
    for (const [user, org, role] of [
      [owner, orgA, "owner"],
      [second, orgA, "member"],
      [outsider, orgB, "owner"],
    ] as const) {
      await d`insert into "user" (id,name,email,email_verified) values (${user},${user},${`${user}@test.invalid`},true)`;
      await d`insert into account (id,account_id,provider_id,user_id,password) values (${randomUUID()},${user},'credential',${user},${hashed})`;
      await d`insert into member (id,organization_id,user_id,role) values (${randomUUID()},${org},${user},${role})`;
    }
    for (const [org, project, label] of [
      [orgA, ids.projectA, ids.labelA],
      [orgB, ids.projectB, ids.labelB],
    ] as const) {
      await d`insert into project (id,org_id,name,slug,public_key,allowed_origins,identity_secret,action_secret) values (${project},${org},'P',${org},${project},${d.array(["https://customer.test"])},${randomUUID()},${randomUUID()})`;
      await d`insert into label (id,org_id,project_id,name,color) values (${label},${org},${project},'Billing','#112233')`;
    }
    api = (await import("./index")).app;
    engine = await import("./services/automation-engine");
    const signed = await request("/api/auth/sign-in/email", {
      method: "POST",
      body: { email: `${owner}@test.invalid`, password },
    });
    expect(signed.status).toBe(200);
    take(signed);
    const active = await request("/api/auth/organization/set-active", {
      method: "POST",
      body: { organizationId: orgA },
    });
    take(active);
  }, 120_000);
  beforeEach(async () => {
    // Each case starts without rules, so counts only reflect the rules it creates.
    await db()`delete from automation_rule where org_id = ${orgA}`;
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

  it("creates, lists, edits and deletes a rule", async () => {
    const id = await createRule({
      name: "Bugs on pricing",
      trigger: { event: "feedback_created" },
      conditions: [
        { field: "kind", values: ["bug"] },
        { field: "pageUrl", pattern: "/pricing*" },
      ],
      actions: [{ type: "set_priority", priority: "high" }],
    });
    const list = await json(await request(`/api/projects/${ids.projectA}/automations`));
    expect(list.rules.map((r: Json) => r.id)).toContain(id);
    const patched = await request(`/api/automations/${id}`, { method: "PATCH", body: { enabled: false } });
    expect(patched.status).toBe(200);
    const after = (await json(patched)).rule;
    expect(after.enabled).toBe(false);
    // A patch changes only what it names: switching a rule off keeps its conditions and actions.
    expect(after.conditions).toHaveLength(2);
    expect(after.actions).toEqual([{ type: "set_priority", priority: "high" }]);
    expect((await request(`/api/automations/${id}`, { method: "DELETE" })).status).toBe(204);
    expect((await request(`/api/automations/${id}`)).status).toBe(404);
  });

  it("refuses a rule that names another workspace's label, member or an unknown action", async () => {
    const body = (action: Json) => ({
      name: "Bad",
      trigger: { event: "feedback_created" },
      actions: [action],
    });
    const post = (b: Json) =>
      request(`/api/projects/${ids.projectA}/automations`, { method: "POST", body: b });
    expect((await post(body({ type: "add_label", labelId: ids.labelB }))).status).toBe(400);
    expect((await post(body({ type: "assign", userIds: [outsider] }))).status).toBe(400);
    expect((await post(body({ type: "set_priority", priority: "loud" }))).status).toBe(400);
    expect((await post({ ...body({ type: "add_label", labelId: ids.labelA }), actions: [] })).status).toBe(
      400,
    );
    // The rule's own project, but a rule of workspace A cannot be filed under workspace B's project.
    const foreign = await request(`/api/projects/${ids.projectB}/automations`, {
      method: "POST",
      body: body({ type: "add_label", labelId: ids.labelB }),
    });
    expect(foreign.status).toBe(404);
  });

  it("applies matching rules to a new item, logs the run and writes the timeline as the rule", async () => {
    const rule = await createRule({
      name: "Pricing bugs",
      trigger: { event: "feedback_created" },
      conditions: [
        { field: "kind", values: ["bug"] },
        { field: "pageUrl", pattern: "/pricing*" },
      ],
      actions: [
        { type: "set_priority", priority: "high" },
        { type: "add_label", labelId: ids.labelA },
        { type: "assign", userIds: [owner, second], mode: "round_robin" },
      ],
    });
    const hit = await newItem({ page: "https://shop.test/pricing/plans" });
    const miss = await newItem({ page: "https://shop.test/about" });
    expect(await engine.runAutomations(createdEvent(hit))).toBe(1);
    expect(await engine.runAutomations(createdEvent(miss))).toBe(0);

    const after = await item(hit);
    expect(after.priority).toBe("high");
    expect(after.assignee_ids).toHaveLength(1);
    expect((await item(miss)).priority).toBe("none");
    const labels = await db()`select label_id from feedback_label where feedback_id = ${hit}`;
    expect(labels.map((l) => l.label_id)).toEqual([ids.labelA]);

    const [run] = await runsOf(rule);
    expect(run).toMatchObject({ status: "success", event: "feedback_created", depth: 0 });
    const rows =
      await db()`select type, actor_kind, actor_id, data from activity where feedback_id = ${hit} order by type`;
    expect(rows.map((r) => r.type).sort()).toEqual([
      "assigneeIds_changed",
      "labelIds_changed",
      "priority_changed",
    ]);
    for (const r of rows) {
      expect(r.actor_kind).toBe("rule");
      expect(r.actor_id).toBeNull();
      expect((r.data as Json).ruleName).toBe("Pricing bugs");
    }
    // The changes were announced to webhooks / notifications as events caused by this rule.
    const events = effects.enqueue.mock.calls.map((c) => c[1] as Json).filter((d) => d.feedbackId === hit);
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(e.ruleChain).toEqual([rule]);
      expect(e.actor).toEqual({ kind: "integration", id: `rule:${rule}` });
    }
  });

  it("rotates round-robin assignment and never takes an item from its assignee", async () => {
    const rule = await createRule({
      name: "Rotate",
      trigger: { event: "feedback_created" },
      actions: [{ type: "assign", userIds: [owner, second], mode: "round_robin" }],
    });
    const picks: string[] = [];
    for (let i = 0; i < 4; i++) {
      const id = await newItem();
      await engine.runAutomations(createdEvent(id));
      picks.push(((await item(id)).assignee_ids as string[])[0] ?? "");
    }
    expect(new Set(picks)).toEqual(new Set([owner, second]));
    expect(picks[0]).not.toBe(picks[1]);
    expect(picks[0]).toBe(picks[2]);
    const taken = await newItem();
    await db()`update feedback set assignee_ids = ${db().array([owner])} where id = ${taken}`;
    await engine.runAutomations(createdEvent(taken));
    expect((await item(taken)).assignee_ids).toEqual([owner]);
    expect(await runsOf(rule)).toHaveLength(5);
  });

  it("is idempotent: the same event never runs a rule twice", async () => {
    const rule = await createRule({
      name: "Once",
      trigger: { event: "feedback_created" },
      actions: [{ type: "set_priority", priority: "urgent" }],
    });
    const id = await newItem();
    const event = createdEvent(id);
    expect(await engine.runAutomations(event)).toBe(1);
    expect(await engine.runAutomations(event)).toBe(0);
    expect(await runsOf(rule)).toHaveLength(1);
    expect((await db()`select run_count from automation_rule where id = ${rule}`)[0]?.run_count).toBe(1);
  });

  it("does not run disabled rules, other triggers or items in the trash", async () => {
    const off = await createRule({
      name: "Off",
      enabled: false,
      trigger: { event: "feedback_created" },
      actions: [{ type: "set_priority", priority: "low" }],
    });
    const status = await createRule({
      name: "On resolve",
      trigger: { event: "status_changed", toStatuses: ["resolved"] },
      actions: [{ type: "set_priority", priority: "low" }],
    });
    const id = await newItem();
    expect(await engine.runAutomations(createdEvent(id))).toBe(0);
    expect(await runsOf(off)).toHaveLength(0);
    expect(await runsOf(status)).toHaveLength(0);
    await db()`update feedback set deleted_at = now() where id = ${id}`;
    expect(await engine.runAutomations(createdEvent(id))).toBe(0);
  });

  it("status_changed and label_added triggers read the event's changes", async () => {
    const onStatus = await createRule({
      name: "Resolved => low",
      trigger: { event: "status_changed", toStatuses: ["resolved"] },
      actions: [{ type: "set_priority", priority: "low" }],
    });
    const onLabel = await createRule({
      name: "Billing label => review",
      trigger: { event: "label_added", labelId: ids.labelA },
      actions: [{ type: "set_status", status: "in_review" }],
    });
    const id = await newItem({ priority: "high" });
    const statusEvent = {
      ...createdEvent(id),
      type: "feedback.status_changed" as const,
      changes: { status: { from: "open", to: "in_progress" } },
    };
    expect(await engine.runAutomations(statusEvent)).toBe(0);
    expect(
      await engine.runAutomations({
        ...statusEvent,
        id: randomUUID(),
        changes: { status: { from: "open", to: "resolved" } },
      }),
    ).toBe(1);
    expect((await item(id)).priority).toBe("low");
    await db()`insert into feedback_label (feedback_id,label_id) values (${id},${ids.labelA})`;
    const labelEvent = {
      ...createdEvent(id),
      type: "feedback.labels_changed" as const,
      changes: { labelIds: { from: [], to: [ids.labelA] } },
    };
    expect(
      await engine.runAutomations({
        ...labelEvent,
        changes: { labelIds: { from: [ids.labelA], to: [ids.labelA] } },
      }),
    ).toBe(0);
    expect(await engine.runAutomations(labelEvent)).toBe(1);
    expect((await item(id)).status).toBe("in_review");
    expect(await runsOf(onStatus)).toHaveLength(1);
    expect(await runsOf(onLabel)).toHaveLength(1);
  });

  it("protects against loops: a rule's own change never re-runs it, and chains stop at the depth limit", async () => {
    // Setting the status fires status_changed, which this very rule listens to.
    const rule = await createRule({
      name: "Echo",
      trigger: { event: "status_changed" },
      actions: [{ type: "set_status", status: "in_progress" }],
    });
    const id = await newItem();
    const first = {
      ...createdEvent(id),
      type: "feedback.status_changed" as const,
      changes: { status: { from: "open", to: "wont_fix" } },
    };
    expect(await engine.runAutomations(first)).toBe(1);
    const caused = effects.enqueue.mock.calls
      .map((c) => c[1] as Json)
      .find((d) => d.type === "feedback.status_changed" && d.feedbackId === id);
    expect(caused?.ruleChain).toEqual([rule]);
    // The dispatcher would queue that event: the engine must record a skip and change nothing.
    await db()`update feedback set status = 'open' where id = ${id}`;
    expect(await engine.runAutomations(caused as never)).toBe(0);
    expect((await item(id)).status).toBe("open");
    const runs = await runsOf(rule);
    expect(runs.map((r) => r.status)).toEqual(["success", "skipped"]);
    // Chains of three or more hops are not evaluated at all.
    expect(
      await engine.runAutomations({
        ...first,
        id: randomUUID(),
        ruleChain: [randomUUID(), randomUUID(), randomUUID()],
      }),
    ).toBe(0);
    expect(engine.wantsAutomation({ type: "feedback.created", ruleChain: ["a", "b", "c"] })).toBe(false);
    expect(engine.wantsAutomation({ type: "feedback.updated" })).toBe(false);
  });

  it("two rules can chain once but not loop (A sets status, B reacts, B's change does not wake A)", async () => {
    const a = await createRule({
      name: "A",
      trigger: { event: "feedback_created" },
      actions: [{ type: "set_status", status: "in_progress" }],
    });
    const b = await createRule({
      name: "B",
      trigger: { event: "status_changed", toStatuses: ["in_progress"] },
      actions: [{ type: "set_priority", priority: "urgent" }],
    });
    const id = await newItem();
    await engine.runAutomations(createdEvent(id));
    const statusEvent = effects.enqueue.mock.calls
      .map((c) => c[1] as Json)
      .find((d) => d.type === "feedback.status_changed" && d.feedbackId === id);
    expect(statusEvent?.ruleChain).toEqual([a]);
    expect(await engine.runAutomations(statusEvent as never)).toBe(1);
    expect((await item(id)).priority).toBe("urgent");
    expect(await runsOf(b)).toHaveLength(1);
  });

  it("reports a failing action in the run log without stopping the next one", async () => {
    const rule = await createRule({
      name: "Partial",
      trigger: { event: "feedback_created" },
      actions: [
        { type: "add_label", labelId: ids.labelA },
        { type: "set_priority", priority: "medium" },
      ],
    });
    const id = await newItem();
    // The label disappears after the rule was saved.
    await db()`delete from label where id = ${ids.labelA}`;
    await engine.runAutomations(createdEvent(id));
    const [run] = await runsOf(rule);
    expect(run?.status).toBe("partial");
    expect((run?.results as Json[]).map((r) => r.ok)).toEqual([false, true]);
    expect((await item(id)).priority).toBe("medium");
    ids.labelA = randomUUID();
    await db()`insert into label (id,org_id,project_id,name,color) values (${ids.labelA},${orgA},${ids.projectA},'Billing 2','#112233')`;
  });

  it("never touches workspace B, even when B has an identical rule", async () => {
    const ruleB = randomUUID();
    await db()`insert into automation_rule (id,org_id,project_id,name,trigger,conditions,actions) values (${ruleB},${orgB},${ids.projectB},'B rule',${db().json({ event: "feedback_created", toStatuses: [], labelId: null })},${db().json([])},${db().json([{ type: "set_priority", priority: "urgent" }])})`;
    const id = await newItem();
    await engine.runAutomations(createdEvent(id));
    expect(await runsOf(ruleB)).toHaveLength(0);
    // And an event naming workspace A's item under workspace B's id does nothing.
    expect(await engine.runAutomations({ ...createdEvent(id), orgId: orgB })).toBe(0);
  });

  it("dry-runs a rule against a sample and an item without changing anything", async () => {
    const rule = await createRule({
      name: "Dry",
      trigger: { event: "feedback_created" },
      conditions: [
        { field: "kind", values: ["bug"] },
        { field: "reporterEmailDomain", values: ["acme.com"] },
        { field: "hasReplay", value: true },
      ],
      actions: [{ type: "set_priority", priority: "urgent" }],
    });
    const test = async (body: Json) =>
      json(await request(`/api/automations/${rule}/test`, { method: "POST", body }));
    expect(
      await test({ sample: { kind: "bug", reporterEmail: "jo@Acme.com", hasReplay: true } }),
    ).toMatchObject({ triggered: true, conditions: [true, true, true], matched: true });
    expect(await test({ sample: { kind: "idea", reporterEmail: "jo@other.io" } })).toMatchObject({
      conditions: [false, false, false],
      matched: false,
    });
    const id = await newItem();
    expect(await test({ feedbackId: id })).toMatchObject({ triggered: true, matched: false });
    expect((await item(id)).priority).toBe("none");
    expect(await runsOf(rule)).toHaveLength(0);
    const foreignItem = randomUUID();
    expect(
      (await request(`/api/automations/${rule}/test`, { method: "POST", body: { feedbackId: foreignItem } }))
        .status,
    ).toBe(404);
  });

  it("lists the run log per project and rule", async () => {
    const rule = await createRule({
      name: "Logged",
      trigger: { event: "feedback_created" },
      actions: [{ type: "set_priority", priority: "low" }],
    });
    await engine.runAutomations(createdEvent(await newItem()));
    const byRule = await json(await request(`/api/projects/${ids.projectA}/automation-runs?ruleId=${rule}`));
    expect(byRule.runs).toHaveLength(1);
    const response = await json(await request(`/api/projects/${ids.projectA}/automation-runs?limit=5`));
    expect(response.runs.length).toBeGreaterThan(0);
    expect(response.runs[0]).toMatchObject({ ruleName: expect.any(String), status: expect.any(String) });
    const foreign = await request(`/api/projects/${ids.projectB}/automation-runs`);
    expect(foreign.status).toBe(404);
  });

  it("accepts, dismisses and bulk-handles AI label suggestions", async () => {
    const itemId = await newItem();
    const existing = randomUUID(),
      fresh = randomUUID(),
      other = randomUUID();
    await db()`insert into label_suggestion (id,org_id,feedback_id,label_id,name) values (${existing},${orgA},${itemId},${ids.labelA},'Billing 2')`;
    await db()`insert into label_suggestion (id,org_id,feedback_id,label_id,name,reason) values (${fresh},${orgA},${itemId},null,'Checkout','Mentions the cart')`;
    await db()`insert into label_suggestion (id,org_id,feedback_id,label_id,name) values (${other},${orgA},${itemId},null,'Noise')`;

    const list = await json(await request(`/api/feedback/${itemId}/ai/labels`));
    expect(list.suggestions).toHaveLength(3);
    // Nothing was applied by merely suggesting.
    expect(await db()`select 1 from feedback_label where feedback_id = ${itemId}`).toHaveLength(0);

    expect(
      (await request(`/api/feedback/${itemId}/ai/labels/${existing}/accept`, { method: "POST" })).status,
    ).toBe(200);
    expect(
      (await request(`/api/feedback/${itemId}/ai/labels/${fresh}/accept`, { method: "POST" })).status,
    ).toBe(200);
    expect(
      (await request(`/api/feedback/${itemId}/ai/labels/${other}/dismiss`, { method: "POST" })).status,
    ).toBe(200);
    const names =
      await db()`select l.name from feedback_label fl join label l on l.id = fl.label_id where fl.feedback_id = ${itemId} order by l.name`;
    expect(names.map((n) => n.name)).toEqual(["Billing 2", "Checkout"]);
    expect(
      await db()`select 1 from label where project_id = ${ids.projectA} and name = 'Noise'`,
    ).toHaveLength(0);
    const timeline =
      await db()`select actor_kind, actor_id from activity where feedback_id = ${itemId} and type = 'labelIds_changed'`;
    expect(timeline.every((r) => r.actor_kind === "user" && r.actor_id === owner)).toBe(true);
    expect((await json(await request(`/api/feedback/${itemId}/ai/labels`))).suggestions).toHaveLength(0);
    // Deciding twice is a not-found, not a second application.
    expect(
      (await request(`/api/feedback/${itemId}/ai/labels/${existing}/accept`, { method: "POST" })).status,
    ).toBe(404);

    const a = await newItem(),
      b = await newItem();
    for (const f of [a, b]) {
      await db()`insert into label_suggestion (org_id,feedback_id,label_id,name) values (${orgA},${f},${ids.labelA},'Billing 2')`;
    }
    const bulk = await json(
      await request("/api/ai/labels/bulk", {
        method: "POST",
        body: { feedbackIds: [a, b, randomUUID()], action: "accept" },
      }),
    );
    expect(bulk).toEqual({ accepted: 2, dismissed: 0 });
    expect(await db()`select 1 from feedback_label where feedback_id in (${a}, ${b})`).toHaveLength(2);
  });

  it("applies suggestions of existing labels without asking only when the project opts in", async () => {
    const { autoApplySuggestions, recordSuggestions } = await import("./services/label-suggestions");
    const { withOrg } = await import("../../db/src/tenant-context");
    const id = await newItem();
    await withOrg(orgA, async () => {
      const stored = await recordSuggestions(orgA, id, [
        { labelId: ids.labelA, name: "Billing 2", reason: "" },
        { labelId: null, name: "Brand new", reason: "" },
      ]);
      await autoApplySuggestions(orgA, id, stored);
    });
    const attached = await db()`select label_id from feedback_label where feedback_id = ${id}`;
    expect(attached.map((r) => r.label_id)).toEqual([ids.labelA]);
    const pending =
      await db()`select name from label_suggestion where feedback_id = ${id} and status = 'pending'`;
    expect(pending.map((r) => r.name)).toEqual(["Brand new"]);
    const [row] =
      await db()`select actor_kind, data from activity where feedback_id = ${id} and type = 'labelIds_changed'`;
    expect(row?.actor_kind).toBe("ai");
    expect((row?.data as Json).via).toBe("ai");
  });
});
