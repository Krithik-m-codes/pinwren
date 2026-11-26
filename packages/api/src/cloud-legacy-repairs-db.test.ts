import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { withOrg } from "../../db/src";
import { getRuntimeDb } from "../../db/src/connection";
import { closeIdentityDatabase } from "../../db/src/identity";
import { createCloudFixture } from "./test-helpers/cloud-fixture";
import { Hono } from "hono";
import type { SessionVars } from "./context";

describe.skipIf(!process.env.PINWREN_ISOLATION_ADMIN_URL)("Cloud legacy startup repairs", () => {
  let fixture: Awaited<ReturnType<typeof createCloudFixture>> | undefined;
  const orgs = [randomUUID(), randomUUID()];
  const projects = [randomUUID(), randomUUID()];
  const canonical = [randomUUID(), randomUUID()];
  const db = () => {
    if (!fixture) throw new Error("Legacy repair fixture is not ready");
    return fixture.db;
  };
  beforeAll(async () => {
    fixture = await createCloudFixture();
    vi.stubEnv("PINWREN_MODE", "cloud");
    vi.stubEnv("DATABASE_URL", fixture.runtimeUrl);
    vi.stubEnv("PINWREN_SERVICE_DATABASE_URL", fixture.serviceUrl);
    vi.stubEnv("PINWREN_URL", "http://localhost:3100");
    vi.stubEnv("PINWREN_SECRET", randomUUID() + randomUUID());
    for (const [i, org] of orgs.entries()) {
      const project = projects[i];
      if (!project) throw new Error("Missing test project");
      await db()`insert into organization (id,name,slug) values (${org},${org},${org})`;
      await db()`insert into project (id,org_id,name,slug,public_key,allowed_origins,identity_secret,action_secret) values (${project},${org},'Project',${project},${randomUUID()},${["https://example.test"]},${randomUUID()},${randomUUID()})`;
      await db()`insert into page (id,org_id,project_id,url) values (${canonical[i] ?? ""},${org},${project},'https://example.test/pricing')`;
      for (const [number, url] of [
        [1, "https://example.test/pricing?utm_source=old"],
        [2, "https://example.test/pricing/"],
      ] as const) {
        const page = randomUUID();
        await db()`insert into page (id,org_id,project_id,url) values (${page},${org},${project},${url})`;
        await db()`insert into feedback (org_id,project_id,page_id,number,kind,body,client_id) values (${org},${project},${page},${number},'bug','Legacy report',${randomUUID()})`;
      }
      for (const kind of ["slack", "discord", "generic"] as const) {
        await db()`insert into webhook_endpoint (org_id,project_id,kind,url) values (${org},${project},${kind},${`https://example.test/${kind}/secret`})`;
      }
    }
  }, 120_000);
  afterAll(async () => {
    if (fixture) {
      await getRuntimeDb().$client.end();
      await closeIdentityDatabase();
      await fixture.dispose();
    }
    vi.unstubAllEnvs();
  });
  it("encrypts legacy chat URLs in every workspace without privileged content reads", async () => {
    const { encryptLegacyChatWebhookUrls } = await import("./webhooks/url");
    const { decryptSecret } = await import("./crypto");
    expect(await encryptLegacyChatWebhookUrls()).toBe(4);
    const rows = await db()<{ kind: string; url: string }[]>`select kind,url from webhook_endpoint`;
    for (const row of rows) {
      if (row.kind === "generic") expect(row.url).toBe("https://example.test/generic/secret");
      else expect(decryptSecret(row.url)).toBe(`https://example.test/${row.kind}/secret`);
    }
    expect(await encryptLegacyChatWebhookUrls()).toBe(0);
  });
  it("merges each workspace's pages atomically and preserves report ownership on reruns", async () => {
    const { mergeStalePages } = await import("./services/page-merge");
    expect(await mergeStalePages()).toBe(4);
    for (const [i, org] of orgs.entries()) {
      expect(await db()`select id from page where org_id=${org}`).toEqual([{ id: canonical[i] }]);
      expect(await db()`select distinct page_id from feedback where org_id=${org}`).toEqual([
        { page_id: canonical[i] },
      ]);
    }
    expect(await mergeStalePages()).toBe(0);
  });
  it("does not accept another workspace's project for an on-demand merge", async () => {
    const { mergeProjectPages } = await import("./services/page-merge");
    const id = randomUUID();
    await db()`insert into page (id,org_id,project_id,url) values (${id},${orgs[1] ?? ""},${projects[1] ?? ""},'https://example.test/pricing?utm_source=foreign')`;
    for (const table of ["page", "project", "feedback"])
      await db().unsafe(`alter table ${table} disable row level security`);
    try {
      expect(await withOrg(orgs[0] ?? "", () => mergeProjectPages(projects[1] ?? ""))).toBe(0);
      expect(await db()`select id from page where id=${id}`).toHaveLength(1);
    } finally {
      for (const table of ["page", "project", "feedback"])
        await db().unsafe(`alter table ${table} enable row level security`);
    }
  });
  it("rolls back report moves if a page deletion fails, then recovers on rerun", async () => {
    const { mergeProjectPages } = await import("./services/page-merge");
    const id = randomUUID();
    await db()`insert into page (id,org_id,project_id,url) values (${id},${orgs[0] ?? ""},${projects[0] ?? ""},'https://example.test/pricing?utm_source=rollback')`;
    await db()`insert into feedback (org_id,project_id,page_id,number,kind,body,client_id) values (${orgs[0] ?? ""},${projects[0] ?? ""},${id},3,'bug','Rollback report',${randomUUID()})`;
    await db()`create function reject_legacy_delete() returns trigger language plpgsql as $$ begin raise exception 'repair rejected'; end $$`;
    await db()`create trigger reject_legacy_delete before delete on page for each row execute function reject_legacy_delete()`;
    try {
      await expect(withOrg(orgs[0] ?? "", () => mergeProjectPages(projects[0] ?? ""))).rejects.toThrow();
      expect(await db()`select page_id from feedback where body='Rollback report'`).toEqual([
        { page_id: id },
      ]);
      expect(await db()`select id from page where id=${id}`).toHaveLength(1);
    } finally {
      await db()`drop trigger reject_legacy_delete on page`;
      await db()`drop function reject_legacy_delete()`;
    }
    expect(await withOrg(orgs[0] ?? "", () => mergeProjectPages(projects[0] ?? ""))).toBe(1);
  });
  it("serializes competing repairs and rejects nested global invocation", async () => {
    const { mergeStalePages } = await import("./services/page-merge");
    const { encryptLegacyChatWebhookUrls } = await import("./webhooks/url");
    // The foreign-project test left one valid stale page in workspace B.
    const results = await Promise.all([mergeStalePages(), mergeStalePages()]);
    expect(results.reduce((sum, n) => sum + n, 0)).toBe(1);
    await expect(withOrg(orgs[0] ?? "", () => mergeStalePages())).rejects.toThrow(/outside.*tenant/);
    await expect(withOrg(orgs[0] ?? "", () => encryptLegacyChatWebhookUrls())).rejects.toThrow(
      /outside.*tenant/,
    );
  });
  it("drains a legacy encryption backlog beyond the scheduled-maintenance cap", async () => {
    const { encryptLegacyChatWebhookUrls } = await import("./webhooks/url");
    await encryptLegacyChatWebhookUrls();
    await db()`insert into webhook_endpoint (org_id,kind,url) select ${orgs[0] ?? ""},'slack','https://example.test/legacy/backlog' from generate_series(1,5001)`;
    expect(await encryptLegacyChatWebhookUrls()).toBe(5001);
    expect(
      await db()`select id from webhook_endpoint where kind='slack' and url not like 'v1.%'`,
    ).toHaveLength(0);
    expect(await encryptLegacyChatWebhookUrls()).toBe(0);
  }, 120_000);
  it("establishes a scope for the authenticated regroup route without outer tenant middleware", async () => {
    const { pageLinks } = await import("./routes/page-links");
    const id = randomUUID();
    await db()`insert into page (id,org_id,project_id,url) values (${id},${orgs[0] ?? ""},${projects[0] ?? ""},'https://example.test/pricing?utm_source=route')`;
    // Selfhost requests have authenticated context variables but no Cloud transaction middleware.
    const app = new Hono<{ Variables: SessionVars }>();
    app.use(async (c, next) => {
      c.set("orgId", orgs[0] ?? "");
      c.set("userId", randomUUID());
      c.set("role", "owner");
      await next();
    });
    app.route("/api", pageLinks);
    vi.stubEnv("PINWREN_MODE", "selfhost");
    for (const table of ["page", "project", "feedback"])
      await db().unsafe(`alter table ${table} disable row level security`);
    try {
      const response = await app.request(`/api/projects/${projects[0] ?? ""}/pages/regroup`, {
        method: "POST",
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ merged: 1 });
      expect(await db()`select id from page where id=${id}`).toHaveLength(0);
    } finally {
      vi.stubEnv("PINWREN_MODE", "cloud");
      for (const table of ["page", "project", "feedback"])
        await db().unsafe(`alter table ${table} enable row level security`);
    }
  });
});
