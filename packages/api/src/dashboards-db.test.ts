import type * as ApiModule from "./index";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getRuntimeDb } from "../../db/src/connection";
import { closeIdentityDatabase } from "../../db/src/identity";
import { createCloudFixture } from "./test-helpers/cloud-fixture";

/**
 * Named and shared dashboards, per-person state and the dashboard-wide stats filters against a real database
 * with row security (ADR 0037): visibility, publishing, role defaults, validation, and that nothing crosses
 * the workspace boundary.
 */
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- the cases read parsed JSON responses and SQL rows */
type Json = Record<string, any>;
type Who = "owner" | "member" | "viewer" | "outsider";

describe.skipIf(!process.env.PINWREN_ISOLATION_ADMIN_URL)("Dashboards", () => {
  let fixture: Awaited<ReturnType<typeof createCloudFixture>> | undefined;
  let api: typeof ApiModule.app;
  const suffix = randomUUID();
  const orgA = `dash-a-${suffix}`;
  const orgB = `dash-b-${suffix}`;
  const users: Record<Who, string> = {
    owner: `owner-${suffix}`,
    member: `member-${suffix}`,
    viewer: `viewer-${suffix}`,
    outsider: `outsider-${suffix}`,
  };
  const password = randomUUID();
  const jars = new Map<Who, Map<string, string>>();
  const ids = { projectA: randomUUID(), projectB: randomUUID(), labelA: randomUUID(), labelB: randomUUID() };
  const db = () => {
    if (!fixture) throw new Error("fixture not ready");
    return fixture.db;
  };
  const layout = (...slots: [string, number, number][]) => ({
    v: 1,
    days: 14,
    slots: slots.map(([id, w, h]) => ({ id, w, h })),
  });

  const call = (who: Who, path: string, init: { method?: string; body?: unknown } = {}) => {
    const headers = new Headers({ origin: "http://localhost:3100", "content-type": "application/json" });
    const jar = jars.get(who);
    if (jar?.size) headers.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
    return api.request(`http://localhost:3100${path}`, {
      method: init.method ?? "GET",
      headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  };
  const take = (who: Who, response: Response) => {
    const jar = jars.get(who) ?? new Map<string, string>();
    jars.set(who, jar);
    for (const cookie of response.headers.getSetCookie()) {
      const part = cookie.split(";")[0] ?? "";
      const eq = part.indexOf("=");
      if (eq > 0 && part.slice(eq + 1)) jar.set(part.slice(0, eq), part.slice(eq + 1));
    }
  };
  const json = async (response: Response) => (await response.json()) as Json;
  const create = async (who: Who, body: Json, expected = 201) => {
    const response = await call(who, "/api/dashboards", { method: "POST", body });
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(expected);
    return response.status === 201 ? ((await json(response)).dashboard as Json) : undefined;
  };
  const list = async (who: Who, scope = "home") =>
    (await json(await call(who, `/api/dashboards?scope=${scope}`))).dashboards as Json[];

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
    for (const [who, org, role] of [
      ["owner", orgA, "owner"],
      ["member", orgA, "member"],
      ["viewer", orgA, "viewer"],
      ["outsider", orgB, "owner"],
    ] as const) {
      const user = users[who];
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
    for (const who of Object.keys(users) as Who[]) {
      const signed = await call(who, "/api/auth/sign-in/email", {
        method: "POST",
        body: { email: `${users[who]}@test.invalid`, password },
      });
      expect(signed.status).toBe(200);
      take(who, signed);
      take(
        who,
        await call(who, "/api/auth/organization/set-active", {
          method: "POST",
          body: { organizationId: who === "outsider" ? orgB : orgA },
        }),
      );
    }
  }, 120_000);
  afterAll(async () => {
    if (fixture) {
      await closeIdentityDatabase();
      await getRuntimeDb().$client.end();
      await fixture.dispose();
    }
    vi.unstubAllEnvs();
  });

  it("creates, lists, renames and deletes a personal dashboard", async () => {
    const made = await create("member", {
      scope: "home",
      name: "Triage",
      layout: layout(["kpi.active", 3, 1], ["chart.trend", 8, 2]),
    });
    expect(made).toMatchObject({ name: "Triage", shared: false, mine: true, scope: "home" });
    expect(made?.layout.slots.map((s: Json) => s.id)).toEqual(["kpi.active", "chart.trend"]);
    // Names are unique per owner and screen, ignoring case; another screen or person may reuse one.
    await create("member", { scope: "home", name: "triage", layout: layout() }, 409);
    await create("member", { scope: "inbox", name: "Triage", layout: layout() });
    await create("owner", { scope: "home", name: "Triage", layout: layout() });

    expect((await list("member")).map((d) => d.name)).toEqual(["Triage"]);
    const renamed = await call("member", `/api/dashboards/${made?.id}`, {
      method: "PATCH",
      body: { name: "Exec weekly", layout: layout(["kpi.created", 4, 1]) },
    });
    expect(renamed.status).toBe(200);
    expect((await json(renamed)).dashboard).toMatchObject({ name: "Exec weekly" });
    expect((await call("member", `/api/dashboards/${made?.id}`, { method: "DELETE" })).status).toBe(204);
    expect(await list("member")).toEqual([]);
    expect((await call("member", `/api/dashboards/${made?.id}`, { method: "DELETE" })).status).toBe(404);
    expect((await call("member", "/api/dashboards/not-a-uuid", { method: "DELETE" })).status).toBe(404);
  });

  it("validates layouts: unknown shapes are dropped, sizes and the slot cap are enforced", async () => {
    const slots = [
      { id: "kpi.active", w: 3, h: 1 },
      { id: "kpi.active", w: 6, h: 1 }, // repeated
      { id: "not a widget", w: 3, h: 1 },
      { id: "<script>.x", w: 3, h: 1 },
      { id: "chart.trend", w: 5, h: 1 }, // no such span
      { id: "chart.status", w: 4, h: 9 }, // no such height
      "nope",
      null,
      { id: "list.recent", w: 6, h: 3 },
    ];
    const made = await create("member", {
      scope: "projects",
      name: "Dropped",
      layout: { v: 1, days: 30, slots },
    });
    expect(made?.layout).toEqual({
      v: 1,
      days: 30,
      slots: [
        { id: "kpi.active", w: 3, h: 1 },
        { id: "list.recent", w: 6, h: 3 },
      ],
    });
    // 60 distinct widgets: only the first 40 are kept.
    const many = Array.from({ length: 60 }, (_, i) => ({ id: `kpi.w${i}`, w: 3, h: 1 }));
    const big = await create("member", {
      scope: "projects",
      name: "Many",
      layout: { v: 1, days: 7, slots: many },
    });
    expect(big?.layout.slots).toHaveLength(40);
    // Bad envelope, range, scope or name: rejected.
    await create(
      "member",
      { scope: "projects", name: "Bad range", layout: { v: 1, days: 5, slots: [] } },
      400,
    );
    await create(
      "member",
      { scope: "projects", name: "Bad version", layout: { v: 2, days: 7, slots: [] } },
      400,
    );
    await create("member", { scope: "elsewhere", name: "Bad scope", layout: layout() }, 400);
    await create("member", { scope: "projects", name: "  ", layout: layout() }, 400);
    await create("member", { scope: "projects", name: "x".repeat(61), layout: layout() }, 400);
  });

  it("keeps personal dashboards private and each workspace to itself", async () => {
    const mine = await create("member", { scope: "notifications", name: "Private", layout: layout() });
    expect((await list("owner", "notifications")).map((d) => d.name)).not.toContain("Private");
    const other = await call("owner", `/api/dashboards/${mine?.id}`, {
      method: "PATCH",
      body: { name: "Mine now" },
    });
    expect(other.status).toBe(404);
    expect(
      (await call("owner", `/api/dashboards/${mine?.id}/duplicate`, { method: "POST", body: {} })).status,
    ).toBe(404);
    // Even an admin of the same workspace cannot reach another member's unshared dashboard.
    expect((await call("owner", `/api/dashboards/${mine?.id}`, { method: "DELETE" })).status).toBe(404);
    expect((await call("outsider", `/api/dashboards/${mine?.id}`, { method: "DELETE" })).status).toBe(404);
    expect((await list("outsider", "notifications")).map((d) => d.name)).not.toContain("Private");
  });

  it("lets an admin publish to the workspace; others read it and duplicate it, never edit it", async () => {
    const draft = await create("owner", {
      scope: "project",
      name: "Workspace view",
      layout: layout(["kpi.mine", 3, 1]),
    });
    // Members and viewers cannot publish, whether on create or by patching.
    await create("member", { scope: "project", name: "Sneaky", layout: layout(), shared: true }, 403);
    const mine = await create("member", { scope: "project", name: "Mine", layout: layout() });
    expect(
      (await call("member", `/api/dashboards/${mine?.id}`, { method: "PATCH", body: { shared: true } }))
        .status,
    ).toBe(403);
    await create("viewer", { scope: "project", name: "Viewer shares", layout: layout(), shared: true }, 403);

    expect((await list("member", "project")).map((d) => d.name)).not.toContain("Workspace view");
    const published = await call("owner", `/api/dashboards/${draft?.id}`, {
      method: "PATCH",
      body: { shared: true },
    });
    expect(published.status).toBe(200);
    expect((await json(published)).dashboard).toMatchObject({ shared: true, mine: true });

    const seen = await list("member", "project");
    expect(seen.find((d) => d.name === "Workspace view")).toMatchObject({ shared: true, mine: false });
    expect((await list("viewer", "project")).map((d) => d.name)).toContain("Workspace view");
    expect((await list("outsider", "project")).map((d) => d.name)).not.toContain("Workspace view");

    // Read-only for everyone but its owner and admins.
    for (const who of ["member", "viewer"] as const) {
      const patch = await call(who, `/api/dashboards/${draft?.id}`, {
        method: "PATCH",
        body: { name: "Hijack" },
      });
      expect([403, 404], who).toContain(patch.status);
      expect([403, 404], who).toContain(
        (await call(who, `/api/dashboards/${draft?.id}`, { method: "DELETE" })).status,
      );
    }
    // "Duplicate to my dashboards": a personal copy the member can edit.
    const copy = await call("member", `/api/dashboards/${draft?.id}/duplicate`, { method: "POST", body: {} });
    expect(copy.status).toBe(201);
    const copied = (await json(copy)).dashboard as Json;
    expect(copied).toMatchObject({ name: "Workspace view copy", shared: false, mine: true });
    expect(copied.layout).toEqual(draft?.layout);
    const twice = await json(
      await call("member", `/api/dashboards/${draft?.id}/duplicate`, { method: "POST", body: {} }),
    );
    expect(twice.dashboard.name).toBe("Workspace view copy 2");
    const viewerCopy = await call("viewer", `/api/dashboards/${draft?.id}/duplicate`, {
      method: "POST",
      body: {},
    });
    expect(viewerCopy.status).toBe(201);
    expect(
      (
        await call("member", `/api/dashboards/${copied.id}`, {
          method: "PATCH",
          body: { name: "Edited copy" },
        })
      ).status,
    ).toBe(200);
    // Unpublishing hides it again.
    await call("owner", `/api/dashboards/${draft?.id}`, { method: "PATCH", body: { shared: false } });
    expect((await list("member", "project")).map((d) => d.name)).not.toContain("Workspace view");
  });

  it("gives each role at most one shared default per screen", async () => {
    const one = await create("owner", {
      scope: "inbox",
      name: "Editors start here",
      layout: layout(["kpi.mine", 3, 1]),
      shared: true,
      defaultRoles: ["editor", "viewer"],
    });
    const two = await create("owner", {
      scope: "inbox",
      name: "Viewers start here",
      layout: layout(["kpi.active", 3, 1]),
      shared: true,
      defaultRoles: ["viewer"],
    });
    const rows = await list("member", "inbox");
    expect(rows.find((d) => d.id === one?.id)?.defaultRoles).toEqual(["editor"]);
    expect(rows.find((d) => d.id === two?.id)?.defaultRoles).toEqual(["viewer"]);
    // A personal dashboard cannot be a role default; unpublishing clears the roles.
    await create("member", { scope: "inbox", name: "Nope", layout: layout(), defaultRoles: ["viewer"] }, 403);
    const hidden = await json(
      await call("owner", `/api/dashboards/${two?.id}`, { method: "PATCH", body: { shared: false } }),
    );
    expect(hidden.dashboard).toMatchObject({ shared: false, defaultRoles: [] });
  });

  it("keeps a default dashboard and pinned projects per person, ignoring stale ones", async () => {
    const a = await create("member", { scope: "home", name: "Default me", layout: layout() });
    const patch = (who: Who, body: Json) =>
      call(who, "/api/me/workspace-preferences", { method: "PATCH", body });
    let response = await patch("member", { dashboardDefaults: { home: a?.id } });
    expect(response.status).toBe(200);
    expect((await json(response)).preferences.dashboardDefaults).toEqual({ home: a?.id });
    expect(
      (await json(await call("owner", "/api/me/workspace-preferences"))).preferences.dashboardDefaults,
    ).toEqual({});
    // Someone else's personal dashboard, or one of another screen, cannot be made the default.
    expect((await patch("owner", { dashboardDefaults: { home: a?.id } })).status).toBe(404);
    expect((await patch("member", { dashboardDefaults: { inbox: a?.id } })).status).toBe(400);
    // Deleting the dashboard makes the default fall away.
    await call("member", `/api/dashboards/${a?.id}`, { method: "DELETE" });
    response = await call("member", "/api/me/workspace-preferences");
    expect((await json(response)).preferences.dashboardDefaults).toEqual({});
    // Clearing with null.
    const b = await create("member", { scope: "home", name: "Default me 2", layout: layout() });
    await patch("member", { dashboardDefaults: { home: b?.id } });
    response = await patch("member", { dashboardDefaults: { home: null } });
    expect((await json(response)).preferences.dashboardDefaults).toEqual({});

    // Pinned projects: own workspace only, capped, de-duplicated.
    response = await patch("member", { pinnedProjectIds: [ids.projectA, ids.projectA] });
    expect((await json(response)).preferences.pinnedProjectIds).toEqual([ids.projectA]);
    expect((await patch("member", { pinnedProjectIds: [ids.projectB] })).status).toBe(404);
    expect(
      (await patch("member", { pinnedProjectIds: Array.from({ length: 13 }, () => randomUUID()) })).status,
    ).toBe(400);
    await db()`update project set archived_at = now() where id = ${ids.projectA}`;
    expect(
      (await json(await call("member", "/api/me/workspace-preferences"))).preferences.pinnedProjectIds,
    ).toEqual([]);
    await db()`update project set archived_at = null where id = ${ids.projectA}`;
    // A viewer keeps these too.
    expect((await patch("viewer", { pinnedProjectIds: [ids.projectA] })).status).toBe(200);
  });

  it("stores start page and dismissed prompts for the account and merges patches", async () => {
    expect((await json(await call("member", "/api/me/ui-state"))).uiState).toEqual({
      startPage: null,
      nudges: { firstSeen: null, dismissedUpdate: null, supportSnoozedUntil: null, supportOptOut: false },
    });
    const first = await call("member", "/api/me/ui-state", {
      method: "PATCH",
      body: { startPage: "dashboard", nudges: { dismissedUpdate: "v1.2.3" } },
    });
    expect(first.status).toBe(200);
    const second = await call("member", "/api/me/ui-state", {
      method: "PATCH",
      body: { nudges: { supportOptOut: true } },
    });
    expect((await json(second)).uiState).toEqual({
      startPage: "dashboard",
      nudges: { firstSeen: null, dismissedUpdate: "v1.2.3", supportSnoozedUntil: null, supportOptOut: true },
    });
    expect((await json(await call("owner", "/api/me/ui-state"))).uiState.startPage).toBeNull();
    // Unknown pages and oversized values are refused; a viewer may keep their own.
    expect(
      (await call("member", "/api/me/ui-state", { method: "PATCH", body: { startPage: "elsewhere" } }))
        .status,
    ).toBe(400);
    expect(
      (
        await call("member", "/api/me/ui-state", {
          method: "PATCH",
          body: { nudges: { dismissedUpdate: "x".repeat(101) } },
        })
      ).status,
    ).toBe(400);
    expect(
      (await call("viewer", "/api/me/ui-state", { method: "PATCH", body: { startPage: "my-work" } })).status,
    ).toBe(200);
  });

  describe("stats filters", () => {
    const stats = async (query: string, who: Who = "owner") => {
      const response = await call(who, `/api/stats?${query}`);
      expect(response.status, await response.clone().text()).toBe(200);
      return json(response);
    };
    let n = 100;
    const item = async (fields: {
      assignee?: string;
      label?: string;
      createdAt?: string;
      project?: string;
      org?: string;
    }) => {
      const id = randomUUID();
      const org = fields.org ?? orgA;
      const project = fields.project ?? ids.projectA;
      n += 1;
      await db()`insert into feedback (id,org_id,project_id,number,kind,priority,status,body,client_id,assignee_ids,created_at) values (${id},${org},${project},${n},'bug','none','open','Filter me',${randomUUID()},${db().array(fields.assignee ? [fields.assignee] : [])},${fields.createdAt ?? new Date().toISOString()})`;
      if (fields.label)
        await db()`insert into feedback_label (feedback_id,label_id) values (${id},${fields.label})`;
      return id;
    };

    it("narrows every number by label, assignee and project, and never reads another workspace", async () => {
      await db()`delete from feedback where org_id in (${orgA},${orgB})`;
      await item({ assignee: users.owner, label: ids.labelA });
      await item({ assignee: users.member });
      await item({ label: ids.labelA });
      await item({});
      await item({ org: orgB, project: ids.projectB, label: ids.labelB });

      expect((await stats("days=14")).totals.active).toBe(4);
      expect((await stats(`days=14&labelId=${ids.labelA}`)).totals.active).toBe(2);
      expect((await stats(`days=14&assigneeId=${users.member}`)).totals.active).toBe(1);
      expect((await stats("days=14&assigneeId=me")).totals.active).toBe(1);
      expect((await stats("days=14&assigneeId=me", "member")).totals.active).toBe(1);
      expect((await stats("days=14&assigneeId=none")).totals.active).toBe(2);
      expect((await stats(`days=14&labelId=${ids.labelA}&assigneeId=none`)).totals.active).toBe(1);
      const narrowed = await stats(`days=14&labelId=${ids.labelA}&assigneeId=me`);
      expect(narrowed.totals).toMatchObject({ active: 1, created: 1, mine: 1, unassigned: 0 });
      expect(narrowed.byStatus).toEqual([{ key: "open", count: 1 }]);
      expect(narrowed.recent.length).toBeLessThanOrEqual(10);
      // The project list follows the same filter.
      const byProject = (await stats(`days=14&labelId=${ids.labelA}`)).byProject as Json[];
      expect(byProject.find((p) => p.id === ids.projectA)).toMatchObject({ active: 2 });
      expect((await stats(`days=14&projectId=${ids.projectA}&assigneeId=none`)).totals.active).toBe(2);

      // Another workspace's project or label matches nothing here and leaks nothing back.
      expect((await stats(`days=14&projectId=${ids.projectB}`)).totals.active).toBe(0);
      expect((await stats(`days=14&labelId=${ids.labelB}`)).totals.active).toBe(0);
      expect((await stats(`days=14`, "outsider")).totals.active).toBe(1);
      expect((await stats(`days=14&labelId=${ids.labelA}`, "outsider")).totals.active).toBe(0);
      // Malformed filters are refused.
      expect((await call("owner", "/api/stats?labelId=nope")).status).toBe(400);
      expect((await call("owner", `/api/stats?assigneeId=${"x".repeat(101)}`)).status).toBe(400);
    });

    it("counts a custom date range inclusively and fills the series for exactly those days", async () => {
      await db()`delete from feedback where org_id = ${orgA}`;
      await item({ createdAt: "2026-03-01T10:00:00Z" });
      await item({ createdAt: "2026-03-02T23:59:00Z" });
      await item({ createdAt: "2026-03-03T00:00:00Z" });
      await item({ createdAt: "2026-02-27T12:00:00Z" });
      const inRange = await stats("from=2026-03-01&to=2026-03-02");
      expect(inRange.days).toBe(2);
      expect(inRange.totals.created).toBe(2);
      expect(inRange.series.map((s: Json) => s.date)).toEqual(["2026-03-01", "2026-03-02"]);
      expect(inRange.series.map((s: Json) => s.created)).toEqual([1, 1]);
      // Reporters, pages and environments follow the window as well.
      const wide = await stats("from=2026-02-27&to=2026-03-03");
      expect(wide.totals.created).toBe(4);
      expect(wide.days).toBe(5);
      expect((await stats("from=2026-03-03&to=2026-03-03")).totals.created).toBe(1);
      expect((await call("owner", "/api/stats?to=2026-03-03")).status).toBe(400);
      expect((await call("owner", "/api/stats?from=2026-03-04&to=2026-03-03")).status).toBe(400);
      expect((await call("owner", "/api/stats?from=2024-01-01&to=2026-01-01")).status).toBe(400);
      expect((await call("owner", "/api/stats?from=2026-13-01")).status).toBe(400);
    });
  });
});
