import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { afterOrgCommit, currentOrgId, getDb, project } from "../../db/src";
import { getRuntimeDb } from "../../db/src/connection";
import { createCloudFixture } from "./test-helpers/cloud-fixture";
import { tenantRequestScope } from "./tenant-scope";

describe.skipIf(!process.env.PINWREN_ISOLATION_ADMIN_URL)("Hono tenant transaction boundaries", () => {
  let fixture: Awaited<ReturnType<typeof createCloudFixture>> | undefined;
  const database = () => {
    if (!fixture) throw new Error("Cloud fixture is not ready");
    return fixture.db;
  };
  const org = `request-org-${randomUUID()}`;
  beforeAll(async () => {
    fixture = await createCloudFixture();
    vi.stubEnv("DATABASE_URL", fixture.runtimeUrl);
    vi.stubEnv("PINWREN_SERVICE_DATABASE_URL", fixture.serviceUrl);
    vi.stubEnv("PINWREN_MODE", "cloud");
    vi.stubEnv("PINWREN_URL", "http://localhost:3100");
    vi.stubEnv("PINWREN_SECRET", randomUUID() + randomUUID());
    await fixture.db`insert into organization (id,name,slug) values (${org},${org},${org})`;
  });
  afterAll(async () => {
    if (fixture) {
      await getRuntimeDb().$client.end();
      await fixture.dispose();
    }
    vi.unstubAllEnvs();
  });
  const app = () =>
    new Hono<{ Variables: { orgId: string } }>()
      .use(async (c, next) => {
        c.set("orgId", org);
        await next();
      })
      .use(tenantRequestScope)
      .onError((error, c) => c.json({ error: error.message }, 500));

  async function writeProject(name: string) {
    return getDb().insert(project).values({ orgId: org, name, slug: name, publicKey: name });
  }

  it("establishes verified organization scope for finite handlers and commits before effects", async () => {
    const name = randomUUID();
    const effects: string[] = [];
    const api = app().post("/api/projects", async (c) => {
      expect(currentOrgId()).toBe(org);
      await writeProject(name);
      afterOrgCommit(async () => {
        const rows = await database()`select id from project where name=${name}`;
        effects.push(rows.length === 1 ? "committed" : "missing");
      });
      return c.json({ ok: true });
    });
    expect((await api.request("/api/projects", { method: "POST" })).status).toBe(200);
    await vi.waitFor(() => expect(effects).toEqual(["committed"]));
  });

  it("rolls back writes and effects when Hono translates a thrown error into an HTTP response", async () => {
    const name = randomUUID();
    const effect = vi.fn();
    const api = app().post("/api/projects", async () => {
      await writeProject(name);
      afterOrgCommit(effect);
      throw new Error("handled failure");
    });
    const response = await api.request("/api/projects", { method: "POST" });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "handled failure" });
    expect(await database()`select id from project where name=${name}`).toHaveLength(0);
    expect(effect).not.toHaveBeenCalled();
  });

  it("rolls back writes when a handler returns a failure response", async () => {
    const name = randomUUID();
    const api = app().post("/api/projects", async (c) => {
      await writeProject(name);
      return c.json({ error: "conflict" }, 409);
    });
    expect((await api.request("/api/projects", { method: "POST" })).status).toBe(409);
    expect(await database()`select id from project where name=${name}`).toHaveLength(0);
  });

  it("leaves stream/external handlers outside a transaction and honors the first matching route", async () => {
    const api = app()
      .get("/api/feedback/export", (c) => c.json({ org: currentOrgId() ?? null }))
      .get("/api/feedback/:id", async (c) => {
        await getDb().execute(sql`select 1`);
        return c.json({ org: currentOrgId() });
      });
    expect(await (await api.request("/api/feedback/export")).json()).toEqual({ org: null });
    expect(await (await api.request("/api/feedback/ordinary-id")).json()).toEqual({ org });
    const external = app().get("/api/assets/:id", (c) => c.json({ org: currentOrgId() ?? null }));
    expect(await (await external.request("/api/assets/id")).json()).toEqual({ org: null });
  });

  it("supports HEAD and fails closed for an unclassified resource handler", async () => {
    const api = app()
      .get("/api/projects", (c) => c.json({ org: currentOrgId() }))
      .get("/api/unclassified-resource", (c) => c.json({ unsafe: true }));
    expect((await api.request("/api/projects", { method: "HEAD" })).status).toBe(200);
    expect((await api.request("/api/unclassified-resource")).status).toBe(500);
  });
});
