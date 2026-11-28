import type * as ApiModule from "./index";
import type * as BossModule from "./jobs/boss";
import type * as BusModule from "./realtime/bus";
import type * as LicenseModule from "./license";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getRuntimeDb } from "../../db/src/connection";
import { closeIdentityDatabase } from "../../db/src/identity";
import { createCloudFixture } from "./test-helpers/cloud-fixture";

/**
 * Custom roles end to end on the Cloud stack, where row security applies (WP-24, ADR 0045): entitlement
 * gating, who may manage roles, tenant isolation, escalation attempts, base-role consistency, downgrade
 * fallback and the audit trail. Custom roles are an Enterprise licence feature, which a Cloud plan never
 * carries, so the licence check is switched by `flag` (the licence parser has its own tests).
 */
const effects = vi.hoisted(() => ({
  enqueue: vi.fn<(...args: unknown[]) => Promise<void>>(),
  publish: vi.fn<(...args: unknown[]) => Promise<void>>(),
}));
const flag = vi.hoisted(() => ({ on: true }));
vi.mock("./jobs/boss", async (original) => ({
  ...(await original<typeof BossModule>()),
  enqueue: effects.enqueue,
}));
vi.mock("./realtime/bus", async (original) => ({
  ...(await original<typeof BusModule>()),
  publish: effects.publish,
}));
vi.mock("./license", async (original) => {
  const actual = await original<typeof LicenseModule>();
  const gated = new Set(["custom_roles", "audit_log"]);
  return {
    ...actual,
    hasFeature: (f: Parameters<typeof actual.hasFeature>[0]) =>
      gated.has(f) ? Promise.resolve(flag.on) : actual.hasFeature(f),
    assertFeatureWritable: () => Promise.resolve(),
  };
});

type Json = Record<string, unknown>;
type Jar = Map<string, string>;
type Role = { id: string; name: string; permissions: string[]; memberCount: number };

