import type * as ApiModule from "./index";
import type * as BossModule from "./jobs/boss";
import type * as BusModule from "./realtime/bus";
import type * as DispatchModule from "./jobs/dispatch";
import type * as NotifyModule from "./jobs/notify";
import type * as RegressionModule from "./services/regression";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getRuntimeDb } from "../../db/src/connection";
import { closeIdentityDatabase } from "../../db/src/identity";
import { withOrg } from "../../db/src/tenant-context";
import { createCloudFixture } from "./test-helpers/cloud-fixture";

/**
 * Releases, "fixed in" and regression detection against a real database with row security (ADR 0036): the
 * dashboard and CI routes, the fixed-in rules, the detector and its release awareness, the dispatcher wiring
 * and the tenant boundary of every one of them.
 */
const effects = vi.hoisted(() => ({
  enqueue: vi.fn<(...args: unknown[]) => Promise<void>>(),
  publish: vi.fn<(...args: unknown[]) => Promise<void>>(),
  wanting: vi.fn<(...args: unknown[]) => void>(),
}));
// The recipient query joins account-wide preferences, an identity table the tenant role cannot read in Cloud
// (listed under "Remaining WP-21 work"). Stand in for it: the people named by the caller, as the real query
// would return them, so the cases still prove who is told and that the rows land in the right workspace.
vi.mock("./jobs/notify", async (original) => ({
  ...(await original<typeof NotifyModule>()),
  membersWanting: (orgId: string, projectId: string, pref: string, only?: readonly string[]) => {
    effects.wanting(orgId, projectId, pref, only);
    return Promise.resolve(
      (only ?? []).map((userId) => ({
        userId,
        name: userId,
        email: `${userId}@test.invalid`,
        wantsEmail: false,
        paused: false,
        digest: "off" as const,
      })),
    );
  },
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

describe.skipIf(!process.env.PINWREN_ISOLATION_ADMIN_URL)("Releases and regressions", () => {
  let fixture: Awaited<ReturnType<typeof createCloudFixture>> | undefined;
  let api: typeof ApiModule.app;
  let regression: typeof RegressionModule;
  let dispatch: typeof DispatchModule;
  const suffix = randomUUID();
  const orgA = `rel-a-${suffix}`;
  const orgB = `rel-b-${suffix}`;
  const owner = `owner-${suffix}`;
  const editor = `editor-${suffix}`;
  const outsider = `outsider-${suffix}`;
  const password = randomUUID();
  const jar = new Map<string, string>();
  const ids = {
    projectA: randomUUID(),
    projectB: randomUUID(),
    keyA: `pk_${randomUUID().replaceAll("-", "")}`,
  };
  const db = () => {
    if (!fixture) throw new Error("fixture not ready");
    return fixture.db;
  };

  const request = (path: string, init: { method?: string; body?: unknown; token?: string } = {}) => {
    const headers = new Headers({ origin: "http://localhost:3100", "content-type": "application/json" });
    if (init.token) headers.set("authorization", `Bearer ${init.token}`);
    else if (jar.size) headers.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
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

  const release = async (version: string, extra: Json = {}, project = ids.projectA) => {
    const response = await request(`/api/projects/${project}/releases`, {
      method: "POST",
      body: { version, ...extra },
    });
    expect([200, 201], JSON.stringify(await response.clone().json())).toContain(response.status);
    return (await json(response)).release as Json;
  };

  /** A report row with the signals regression detection reads. */
  const newItem = async (
    f: {
      kind?: string;
      status?: string;
      page?: string;
      css?: string;
      metadata?: Json;
      errors?: string[];
      project?: string;
      org?: string;
      sig?: boolean;
      fixedIn?: string;
    } = {},
  ) => {
    const org = f.org ?? orgA;
    const project = f.project ?? ids.projectA;
    const id = randomUUID();
    const [counted] =
      await db()`update project set feedback_counter = feedback_counter + 1 where id = ${project} returning feedback_counter as n`;
    let pageId: string | null = null;
    if (f.page) {
      await db()`insert into page (id,org_id,project_id,url) values (${randomUUID()},${org},${project},${f.page}) on conflict do nothing`;
      const [pg] = await db()`select id from page where project_id = ${project} and url = ${f.page}`;
      pageId = (pg?.id as string | undefined) ?? null;
    }
    const anchor = f.css ? { v: 1, css: f.css, xpath: "/html", tag: "button" } : null;
    await db()`insert into feedback (id,org_id,project_id,page_id,number,kind,status,body,client_id,anchor,metadata,resolved_at,fixed_in_release_id)
      values (${id},${org},${project},${pageId},${Number(counted?.n)},${f.kind ?? "bug"},${f.status ?? "open"},'It is broken',${randomUUID()},
      ${anchor ? db().json(anchor) : null},${f.metadata ? db().json(f.metadata) : null},${f.status === "resolved" ? new Date() : null},${f.fixedIn ?? null})`;
    if (f.errors) {
      await db()`insert into diagnostics (feedback_id,console) values (${id},${db().json(f.errors.map((message, i) => ({ level: "error", message, at: i })))})`;
    }
    return id;
  };
  const item = async (id: string) => (await db()`select * from feedback where id = ${id}`)[0] as Json;
  const detect = (id: string, org = orgA) => withOrg(org, () => regression.detectRegression(org, id));
  const patch = (id: string, body: Json) => request(`/api/feedback/${id}`, { method: "PATCH", body });
  const eventsOf = (type: string, feedbackId?: string) =>
    effects.enqueue.mock.calls
      .map((c) => c[1] as Json)
      .filter((e) => e.type === type && (!feedbackId || e.feedbackId === feedbackId));
  const setProject = (s: { detect?: boolean; reopen?: boolean }) =>
    db()`update project set detect_regressions = ${s.detect ?? true}, auto_reopen_regressions = ${s.reopen ?? false} where id = ${ids.projectA}`;

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
      [editor, orgA, "member"],
      [outsider, orgB, "owner"],
    ] as const) {
      await d`insert into "user" (id,name,email,email_verified) values (${user},${user},${`${user}@test.invalid`},true)`;
      await d`insert into account (id,account_id,provider_id,user_id,password) values (${randomUUID()},${user},'credential',${user},${hashed})`;
      await d`insert into member (id,organization_id,user_id,role) values (${randomUUID()},${org},${user},${role})`;
    }
    for (const [org, project, key] of [
      [orgA, ids.projectA, ids.keyA],
      [orgB, ids.projectB, `pk_${randomUUID().replaceAll("-", "")}`],
    ] as const) {
      await d`insert into project (id,org_id,name,slug,public_key,allowed_origins,identity_secret,action_secret) values (${project},${org},'P',${org},${key},${d.array(["https://customer.test"])},${randomUUID()},${randomUUID()})`;
    }
    api = (await import("./index")).app;
    regression = await import("./services/regression");
    dispatch = await import("./jobs/dispatch");
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
  beforeEach(async () => {
    await db()`update feedback set fixed_in_release_id = null, regression_of_id = null where org_id in (${orgA},${orgB})`;
    await db()`delete from feedback where org_id in (${orgA},${orgB})`;
    await db()`delete from page where org_id in (${orgA},${orgB})`;
    await db()`delete from project_release where org_id in (${orgA},${orgB})`;
    await db()`update project set feedback_counter = 0 where id in (${ids.projectA},${ids.projectB})`;
    await db()`delete from notification where org_id = ${orgA}`;
    await setProject({});
    effects.enqueue.mockReset().mockResolvedValue(undefined);
    effects.publish.mockReset().mockResolvedValue(undefined);
    effects.wanting.mockReset();
  });
  afterAll(async () => {
    if (fixture) {
      await closeIdentityDatabase();
      await getRuntimeDb().$client.end();
      await fixture.dispose();
    }
    vi.unstubAllEnvs();
  });

  describe("releases", () => {
    it("records, lists, corrects and deletes a release", async () => {
      const created = await request(`/api/projects/${ids.projectA}/releases`, {
        method: "POST",
        body: {
          version: "v1.4.0",
          commit: "9f2c1ab",
          notes: "Checkout fixes",
          deployedAt: "2026-11-01T10:00:00Z",
        },
      });
      expect(created.status).toBe(201);
      const first = (await json(created)).release as Json;
      expect(first).toMatchObject({
        version: "v1.4.0",
        commit: "9f2c1ab",
        fixedCount: 0,
        regressionCount: 0,
      });

      // Posting the same version again (a CI re-run, other casing) updates the one release.
      const again = await request(`/api/projects/${ids.projectA}/releases`, {
        method: "POST",
        body: { version: "V1.4.0", notes: "More notes" },
      });
      expect(again.status).toBe(200);
      const body = await json(again);
      expect(body.created).toBe(false);
      expect(body.release).toMatchObject({ id: first.id, notes: "More notes", commit: "9f2c1ab" });
      expect(await db()`select id from project_release where project_id = ${ids.projectA}`).toHaveLength(1);

      await release("v1.5.0", { deployedAt: "2026-11-08T10:00:00Z" });
      const list = await json(await request(`/api/projects/${ids.projectA}/releases`));
      expect(list.releases.map((r: Json) => r.version)).toEqual(["v1.5.0", "v1.4.0"]);

      const patched = await request(`/api/releases/${first.id}`, { method: "PATCH", body: { notes: null } });
      expect((await json(patched)).release.notes).toBeNull();
      expect((await request(`/api/releases/${first.id}`, { method: "DELETE" })).status).toBe(204);
      expect((await request(`/api/releases/${first.id}`, { method: "DELETE" })).status).toBe(404);
    });

    it("refuses bad versions and other workspaces' projects", async () => {
      const post = (project: string, body: Json) =>
        request(`/api/projects/${project}/releases`, { method: "POST", body });
      expect((await post(ids.projectA, { version: "has space" })).status).toBe(400);
      expect((await post(ids.projectA, { version: "" })).status).toBe(400);
      expect((await post(ids.projectA, { version: "1.0", commit: "bad commit!" })).status).toBe(400);
      expect((await post(ids.projectB, { version: "1.0.0" })).status).toBe(404);
      expect((await request(`/api/projects/${ids.projectB}/releases`)).status).toBe(404);
      expect(await db()`select id from project_release where org_id = ${orgB}`).toHaveLength(0);
    });

    it("lets CI record a release with a releases:write token, and nothing else", async () => {
      const mint = async (scopes: string[]) => {
        const response = await request("/api/tokens", { method: "POST", body: { name: "ci", scopes } });
        expect(response.status).toBe(201);
        return (await json(response)).secret as string;
      };
      const ci = await mint(["releases:write", "feedback:read"]);
      const readOnly = await mint(["feedback:read"]);
      const post = (token: string, project: string, body: Json) =>
        request(`/api/v1/projects/${project}/releases`, { method: "POST", token, body });

      const ok = await post(ci, ids.projectA, { version: "2026.11.10", commit: "abc1234" });
      expect(ok.status).toBe(201);
      expect((await json(ok)).release).toMatchObject({ version: "2026.11.10", commit: "abc1234" });
      expect((await post(readOnly, ids.projectA, { version: "9.9.9" })).status).toBe(403);
      expect((await post(ci, ids.projectB, { version: "9.9.9" })).status).toBe(404);
      const read = await request(`/api/v1/projects/${ids.projectA}/releases`, { token: readOnly });
      expect((await json(read)).releases).toHaveLength(1);
      expect((await request(`/api/v1/projects/${ids.projectB}/releases`, { token: ci })).status).toBe(404);
    });

    it("a viewer reads releases but cannot record them", async () => {
      await db()`update member set role = 'viewer' where user_id = ${owner}`;
      try {
        expect((await request(`/api/projects/${ids.projectA}/releases`)).status).toBe(200);
        const denied = await request(`/api/projects/${ids.projectA}/releases`, {
          method: "POST",
          body: { version: "1.0.0" },
        });
        expect(denied.status).toBe(403);
      } finally {
        await db()`update member set role = 'owner' where user_id = ${owner}`;
      }
    });
  });

  describe("fixed in", () => {
    it("marks a resolved item fixed in a release and shows it in the detail, the timeline and the list", async () => {
      const r = await release("1.4.0");
      const id = await newItem();
      const ok = await patch(id, { status: "resolved", fixedInReleaseId: r.id });
      expect(ok.status).toBe(200);
      expect((await item(id)).fixed_in_release_id).toBe(r.id);

      const detail = await json(await request(`/api/feedback/${id}`));
      expect(detail.feedback.fixedInRelease).toMatchObject({ id: r.id, version: "1.4.0" });
      const row = detail.activity.find((a: Json) => a.type === "fixedIn_changed");
      expect(row.data).toMatchObject({
        from: { version: null, next: false },
        to: { version: "1.4.0", next: false },
      });

      const list = await json(await request(`/api/feedback?status=all&fixedInReleaseId=${r.id}`));
      expect(list.items.map((i: Json) => i.id)).toEqual([id]);
      expect(list.items[0]).toMatchObject({ fixedInVersion: "1.4.0", fixedInReleaseId: r.id });
      expect(
        (await json(await request(`/api/projects/${ids.projectA}/releases`))).releases[0].fixedCount,
      ).toBe(1);
      // The status change event carries the fix: webhooks and the reporter email read it after commit.
      expect(eventsOf("feedback.status_changed", id)).toHaveLength(1);
    });

    it("only a resolved item can be fixed in a release, and only in its own project's", async () => {
      const r = await release("1.4.0");
      await db()`insert into project_release (org_id,project_id,version) values (${orgB},${ids.projectB},'7.0.0')`;
      const [other] = await db()`select id from project_release where org_id = ${orgB}`;

      const open = await newItem();
      const needs = await patch(open, { fixedInReleaseId: r.id });
      expect(needs.status).toBe(400);
      expect((await json(needs)).code).toBe("FIXED_IN_NEEDS_RESOLVED");
      expect((await patch(open, { fixedInNextRelease: true })).status).toBe(400);

      const resolved = await newItem({ status: "resolved" });
      expect((await patch(resolved, { fixedInReleaseId: other?.id })).status).toBe(400);
      expect((await patch(resolved, { fixedInReleaseId: randomUUID() })).status).toBe(400);
      expect((await patch(resolved, { fixedInReleaseId: r.id, fixedInNextRelease: true })).status).toBe(400);
      expect((await item(resolved)).fixed_in_release_id).toBeNull();
      expect((await patch(resolved, { fixedInReleaseId: r.id })).status).toBe(200);
      // Clearing it leaves the item resolved.
      expect((await patch(resolved, { fixedInReleaseId: null })).status).toBe(200);
      expect(await item(resolved)).toMatchObject({ status: "resolved", fixed_in_release_id: null });
    });

    it("reopening an item drops its fix; so does the widget, a rule and a tracker closing", async () => {
      const r = await release("1.4.0");
      const id = await newItem();
      await patch(id, { status: "resolved", fixedInReleaseId: r.id });
      expect((await item(id)).fixed_in_release_id).toBe(r.id);
      await patch(id, { status: "open" });
      expect(await item(id)).toMatchObject({
        status: "open",
        fixed_in_release_id: null,
        fixed_in_next_release: false,
      });

      await patch(id, { status: "resolved", fixedInNextRelease: true });
      expect(await item(id)).toMatchObject({ fixed_in_next_release: true, fixed_in_release_id: null });
      await patch(id, { status: "wont_fix" });
      expect(await item(id)).toMatchObject({ fixed_in_next_release: false });
    });

    it('"next release" becomes the next release that is recorded', async () => {
      await release("1.4.0");
      const id = await newItem();
      const later = await newItem({ status: "resolved" });
      await patch(id, { status: "resolved", fixedInNextRelease: true });
      expect(await item(id)).toMatchObject({ fixed_in_next_release: true });
      const detail = await json(await request(`/api/feedback/${id}`));
      expect(detail.feedback.fixedInRelease).toBeNull();
      expect(detail.feedback.fixedInNextRelease).toBe(true);

      const created = await request(`/api/projects/${ids.projectA}/releases`, {
        method: "POST",
        body: { version: "1.5.0" },
      });
      expect((await json(created)).adopted).toBe(1);
      const after = await item(id);
      expect(after.fixed_in_next_release).toBe(false);
      const [r] = await db()`select id from project_release where version = '1.5.0'`;
      expect(after.fixed_in_release_id).toBe(r?.id);
      expect((await item(later)).fixed_in_release_id).toBeNull();
      const rows =
        await db()`select data, actor_kind from activity where feedback_id = ${id} and type = 'fixedIn_changed'`;
      expect(rows.map((x) => x.data)).toContainEqual({
        from: { version: null, next: true },
        to: { version: "1.5.0", next: false },
        via: "release",
      });
      expect(eventsOf("feedback.updated", id).length).toBeGreaterThan(0);
    });

    it("deleting a release clears the link but keeps the items resolved", async () => {
      const r = await release("1.4.0");
      const id = await newItem();
      await patch(id, { status: "resolved", fixedInReleaseId: r.id });
      expect((await request(`/api/releases/${r.id}`, { method: "DELETE" })).status).toBe(204);
      expect(await item(id)).toMatchObject({ status: "resolved", fixed_in_release_id: null });
    });

    it("tells the reporter which release fixed their report", async () => {
      const r = await release("1.4.0");
      const id = await newItem();
      await db()`update feedback set reporter_guest = ${db().json({ name: "Dana", email: "dana@example.com" })} where id = ${id}`;
      await patch(id, { status: "resolved", fixedInReleaseId: r.id });
      const event = {
        id: randomUUID(),
        type: "feedback.status_changed" as const,
        orgId: orgA,
        feedbackId: id,
        actor: { kind: "user" as const, id: owner },
        changes: { status: { from: "open", to: "resolved" } },
        at: new Date().toISOString(),
      };
      await dispatch.dispatchEvent(event);
      const mails = effects.enqueue.mock.calls
        .map((c) => c[1] as Json)
        .filter((m) => m.to === "dana@example.com");
      expect(mails).toHaveLength(1);
      expect(mails[0]?.text).toContain("Fixed in 1.4.0.");
      expect(mails[0]?.html).toContain("Fixed in 1.4.0.");
    });

    it("the guest portal shows the release that fixed the report", async () => {
      const r = await release("1.4.0");
      const id = await newItem();
      const token = randomUUID();
      const { createHash } = await import("node:crypto");
      await db()`update feedback set reporter_token_hash = ${createHash("sha256").update(token).digest("hex")} where id = ${id}`;
      await patch(id, { status: "resolved", fixedInReleaseId: r.id });
      const headers = { "x-pinwren-reporter-tokens": token };
      const portal = await api.request(`http://localhost:3100/api/guest/${ids.keyA}/feedback/${id}`, {
        headers: new Headers({ origin: "http://localhost:3100", ...headers }),
      });
      expect(portal.status).toBe(200);
      const view = await json(portal);
      expect(view.item).toMatchObject({
        status: "resolved",
        fixedInVersion: "1.4.0",
        fixedInNextRelease: false,
      });
      // Nothing else about the release leaks: no notes, commit or ids.
      expect(JSON.stringify(view)).not.toContain(r.id);
    });
  });

  describe("regression detection", () => {
    const checkout = "https://shop.test/checkout";

    it("flags a new report on the same element and page as a resolved bug, with timeline rows on both", async () => {
      const original = await newItem({ status: "resolved", page: checkout, css: "main > button.pay" });
      const fresh = await newItem({ page: `${checkout}/?utm=x#top`, css: "main > button.pay" });
      const out = await detect(fresh);
      expect(out?.of.id).toBe(original);
      expect(out?.match).toMatchObject({ confidence: "possible", signals: ["element"] });

      expect(await item(fresh)).toMatchObject({
        regression_of_id: original,
        regression_confidence: "possible",
        sig_path: "/checkout",
        sig_anchor: "css:main > button.pay",
      });
      const onFresh =
        await db()`select type, actor_kind, data from activity where feedback_id = ${fresh} and type = 'regression_detected'`;
      expect(onFresh).toHaveLength(1);
      expect(onFresh[0]?.actor_kind).toBe("system");
      expect((onFresh[0]?.data as Json).of.id).toBe(original);
      const onOriginal =
        await db()`select data from activity where feedback_id = ${original} and type = 'regression_reported'`;
      expect(onOriginal).toHaveLength(1);
      // The original stays resolved: reopening is opt-in.
      expect((await item(original)).status).toBe("resolved");

      const ev = eventsOf("feedback.regression_detected", fresh);
      expect(ev).toHaveLength(1);
      expect(ev[0]?.changes.regressionOf.to).toMatchObject({ id: original, confidence: "possible" });

      // Looking again changes nothing: one flag, one pair of timeline rows, one event.
      expect(await detect(fresh)).toBeNull();
      expect(
        await db()`select id from activity where feedback_id = ${fresh} and type = 'regression_detected'`,
      ).toHaveLength(1);
      expect(eventsOf("feedback.regression_detected", fresh)).toHaveLength(1);

      const detail = await json(await request(`/api/feedback/${fresh}`));
      expect(detail.feedback.regressionOf).toMatchObject({ id: original, signals: ["element"] });
      const back = await json(await request(`/api/feedback/${original}`));
      expect(back.regressions.map((r: Json) => r.id)).toEqual([fresh]);
    });

    it("flags a report that shares a console error, whichever page it is on", async () => {
      const original = await newItem({
        status: "resolved",
        page: "https://shop.test/cart",
        errors: [
          "TypeError: Cannot read properties of undefined (reading 'total') at https://shop.test/app.1a2b3c.js:10:5",
        ],
      });
      const fresh = await newItem({
        page: "https://shop.test/account",
        errors: [
          "Uncaught TypeError: Cannot read properties of undefined (reading 'total') at https://shop.test/app.9f8e7d.js:99:1",
        ],
      });
      const out = await detect(fresh);
      expect(out?.of.id).toBe(original);
      expect(out?.match.signals).toEqual(["error"]);
      // A different error on the same page is not a regression.
      const unrelated = await newItem({
        page: "https://shop.test/cart",
        errors: ["RangeError: Invalid array length in render"],
      });
      expect(await detect(unrelated)).toBeNull();
    });

    it("uses the release: a report from the fixed release or later is likely, an older one is not flagged", async () => {
      const fixedIn = await release("1.4.0");
      const error = "ReferenceError: couponCode is not defined in checkout";
      const original = await newItem({
        status: "resolved",
        page: checkout,
        errors: [error],
        fixedIn: fixedIn.id,
      });

      const old = await newItem({
        page: "https://shop.test/other",
        errors: [error],
        metadata: { release: "1.3.2" },
      });
      expect(await detect(old)).toBeNull();
      expect((await item(old)).regression_of_id).toBeNull();

      const later = await newItem({
        page: "https://shop.test/other",
        errors: [error],
        metadata: { release: "1.4.1" },
      });
      const out = await detect(later);
      expect(out?.of.id).toBe(original);
      expect(out?.match).toMatchObject({ confidence: "likely", afterFix: true });
      expect((await item(later)).regression_signals).toMatchObject({
        reportedRelease: "1.4.1",
        fixedInVersion: "1.4.0",
        afterFix: true,
        source: "detector",
      });
      // The release list counts the regression reported from it.
      await release("1.4.1");
      const list = (await json(await request(`/api/projects/${ids.projectA}/releases`))).releases as Json[];
      expect(list.find((r) => r.version === "1.4.1")?.regressionCount).toBe(1);
      expect(list.find((r) => r.version === "1.4.0")?.fixedCount).toBe(1);
    });

    it("reopens the original only when the project asks for it", async () => {
      await setProject({ reopen: true });
      const r = await release("1.4.0");
      const original = await newItem({
        status: "resolved",
        page: checkout,
        css: "main > button.pay",
        fixedIn: r.id,
      });
      const fresh = await newItem({
        page: checkout,
        css: "main > button.pay",
        metadata: { release: "1.4.2" },
      });
      const out = await detect(fresh);
      expect(out?.reopened).toBe(true);
      expect(await item(original)).toMatchObject({
        status: "open",
        resolved_at: null,
        fixed_in_release_id: null,
      });
      const rows =
        await db()`select type, actor_kind, data from activity where feedback_id = ${original} order by type`;
      expect(rows.map((x) => x.type)).toEqual(["regression_reported", "status_changed"]);
      const status = rows.find((x) => x.type === "status_changed");
      expect(status?.data).toMatchObject({ from: "resolved", to: "open", via: "regression" });
      expect(status?.actor_kind).toBe("system");
      expect(eventsOf("feedback.status_changed", original)).toHaveLength(1);
    });

    it("does nothing when detection is off, but remembers the report's signals for later", async () => {
      await setProject({ detect: false });
      const original = await newItem({ status: "resolved", page: checkout, css: "main > button.pay" });
      const fresh = await newItem({ page: checkout, css: "main > button.pay" });
      expect(await detect(fresh)).toBeNull();
      expect(await item(fresh)).toMatchObject({
        regression_of_id: null,
        sig_anchor: "css:main > button.pay",
      });
      expect((await item(original)).status).toBe("resolved");
      expect(eventsOf("feedback.regression_detected")).toHaveLength(0);
    });

    it("only compares bugs, resolved items and live items of the same project and workspace", async () => {
      const css = "main > button.pay";
      await newItem({ status: "resolved", page: checkout, css, kind: "idea" });
      await newItem({ status: "wont_fix", page: checkout, css });
      await newItem({ status: "open", page: checkout, css });
      const trashed = await newItem({ status: "resolved", page: checkout, css });
      await db()`update feedback set deleted_at = now() where id = ${trashed}`;
      // The same page and element, resolved, in another workspace.
      await newItem({ status: "resolved", page: checkout, css, project: ids.projectB, org: orgB });
      const comment = await newItem({ kind: "comment", page: checkout, css });
      const fresh = await newItem({ page: checkout, css });
      expect(await detect(fresh)).toBeNull();
      expect(await detect(comment)).toBeNull();
      expect((await item(fresh)).regression_of_id).toBeNull();
    });

    it("signs resolved bugs that predate the signature columns", async () => {
      const original = await newItem({ status: "resolved", page: checkout, css: "main > button.pay" });
      expect((await item(original)).sig_errors).toBeNull();
      const fresh = await newItem({ page: checkout, css: "main > button.pay" });
      expect((await detect(fresh))?.of.id).toBe(original);
      expect((await item(original)).sig_errors).toEqual([]);
    });

    it("the dispatcher detects, announces and notifies the people who followed the original", async () => {
      const original = await newItem({ status: "resolved", page: checkout, css: "main > button.pay" });
      await db()`update feedback set assignee_ids = ${db().array([editor])} where id = ${original}`;
      const fresh = await newItem({ page: checkout, css: "main > button.pay" });
      await dispatch.dispatchEvent({
        id: randomUUID(),
        type: "feedback.created",
        orgId: orgA,
        feedbackId: fresh,
        actor: { kind: "guest", id: null },
        at: new Date().toISOString(),
      });
      expect((await item(fresh)).regression_of_id).toBe(original);
      const [event] = eventsOf("feedback.regression_detected", fresh);
      expect(event).toBeDefined();

      effects.wanting.mockReset();
      await dispatch.dispatchEvent(event as never);
      // The people who followed the original (its assignee) hear first, under the status-changes switch.
      expect(effects.wanting).toHaveBeenCalledWith(orgA, ids.projectA, "statusChanges", [editor]);
      const rows =
        await db()`select user_id, type, data from notification where org_id = ${orgA} and type = 'feedback.regression_detected'`;
      expect(rows.map((r) => r.user_id)).toEqual([editor]);
      expect(rows[0]?.data).toMatchObject({ originalNumber: (await item(original)).number });
      // The automation engine hears about it too, through its own queue.
      const { QUEUES } = await import("./jobs/boss");
      expect(
        effects.enqueue.mock.calls.some(
          (c) => c[0] === QUEUES.automation && (c[1] as Json).type === "feedback.regression_detected",
        ),
      ).toBe(true);
    });

    it("a rule can run on a detected regression", async () => {
      const engine = await import("./services/automation-engine");
      const created = await request(`/api/projects/${ids.projectA}/automations`, {
        method: "POST",
        body: {
          name: "Regressions are urgent",
          trigger: { event: "regression_detected" },
          actions: [{ type: "set_priority", priority: "urgent" }],
        },
      });
      expect(created.status).toBe(201);
      await newItem({ status: "resolved", page: checkout, css: "main > button.pay" });
      const fresh = await newItem({ page: checkout, css: "main > button.pay" });
      await detect(fresh);
      const [event] = eventsOf("feedback.regression_detected", fresh);
      expect(engine.wantsAutomation(event as never)).toBe(true);
      expect(await engine.runAutomations(event as never)).toBe(1);
      expect((await item(fresh)).priority).toBe("urgent");
      await db()`delete from automation_rule where org_id = ${orgA}`;
    });

    it("the inbox can filter regressions, and the stats count only this workspace's", async () => {
      const original = await newItem({ status: "resolved", page: checkout, css: "main > button.pay" });
      const fresh = await newItem({ page: checkout, css: "main > button.pay" });
      await detect(fresh);
      await release("1.4.0");
      const only = await json(await request("/api/feedback?status=all&regression=true"));
      expect(only.items.map((i: Json) => i.id)).toEqual([fresh]);
      expect(only.items[0]).toMatchObject({ regressionOfId: original, regressionConfidence: "possible" });
      const none = await json(await request("/api/feedback?status=all&regression=false"));
      expect(none.items.map((i: Json) => i.id)).not.toContain(fresh);

      const stats = await json(await request(`/api/stats?days=7`));
      expect(stats.regressions).toMatchObject({ total: 1, open: 1 });
      expect(stats.regressions.items[0]).toMatchObject({ id: fresh, ofId: original, confidence: "possible" });
      expect(stats.releases.map((r: Json) => r.version)).toEqual(["1.4.0"]);

      // Workspace B's identical situation never shows up in A's numbers, nor A's in B's.
      await db()`insert into project_release (org_id,project_id,version) values (${orgB},${ids.projectB},'B-only')`;
      const foreign = await json(await request(`/api/stats?days=7&projectId=${ids.projectB}`));
      expect(foreign.regressions.total).toBe(0);
      expect(foreign.releases).toEqual([]);
    });
  });
});
