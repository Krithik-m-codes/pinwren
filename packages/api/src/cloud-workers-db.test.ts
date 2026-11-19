import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { currentOrgId, withOrg } from "../../db/src";
import { getRuntimeDb } from "../../db/src/connection";
import { closeIdentityDatabase } from "../../db/src/identity";
import { createCloudFixture } from "./test-helpers/cloud-fixture";

const effects = vi.hoisted(() => ({ publish: vi.fn(), send: vi.fn(), sendAfter: vi.fn() }));
vi.mock("./realtime/bus", () => ({ publish: effects.publish }));

describe.skipIf(!process.env.PINWREN_ISOLATION_ADMIN_URL)("Cloud worker boundaries", () => {
  let fixture: Awaited<ReturnType<typeof createCloudFixture>> | undefined;
  const orgA = randomUUID(),
    orgB = randomUUID();
  const userA = randomUUID(),
    userB = randomUUID();
  const projectA = randomUUID(),
    projectOther = randomUUID(),
    projectB = randomUUID();
  const feedbackA = randomUUID(),
    feedbackOther = randomUUID();
  const db = () => {
    if (!fixture) throw new Error("Cloud worker fixture is not ready");
    return fixture.db;
  };
  beforeAll(async () => {
    fixture = await createCloudFixture();
    vi.stubEnv("PINWREN_MODE", "cloud");
    vi.stubEnv("DATABASE_URL", fixture.runtimeUrl);
    vi.stubEnv("PINWREN_SERVICE_DATABASE_URL", fixture.serviceUrl);
    vi.stubEnv("PINWREN_URL", "http://localhost:3100");
    vi.stubEnv("PINWREN_SECRET", randomUUID() + randomUUID());
    vi.stubGlobal("__pinwrenBoss", Promise.resolve({ send: effects.send, sendAfter: effects.sendAfter }));
    for (const [org, user] of [
      [orgA, userA],
      [orgB, userB],
    ] as const) {
      await db()`insert into organization (id,name,slug) values (${org},${org},${org})`;
      await db()`insert into "user" (id,name,email) values (${user},'Member',${`${user}@test.invalid`})`;
      await db()`insert into member (id,organization_id,user_id,role) values (${randomUUID()},${org},${user},'owner')`;
      await db()`insert into user_preference (user_id,email_paused,email_digest) values (${user},true,'hourly')`;
    }
    for (const [org, project] of [
      [orgA, projectA],
      [orgA, projectOther],
      [orgB, projectB],
    ] as const) {
      await db()`insert into project (id,org_id,name,slug,public_key,allowed_origins,identity_secret,action_secret) values (${project},${org},'Project',${project},${randomUUID()},${db().array(["https://example.test"])},${randomUUID()},${randomUUID()})`;
    }
    for (const [id, project] of [
      [feedbackA, projectA],
      [feedbackOther, projectOther],
    ] as const) {
      await db()`insert into feedback (id,org_id,project_id,number,kind,body,client_id) values (${id},${orgA},${project},1,'bug','Broken button',${randomUUID()})`;
    }
  }, 120_000);
  afterAll(async () => {
    if (fixture) {
      await getRuntimeDb().$client.end();
      await closeIdentityDatabase();
      await fixture.dispose();
    }
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  beforeEach(() => {
    effects.publish.mockReset().mockResolvedValue(undefined);
    effects.send.mockReset().mockResolvedValue(randomUUID());
    effects.sendAfter.mockReset().mockResolvedValue(randomUUID());
  });
  const recipient = () => ({
    userId: userA,
    name: "Member",
    email: `${userA}@test.invalid`,
    wantsEmail: true,
    paused: false,
    digest: "off" as const,
  });
  const message = () => ({
    orgId: orgA,
    eventId: randomUUID(),
    type: "feedback.created",
    feedbackId: feedbackA,
    actorId: null,
    projectId: projectA,
    recipients: [recipient()],
    data: {},
    render: () =>
      Promise.resolve({
        subject: "New report",
        html: "<p>Report</p>",
        text: "Report",
        templateKey: "feedback_created" as const,
        orgId: orgA,
      }),
  });
  it("reads only scoped members and fixed identity preferences under the restricted role", async () => {
    const { membersWanting } = await import("./jobs/notify");
    expect(await withOrg(orgA, () => membersWanting(orgA, projectA, "newFeedback"))).toMatchObject([
      { userId: userA, paused: true, digest: "hourly" },
    ]);
    expect(await withOrg(orgA, () => membersWanting(orgA, projectA, "newFeedback", [userB]))).toEqual([]);
  });
  it("does not publish or enqueue notification effects if the enclosing transaction rolls back", async () => {
    const { notify } = await import("./jobs/notify");
    const input = message();
    await expect(
      withOrg(orgA, async () => {
        await notify(input);
        throw new Error("late dispatch failure");
      }),
    ).rejects.toThrow("late dispatch failure");
    expect(await db()`select id from notification where event_id=${input.eventId}`).toHaveLength(0);
    expect(effects.publish).not.toHaveBeenCalled();
    expect(effects.send).not.toHaveBeenCalled();
  });
  it("delivers successful notification effects only after commit and outside tenant scope", async () => {
    const { notify } = await import("./jobs/notify");
    const scopes: (string | undefined)[] = [];
    effects.publish.mockImplementation(() => {
      scopes.push(currentOrgId());
      return Promise.resolve();
    });
    effects.send.mockImplementation(() => {
      scopes.push(currentOrgId());
      return Promise.resolve(randomUUID());
    });
    await withOrg(orgA, async () => {
      await notify(message());
      expect(effects.publish).not.toHaveBeenCalled();
      expect(effects.send).not.toHaveBeenCalled();
    });
    await vi.waitFor(() => expect(effects.send).toHaveBeenCalledOnce());
    expect(effects.publish).toHaveBeenCalledOnce();
    expect(scopes).toEqual([undefined, undefined]);
  });
  it("drops ordinary and delayed queue jobs on rollback", async () => {
    const { enqueue, enqueueAfter, QUEUES } = await import("./jobs/boss");
    await expect(
      withOrg(orgA, async () => {
        await enqueue(QUEUES.automation, { orgId: orgA });
        await enqueueAfter(QUEUES.webhook, { orgId: orgA }, 60);
        throw new Error("rollback jobs");
      }),
    ).rejects.toThrow("rollback jobs");
    expect(effects.send).not.toHaveBeenCalled();
    expect(effects.sendAfter).not.toHaveBeenCalled();
  });
  it("does not overwrite another project AI state for a forged disabled-project job", async () => {
    const { runAiEnrichmentJob } = await import("./jobs/ai");
    await db()`insert into feedback_ai (feedback_id,org_id,status) values (${feedbackOther},${orgA},'completed')`;
    await runAiEnrichmentJob({ orgId: orgA, projectId: projectA, feedbackId: feedbackOther });
    expect(await db()`select status from feedback_ai where feedback_id=${feedbackOther}`).toMatchObject([
      { status: "completed" },
    ]);
  });
});
