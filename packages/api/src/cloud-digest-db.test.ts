import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { currentOrgId } from "../../db/src";
import { getRuntimeDb } from "../../db/src/connection";
import { closeIdentityDatabase } from "../../db/src/identity";
import { createCloudFixture } from "./test-helpers/cloud-fixture";

const effects = vi.hoisted(() => ({ send: vi.fn(), render: vi.fn() }));
vi.mock("./email/render", () => ({ renderEmail: effects.render }));

describe.skipIf(!process.env.PINWREN_ISOLATION_ADMIN_URL)("Cloud multi-workspace digests", () => {
  let fixture: Awaited<ReturnType<typeof createCloudFixture>> | undefined;
  const orgs = [randomUUID(), randomUUID()] as const;
  const projects = [randomUUID(), randomUUID()] as const;
  const user = randomUUID(),
    paused = randomUUID(),
    nonmember = randomUUID();
  const now = new Date("2026-11-17T10:00:00Z");
  const last = new Date(now.getTime() - 2 * 3_600_000);
  const db = () => {
    if (!fixture) throw new Error("Digest fixture is not ready");
    return fixture.db;
  };
  beforeAll(async () => {
    fixture = await createCloudFixture();
    vi.stubEnv("PINWREN_MODE", "cloud");
    vi.stubEnv("DATABASE_URL", fixture.runtimeUrl);
    vi.stubEnv("PINWREN_SERVICE_DATABASE_URL", fixture.serviceUrl);
    vi.stubEnv("PINWREN_URL", "http://localhost:3100");
    vi.stubEnv("PINWREN_SECRET", randomUUID() + randomUUID());
    vi.stubGlobal("__pinwrenBoss", Promise.resolve({ send: effects.send }));
    for (const id of [user, paused, nonmember]) {
      await db()`insert into "user" (id,name,email) values (${id},'Member',${`${id}@test.invalid`})`;
      await db()`insert into user_preference (user_id,email_digest,email_paused,last_digest_at) values (${id},'hourly',${id === paused},${last})`;
    }
    for (const [i, org] of orgs.entries()) {
      const project = projects[i];
      if (!project) throw new Error("Missing project");
      await db()`insert into organization (id,name,slug) values (${org},${org},${org})`;
      await db()`insert into project (id,org_id,name,slug,public_key,allowed_origins,identity_secret,action_secret) values (${project},${org},'Project',${project},${randomUUID()},${db().array(["https://example.test"])},${randomUUID()},${randomUUID()})`;
      for (const id of [user, paused])
        await db()`insert into member (id,organization_id,user_id,role) values (${randomUUID()},${org},${id},'owner')`;
    }
  }, 120_000);
  beforeEach(async () => {
    effects.send.mockReset().mockResolvedValue(randomUUID());
    effects.render
      .mockReset()
      .mockImplementation((org: string, _key: string, vars: Record<string, string>) => {
        expect(currentOrgId()).toBe(org);
        return Promise.resolve({
          orgId: org,
          templateKey: "digest",
          subject: org,
          html: vars.summary,
          text: vars.summary,
        });
      });
    await db()`delete from notification`;
    await db()`delete from notification_preference`;
    await db()`update user_preference set last_digest_at=${last},email_digest='hourly',email_paused=(user_id=${paused})`;
    for (const [i, org] of orgs.entries()) {
      for (const id of [user, paused, nonmember]) {
        const data = {
          title: `Private ${org}`,
          projectId: projects[i] ?? "",
          projectName: org,
          number: 1,
          kind: "bug",
        };
        await db()`insert into notification (org_id,user_id,type,data,created_at) values (${org},${id},'feedback.created',${db().json(data)},${new Date(now.getTime() - 60_000)})`;
      }
    }
  });
  afterAll(async () => {
    if (fixture) {
      await getRuntimeDb().$client.end();
      await closeIdentityDatabase();
      await fixture.dispose();
    }
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  const queued = () =>
    effects.send.mock.calls.map((call) => call[1] as { orgId: string; text: string; to: string });
  it("queues each due workspace before advancing a shared account cursor", async () => {
    const { runDigest } = await import("./jobs/digest");
    await runDigest(now);
    expect(queued()).toHaveLength(2);
    expect(new Set(queued().map((message) => message.orgId))).toEqual(new Set(orgs));
    for (const message of queued()) {
      expect(message.to).toBe(`${user}@test.invalid`);
      expect(message.text).toContain(`Private ${message.orgId}`);
      expect(message.text).not.toContain(`Private ${orgs.find((org) => org !== message.orgId) ?? ""}`);
    }
    expect(await db()`select last_digest_at from user_preference where user_id=${user}`).toEqual([
      { last_digest_at: now },
    ]);
    effects.send.mockClear();
    await runDigest(new Date(now.getTime() + 60_000));
    expect(effects.send).not.toHaveBeenCalled();
  });
  it("does not advance a shared cursor if any workspace fails, allowing recovery", async () => {
    const { runDigest } = await import("./jobs/digest");
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    effects.send.mockImplementation((_queue: string, message: { orgId: string }) =>
      message.orgId === orgs[1]
        ? Promise.reject(new Error("Queue unavailable"))
        : Promise.resolve(randomUUID()),
    );
    try {
      await runDigest(now);
      expect(await db()`select last_digest_at from user_preference where user_id=${user}`).toEqual([
        { last_digest_at: last },
      ]);
      effects.send.mockReset().mockResolvedValue(randomUUID());
      await runDigest(now);
      expect(queued()).toHaveLength(2);
    } finally {
      log.mockRestore();
    }
  });
  it("filters tenant notifications and project mutes even with RLS disabled", async () => {
    await db()`insert into notification_preference (org_id,user_id,project_id,email) values (${orgs[0]},${user},${projects[0]},false)`;
    for (const table of ["notification", "feedback", "notification_preference"])
      await db().unsafe(`alter table ${table} disable row level security`);
    try {
      const { runDigest } = await import("./jobs/digest");
      await runDigest(now);
      expect(queued()).toHaveLength(1);
      expect(queued()[0]).toMatchObject({ orgId: orgs[1], to: `${user}@test.invalid` });
      expect(queued()[0]?.text).not.toContain(orgs[0]);
    } finally {
      for (const table of ["notification", "feedback", "notification_preference"])
        await db().unsafe(`alter table ${table} enable row level security`);
    }
  });
  it("uses the run cutoff and advances empty workspaces without dropping later notifications", async () => {
    await db()`update notification set created_at=${new Date(now.getTime() + 60_000)} where org_id=${orgs[1]}`;
    const { runDigest } = await import("./jobs/digest");
    await runDigest(now);
    expect(queued().map((message) => message.orgId)).toEqual([orgs[0]]);
    effects.send.mockClear();
    await runDigest(new Date(now.getTime() + 3_600_000));
    expect(queued().map((message) => message.orgId)).toEqual([orgs[1]]);
  });
  it("rechecks membership after recipient snapshot collection", async () => {
    const { runDigest } = await import("./jobs/digest");
    let revoked: string | undefined;
    effects.render.mockImplementation(async (org: string, _key: string, vars: Record<string, string>) => {
      expect(currentOrgId()).toBe(org);
      revoked = orgs.find((value) => value !== org);
      if (!revoked) throw new Error("Missing second workspace");
      await db()`delete from member where organization_id=${revoked} and user_id=${user}`;
      return { orgId: org, templateKey: "digest", subject: org, html: vars.summary, text: vars.summary };
    });
    try {
      await runDigest(now);
      expect(queued()).toHaveLength(1);
      expect(queued()[0]?.orgId).not.toBe(revoked);
    } finally {
      if (revoked)
        await db()`insert into member (id,organization_id,user_id,role) values (${randomUUID()},${revoked},${user},'owner')`;
    }
  });
  it("never moves the shared cursor backwards for an older overlapping run", async () => {
    const { markDigestSent } = await import("./db/system");
    const later = new Date(now.getTime() + 3_600_000);
    await markDigestSent(user, later);
    await markDigestSent(user, now);
    expect(await db()`select last_digest_at from user_preference where user_id=${user}`).toEqual([
      { last_digest_at: later },
    ]);
  });
  it("rejects global digest work inside a tenant transaction", async () => {
    const { runDigest } = await import("./jobs/digest");
    const { withOrg } = await import("../../db/src");
    await expect(withOrg(orgs[0], () => runDigest(now))).rejects.toThrow(/outside.*tenant/);
    const { enqueueRequired, QUEUES } = await import("./jobs/boss");
    await expect(withOrg(orgs[0], () => enqueueRequired(QUEUES.email, {}))).rejects.toThrow(
      /outside.*tenant/,
    );
    expect(effects.send).not.toHaveBeenCalled();
    expect(await db()`select last_digest_at from user_preference where user_id=${user}`).toEqual([
      { last_digest_at: last },
    ]);
  });
  it("keeps the cursor when the queue does not confirm a persisted job", async () => {
    const { runDigest } = await import("./jobs/digest");
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    effects.send.mockResolvedValue(null);
    try {
      await runDigest(now);
      expect(await db()`select last_digest_at from user_preference where user_id=${user}`).toEqual([
        { last_digest_at: last },
      ]);
    } finally {
      log.mockRestore();
    }
  });
});