describe.skipIf(!process.env.PINWREN_ISOLATION_ADMIN_URL)("Cloud custom roles", () => {
  let fixture: Awaited<ReturnType<typeof createCloudFixture>> | undefined;
  let api: typeof ApiModule.app;
  const suffix = randomUUID();
  const password = randomUUID();
  const orgA = `roles-a-${suffix}`,
    orgB = `roles-b-${suffix}`;
  const users = {
    ownerA: `owner-a-${suffix}`,
    adminA: `admin-a-${suffix}`,
    editorA: `editor-a-${suffix}`,
    viewerA: `viewer-a-${suffix}`,
    pmA: `pm-a-${suffix}`,
    auditorA: `auditor-a-${suffix}`,
    ownerB: `owner-b-${suffix}`,
    memberB: `member-b-${suffix}`,
  };
  type Who = keyof typeof users;
  const jars = Object.fromEntries(Object.keys(users).map((k) => [k, new Map()])) as Record<Who, Jar>;
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
  const request = (as: Who, path: string, init: { method?: string; body?: unknown } = {}) => {
    const headers = new Headers({ origin: "http://localhost:3100", "content-type": "application/json" });
    const jar = jars[as];
    if (jar.size) headers.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
    return api.request(`http://localhost:3100${path}`, {
      method: init.method ?? "GET",
      headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  };
  const json = async <T = Json>(r: Response) => (await r.json()) as T;
  const createRole = async (as: Who, name: string, permissions: string[]) => {
    const r = await request(as, "/api/roles", { method: "POST", body: { name, permissions } });
    return { status: r.status, body: await json<{ role: Role } & Json>(r) };
  };
  const assign = (as: Who, target: Who, body: Json) =>
    request(as, `/api/members/${users[target]}`, { method: "PATCH", body });
  const memberRow = async (who: Who) => {
    const [row] = await db()`select role, custom_role_id from member where user_id=${users[who]}`;
    return row as { role: string; custom_role_id: string | null };
  };
  const me = async (as: Who) =>
    json<{ role: string; permissions: string[]; customRole: { name: string } | null }>(
      await request(as, "/api/me"),
    );
  const actions = async (org: string) =>
    (await db()`select action from audit_log where org_id=${org} order by created_at`).map(
      (r) => r.action as string,
    );

  let auditor: Role;
  let people: Role;

  beforeAll(async () => {
    fixture = await createCloudFixture();
    vi.stubEnv("PINWREN_MODE", "cloud");
    vi.stubEnv("DATABASE_URL", fixture.runtimeUrl);
    vi.stubEnv("PINWREN_SERVICE_DATABASE_URL", fixture.serviceUrl);
    vi.stubEnv("PINWREN_URL", "http://localhost:3100");
    vi.stubEnv("PINWREN_SECRET", randomUUID() + randomUUID());
    vi.stubEnv("PINWREN_DISABLE_SIGNUP", "false");
    vi.stubEnv("PINWREN_ADMIN_EMAILS", undefined);
    const d = fixture.db;
    const hash = await hashPassword(password);
    for (const org of [orgA, orgB])
      await d`insert into organization (id,name,slug) values (${org},${org},${org})`;
    const seats: [Who, string, string][] = [
      ["ownerA", orgA, "owner"],
      ["adminA", orgA, "admin"],
      ["editorA", orgA, "member"],
      ["viewerA", orgA, "viewer"],
      ["pmA", orgA, "member"],
      ["auditorA", orgA, "viewer"],
      ["ownerB", orgB, "owner"],
      ["memberB", orgB, "member"],
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
    flag.on = true;
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

  it("refuses to create or edit roles without the licence feature, but still lists", async () => {
    flag.on = false;
    const refused = await createRole("ownerA", "Nope", ["feedback.read"]);
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ code: "LICENSE_REQUIRED" });
    const list = await json<{ roles: Role[]; entitled: boolean }>(await request("ownerA", "/api/roles"));
    expect(list).toMatchObject({ roles: [], entitled: false });
    expect(await db()`select id from custom_role where org_id=${orgA}`).toHaveLength(0);
  });

  it("lets only Admins manage roles; editors and viewers are refused", async () => {
    for (const who of ["editorA", "viewerA"] as const) {
      expect((await createRole(who, "Sneaky", ["feedback.read"])).status, who).toBe(403);
      expect((await request(who, "/api/roles")).status, who).toBe(403);
    }
    const made = await createRole("adminA", "Auditor", ["audit.read"]);
    expect(made.status).toBe(201);
    auditor = made.body.role;
    // The baseline permission is always present, in catalogue order.
    expect(auditor.permissions).toEqual(["feedback.read", "audit.read"]);
    const second = await createRole("ownerA", "People manager", ["users.manage"]);
    expect(second.status).toBe(201);
    people = second.body.role;
  });

  it("rejects duplicate names (any case), unknown and ungrantable permissions", async () => {
    expect((await createRole("ownerA", "auditor", ["feedback.read"])).status).toBe(409);
    for (const permission of ["roles.manage", "admin.instance", "nope"]) {
      expect((await createRole("ownerA", `x-${permission}`, [permission])).status, permission).toBe(400);
    }
    await expect(db()`insert into custom_role (org_id,name) values (${orgA},'AUDITOR')`).rejects.toThrow();
  });

  it("keeps each workspace's roles to itself", async () => {
    const own = await createRole("ownerB", "Auditor", ["audit.read"]);
    expect(own.status).toBe(201);
    const listA = await json<{ roles: Role[] }>(await request("ownerA", "/api/roles"));
    const listB = await json<{ roles: Role[] }>(await request("ownerB", "/api/roles"));
    expect(listA.roles.map((r) => r.id)).not.toContain(own.body.role.id);
    expect(listB.roles.map((r) => r.id)).not.toContain(auditor.id);
    const patch = await request("ownerB", `/api/roles/${auditor.id}`, {
      method: "PATCH",
      body: { name: "Hijack" },
    });
    expect(patch.status).toBe(404);
    expect((await request("ownerB", `/api/roles/${auditor.id}`, { method: "DELETE" })).status).toBe(404);
    // Assigning another workspace's role is refused, and so is a cross-tenant row at the database.
    const cross = await request("ownerB", `/api/members/${users.memberB}`, {
      method: "PATCH",
      body: { customRoleId: auditor.id },
    });
    expect(cross.status).toBe(400);
    expect(await json(cross)).toMatchObject({ code: "ROLE_NOT_FOUND" });
    await expect(
      db()`update member set custom_role_id=${auditor.id} where user_id=${users.memberB}`,
    ).rejects.toThrow();
  });

  it("assigns a role: base role stays consistent and permissions are resolved", async () => {
    const res = await assign("ownerA", "auditorA", { customRoleId: auditor.id });
    expect(res.status).toBe(200);
    expect(await memberRow("auditorA")).toEqual({ role: "viewer", custom_role_id: auditor.id });
    const mine = await me("auditorA");
    expect(mine.customRole).toMatchObject({ name: "Auditor" });
    expect(mine.permissions).toEqual(["feedback.read", "audit.read"]);
    // Only what the role lists: reads the audit log, cannot write anything.
    expect((await request("auditorA", "/api/audit")).status).toBe(200);
    const write = await request("auditorA", `/api/labels/${randomUUID()}`, { method: "DELETE" });
    expect(write.status).toBe(403);
    expect(await json(write)).toMatchObject({ code: "READ_ONLY_ROLE" });
    // The member list shows the role.
    const list = await json<{ members: { userId: string; customRoleName: string | null }[] }>(
      await request("ownerA", "/api/members"),
    );
    expect(list.members.find((m) => m.userId === users.auditorA)?.customRoleName).toBe("Auditor");
    // Editors still cannot read the audit log: the built-in matrix is untouched.
    expect((await request("editorA", "/api/audit")).status).toBe(403);
  });

  it("stops a users.manage holder from escalating or touching people above them", async () => {
    expect((await assign("ownerA", "pmA", { customRoleId: people.id })).status).toBe(200);
    // Not an Admin, so it cannot demote or remove one, nor create or change roles.
    const demote = await assign("pmA", "adminA", { role: "viewer" });
    expect(demote.status).toBe(403);
    expect(await json(demote)).toMatchObject({ code: "PERMISSION_ESCALATION" });
    expect((await request("pmA", `/api/members/${users.adminA}`, { method: "DELETE" })).status).toBe(403);
    // Cannot hand out Admin or Editor (it holds neither), nor a role with permissions it lacks.
    expect((await assign("pmA", "viewerA", { role: "admin" })).status).toBe(403);
    expect((await assign("pmA", "viewerA", { role: "editor" })).status).toBe(403);
    expect((await assign("pmA", "viewerA", { customRoleId: auditor.id })).status).toBe(403);
    const mint = await request("pmA", "/api/roles", {
      method: "POST",
      body: { name: "Mine", permissions: [] },
    });
    expect(mint.status).toBe(403);
    const widen = await request("pmA", `/api/roles/${people.id}`, {
      method: "PATCH",
      body: { permissions: ["users.manage", "settings.manage"] },
    });
    expect(widen.status).toBe(403);
    // It can read roles (for the picker), and give what it holds: Viewer.
    expect((await request("pmA", "/api/roles")).status).toBe(200);
    expect((await assign("pmA", "viewerA", { role: "viewer" })).status).toBe(200);
    // Admin accounts stay safe: the owner cannot be demoted, nor a role put on yourself.
    expect(await json(await assign("adminA", "ownerA", { customRoleId: people.id }))).toMatchObject({
      code: "OWNER_LOCKED",
    });
    expect(await json(await assign("adminA", "adminA", { customRoleId: people.id }))).toMatchObject({
      code: "OWN_ROLE",
    });
  });

  it("re-derives the base role when a role's permissions change", async () => {
    const res = await request("ownerA", `/api/roles/${auditor.id}`, {
      method: "PATCH",
      body: { permissions: ["audit.read", "labels.manage"] },
    });
    expect(res.status).toBe(200);
    expect(await memberRow("auditorA")).toMatchObject({ role: "member" });
    const mine = await me("auditorA");
    expect(mine.permissions).toEqual(["feedback.read", "labels.manage", "audit.read"]);
    // An Editor base but a custom role: routes outside the list stay closed.
    expect((await request("auditorA", `/api/feedback/${randomUUID()}`, { method: "DELETE" })).status).toBe(
      403,
    );
    const round = await request("auditorA", `/api/rounds/${randomUUID()}`, { method: "PATCH", body: {} });
    expect(round.status).toBe(403);
  });

  it("falls back to the base role when the licence lapses, and never locks anyone out", async () => {
    flag.on = false;
    const mine = await me("auditorA");
    expect(mine.customRole).toBeNull();
    // The stored base role (Editor) decides: the Editor permissions, not the custom list.
    expect(mine.permissions).toContain("feedback.update");
    expect(mine.permissions).not.toContain("audit.read");
    expect((await me("ownerA")).permissions).toContain("roles.manage");
    expect((await me("adminA")).permissions).toContain("users.manage");
    expect((await request("auditorA", "/api/feedback?limit=1")).status).toBe(200);
    // Assigning needs the licence; moving someone to a built-in role does not.
    expect((await assign("ownerA", "editorA", { customRoleId: auditor.id })).status).toBe(403);
    expect((await assign("ownerA", "auditorA", { role: "editor" })).status).toBe(200);
  });

  it("refuses deleting a role in use, then deletes it once nobody holds it", async () => {
    expect((await assign("ownerA", "auditorA", { customRoleId: auditor.id })).status).toBe(200);
    const used = await request("ownerA", `/api/roles/${auditor.id}`, { method: "DELETE" });
    expect(used.status).toBe(409);
    expect(await json(used)).toMatchObject({ code: "ROLE_IN_USE" });
    // The database refuses it too, whatever the API does.
    await expect(db()`delete from custom_role where id=${auditor.id}`).rejects.toThrow();
    expect((await assign("ownerA", "auditorA", { role: "viewer" })).status).toBe(200);
    expect(await memberRow("auditorA")).toEqual({ role: "viewer", custom_role_id: null });
    expect((await request("ownerA", `/api/roles/${auditor.id}`, { method: "DELETE" })).status).toBe(204);
  });

  it("adds a user with a custom role, within the creator's own permissions", async () => {
    const add = (as: Who, body: Json) => request(as, "/api/members", { method: "POST", body });
    const base = { name: "New Person", password: "correct horse battery", role: "editor" };
    const email = `n1-${suffix}@test.invalid`;
    const ok = await add("ownerA", { ...base, email, customRoleId: people.id });
    expect(ok.status).toBe(201);
    const [row] =
      await db()`select m.role, m.custom_role_id from member m join "user" u on u.id=m.user_id where u.email=${email}`;
    expect(row).toMatchObject({ role: "member", custom_role_id: people.id });
    // A people manager cannot add an Admin or an Editor.
    for (const role of ["admin", "editor"]) {
      const refused = await add("pmA", { ...base, role, email: `n-${role}-${suffix}@test.invalid` });
      expect(refused.status, role).toBe(403);
    }
  });

  it("records role changes in the audit log", async () => {
    const seen = await actions(orgA);
    for (const a of [
      "role.created",
      "role.updated",
      "role.deleted",
      "member.custom_role_assigned",
      "member.role_changed",
      "member.created",
    ]) {
      expect(seen, a).toContain(a);
    }
  });
});
