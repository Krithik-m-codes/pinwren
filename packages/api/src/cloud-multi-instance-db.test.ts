import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { PRESENCE_TTL_MS } from "@pinwren/core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createCloudFixture } from "./test-helpers/cloud-fixture";
import { CloudInstance } from "./test-helpers/multi-instance";

describe.skipIf(!process.env.PINWREN_ISOLATION_ADMIN_URL)("Cloud separate-process acceptance", () => {
  let fixture: Awaited<ReturnType<typeof createCloudFixture>> | undefined;
  let first: CloudInstance | undefined, second: CloudInstance | undefined;
  const orgA = randomUUID(),
    orgB = randomUUID();
  const userA = randomUUID(),
    userB = randomUUID(),
    observer = randomUUID();
  const projectA = randomUUID(),
    projectB = randomUUID(),
    projectOther = randomUUID();
  const feedbackA = randomUUID(),
    feedbackB = randomUUID();
  const password = randomUUID(),
    secret = randomUUID() + randomUUID();
  const nameA = `pinwren-multi-a-${randomUUID()}`,
    nameB = `pinwren-multi-b-${randomUUID()}`;
  let cookieA = "",
    cookieB = "",
    cookieObserver = "";
  const db = () => {
    if (!fixture) throw new Error("Multi-instance fixture is not ready");
    return fixture.db;
  };
  const a = () => {
    if (!first) throw new Error("First instance is not ready");
    return first;
  };
  const b = () => {
    if (!second) throw new Error("Second instance is not ready");
    return second;
  };
  function start(name: string) {
    if (!fixture) throw new Error("Fixture is not ready");
    return new CloudInstance(fixture.runtimeUrl, fixture.serviceUrl, secret, name);
  }
  async function signIn(instance: CloudInstance, user: string, org: string) {
    const jar = new Map<string, string>();
    const take = (cookies: string[]) => {
      for (const cookie of cookies) {
        const value = cookie.split(";")[0] ?? "",
          index = value.indexOf("=");
        if (index >= 0) jar.set(value.slice(0, index), value.slice(index + 1));
      }
    };
    const signed = await instance.request("/api/auth/sign-in/email", undefined, {
      email: `${user}@test.invalid`,
      password,
    });
    expect(signed.status).toBe(200);
    take(signed.cookies);
    const serialize = () => [...jar].map(([key, value]) => `${key}=${value}`).join("; ");
    const active = await instance.request("/api/auth/organization/set-active", serialize(), {
      organizationId: org,
    });
    expect(active.status).toBe(200);
    take(active.cookies);
    return serialize();
  }
  const event = (marker: string, orgId = orgA, projectId = projectA, feedbackId = feedbackA) => ({
    op: "event" as const,
    orgId,
    projectId,
    feedbackId,
    marker,
  });
  async function hasMarker(instance: CloudInstance, stream: string, marker: string) {
    return (await instance.events(stream)).some((frame) => frame.data.marker === marker);
  }
  beforeAll(async () => {
    fixture = await createCloudFixture();
    const hashed = await hashPassword(password);
    for (const [org, user, project, feedback] of [
      [orgA, userA, projectA, feedbackA],
      [orgB, userB, projectB, feedbackB],
    ] as const) {
      await db()`insert into organization (id,name,slug) values (${org},${org},${org})`;
      await db()`insert into "user" (id,name,email,email_verified) values (${user},${user},${`${user}@test.invalid`},true)`;
      await db()`insert into account (id,account_id,provider_id,user_id,password) values (${randomUUID()},${user},'credential',${user},${hashed})`;
      await db()`insert into member (id,organization_id,user_id,role) values (${randomUUID()},${org},${user},'owner')`;
      await db()`insert into project (id,org_id,name,slug,public_key) values (${project},${org},${project},${project},${randomUUID()})`;
      await db()`insert into feedback (id,org_id,project_id,number,kind,body,client_id) values (${feedback},${org},${project},1,'bug',${`Private ${org}`},${randomUUID()})`;
    }
    await db()`insert into project (id,org_id,name,slug,public_key) values (${projectOther},${orgA},'Other project',${projectOther},${randomUUID()})`;
    await db()`insert into "user" (id,name,email,email_verified) values (${observer},${observer},${`${observer}@test.invalid`},true)`;
    await db()`insert into account (id,account_id,provider_id,user_id,password) values (${randomUUID()},${observer},'credential',${observer},${hashed})`;
    await db()`insert into member (id,organization_id,user_id,role) values (${randomUUID()},${orgA},${observer},'member')`;
    first = start(nameA);
    second = start(nameB);
    const pids = await Promise.all([a().ready, b().ready]);
    expect(new Set(pids).size).toBe(2);
    expect(pids).not.toContain(process.pid);
    cookieA = await signIn(a(), userA, orgA);
    cookieB = await signIn(b(), userB, orgB);
    cookieObserver = await signIn(b(), observer, orgA);
    for (const [instance, name, cookie, project] of [
      [a(), "a", cookieA, projectA],
      [b(), "a", cookieA, projectA],
      [b(), "b", cookieB, projectB],
      [b(), "observer", cookieObserver, projectA],
      [b(), "other", cookieA, projectOther],
    ] as const) {
      expect((await instance.open(name, `/api/stream?projectIds=${project}`, cookie)).status).toBe(200);
    }
  }, 180_000);
  afterAll(async () => {
    const closed = await Promise.allSettled([first?.close(), second?.close()]);
    try {
      expect(closed.every((result) => result.status === "fulfilled")).toBe(true);
      if (fixture)
        await vi.waitFor(
          async () => {
            const active =
              await db()`select pid from pg_stat_activity where datname=current_database() and application_name in (${nameA},${nameB})`;
            expect(active).toHaveLength(0);
          },
          { timeout: 10_000, interval: 50 },
        );
    } finally {
      if (fixture) {
        // Even a failed cleanup assertion must attempt disposal. Never target another database/process.
        try {
          await db()`select pg_terminate_backend(pid) from pg_stat_activity where datname=current_database() and application_name in (${nameA},${nameB}) and pid<>pg_backend_pid()`;
        } finally {
          await fixture.dispose();
        }
      }
    }
  }, 30_000);

  it("shares authenticated cookies across instances and isolates interleaved tenant reads", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) => {
        const instance = index % 2 ? a() : b();
        return instance.request(
          `/api/feedback/${index % 4 < 2 ? feedbackA : feedbackB}`,
          index % 4 < 2 ? cookieA : cookieB,
        );
      }),
    );
    expect(results.every((result) => result.status === 200)).toBe(true);
    for (const [index, result] of results.entries()) {
      expect(JSON.stringify(result.body)).toContain(`Private ${index % 4 < 2 ? orgA : orgB}`);
      expect(JSON.stringify(result.body)).not.toContain(`Private ${index % 4 < 2 ? orgB : orgA}`);
    }
    expect((await b().request(`/api/feedback/${feedbackA}`, cookieA)).status).toBe(200);
    expect((await a().request(`/api/feedback/${feedbackB}`, cookieA)).status).toBe(404);
    expect((await b().request(`/api/feedback/${feedbackA}`, cookieB)).status).toBe(404);
    expect((await a().open("foreign", `/api/stream?projectIds=${projectB}`, cookieA)).status).toBe(404);
    expect((await b().request("/api/projects")).status).toBe(401);
  });
  it("fans out global event IDs while filtering workspace, project and bell recipient", async () => {
    const marker = randomUUID(),
      id = await a().call(event(marker));
    await vi.waitFor(
      async () => {
        expect(await hasMarker(a(), "a", marker)).toBe(true);
        expect(await hasMarker(b(), "a", marker)).toBe(true);
        expect(await hasMarker(b(), "observer", marker)).toBe(true);
      },
      { timeout: 10_000, interval: 30 },
    );
    for (const [instance, stream] of [
      [a(), "a"],
      [b(), "a"],
      [b(), "observer"],
    ] as const)
      expect((await instance.events(stream)).find((frame) => frame.data.marker === marker)?.id).toBe(id);
    expect(await hasMarker(b(), "b", marker)).toBe(false);
    expect(await hasMarker(b(), "other", marker)).toBe(false);
    const bell = randomUUID();
    await a().call({ op: "bell", orgId: orgA, userId: userA, marker: bell });
    await vi.waitFor(
      async () =>
        expect(
          (await b().events("a")).some(
            (frame) =>
              frame.event === "notification.created" &&
              frame.data.data &&
              typeof frame.data.data === "object" &&
              "marker" in frame.data.data &&
              frame.data.data.marker === bell,
          ),
        ).toBe(true),
      { timeout: 10_000, interval: 30 },
    );
    for (const stream of ["observer", "b"])
      expect((await b().events(stream)).some((frame) => JSON.stringify(frame.data).includes(bell))).toBe(
        false,
      );
  });
  it("propagates authenticated presence and leave without accepting foreign reports", async () => {
    expect((await a().request("/api/presence", cookieA, { feedbackId: feedbackA })).status).toBe(200);
    await vi.waitFor(
      async () =>
        expect(
          (await b().events("a")).some(
            (frame) =>
              frame.event === "presence" &&
              frame.data.feedbackId === feedbackA &&
              JSON.stringify(frame.data.users).includes(userA),
          ),
        ).toBe(true),
      { timeout: 10_000, interval: 30 },
    );
    expect((await b().events("b")).some((frame) => frame.data.feedbackId === feedbackA)).toBe(false);
    expect((await b().request("/api/presence", cookieA, { feedbackId: feedbackB })).status).toBe(404);
    expect((await a().request("/api/presence", cookieA, { feedbackId: null })).status).toBe(200);
    await vi.waitFor(
      async () => {
        const presence = (await b().events("a")).filter(
          (frame) => frame.event === "presence" && frame.data.feedbackId === feedbackA,
        );
        expect(presence.at(-1)?.data.users).toEqual([]);
      },
      { timeout: 10_000, interval: 30 },
    );
  });
  it("replays visible events when an SSE client reconnects on a healthy other process", async () => {
    const firstMarker = randomUUID(),
      after = randomUUID(),
      foreign = randomUUID();
    const id = await a().call(event(firstMarker));
    expect(typeof id).toBe("string");
    await vi.waitFor(async () => expect(await hasMarker(b(), "a", firstMarker)).toBe(true), {
      timeout: 10_000,
      interval: 30,
    });
    await a().call({ op: "close", name: "a" });
    await a().call(event(foreign, orgB, projectB, feedbackB));
    await a().call(event(after));
    await vi.waitFor(async () => expect(await hasMarker(b(), "a", after)).toBe(true), {
      timeout: 10_000,
      interval: 30,
    });
    expect(
      (await b().open("replayed", `/api/stream?projectIds=${projectA}`, cookieA, String(id))).status,
    ).toBe(200);
    await vi.waitFor(async () => expect(await hasMarker(b(), "replayed", after)).toBe(true), {
      timeout: 10_000,
      interval: 30,
    });
    expect(await hasMarker(b(), "replayed", firstMarker)).toBe(false);
    expect(await hasMarker(b(), "replayed", foreign)).toBe(false);
    expect((await a().open("a", `/api/stream?projectIds=${projectA}`, cookieA)).status).toBe(200);
  });
  it("enforces count and amount windows across processes and recovers after expiry", async () => {
    const key = `multi:${orgA}:${randomUUID()}`;
    const counted = await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        (i % 2 ? a() : b()).call({ op: "rate", kind: "consume", key, limit: 20 }),
      ),
    );
    expect(counted.filter(Boolean)).toHaveLength(20);
    expect(await a().call({ op: "rate", kind: "exhausted", key, limit: 20 })).toBe(true);
    expect(await b().call({ op: "rate", kind: "exhausted", key, limit: 20 })).toBe(true);
    expect(
      await b().call({ op: "rate", kind: "consume", key: `multi:${orgB}:${randomUUID()}`, limit: 20 }),
    ).toBe(true);
    await db()`update rate_limit set reset_at=now()-interval '1 second' where key=${key}`;
    expect(await a().call({ op: "rate", kind: "consume", key, limit: 20 })).toBe(true);
    const amountKey = `amount:${randomUUID()}`;
    const amounts = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        (i % 2 ? a() : b()).call({ op: "rate", kind: "amount", key: amountKey, limit: 10, amount: 3 }),
      ),
    );
    expect(amounts.filter(Boolean)).toHaveLength(3);
  });
  it("reestablishes LISTEN after a database listener connection is terminated", async () => {
    const [listener] = await db()<
      { pid: number }[]
    >`select pid from pg_stat_activity where datname=current_database() and application_name=${nameA} and state='idle' and query ilike 'listen%'`;
    expect(listener).toBeDefined();
    if (!listener) throw new Error("Missing first instance listener");
    expect(await db()`select pg_terminate_backend(${listener.pid}) as terminated`).toEqual([
      { terminated: true },
    ]);
    await vi.waitFor(
      async () => {
        const reconnected =
          await db()`select pid from pg_stat_activity where datname=current_database() and application_name=${nameA} and state='idle' and query ilike 'listen%' and pid<>${listener.pid}`;
        expect(reconnected).toHaveLength(1);
      },
      { timeout: 20_000, interval: 100 },
    );
    const marker = randomUUID();
    await b().call(event(marker));
    await vi.waitFor(async () => expect(await hasMarker(a(), "a", marker)).toBe(true), {
      timeout: 10_000,
      interval: 30,
    });
  });
  it("expires presence from a terminated process and serves requests after restart", async () => {
    expect((await a().request("/api/presence", cookieA, { feedbackId: feedbackA })).status).toBe(200);
    await vi.waitFor(
      async () => {
        const presence = (await b().events("a")).filter(
          (frame) => frame.event === "presence" && frame.data.feedbackId === feedbackA,
        );
        expect(JSON.stringify(presence.at(-1)?.data.users)).toContain(userA);
      },
      { timeout: 10_000, interval: 30 },
    );
    await a().close();
    await vi.waitFor(
      async () => {
        const presence = (await b().events("a")).filter(
          (frame) => frame.event === "presence" && frame.data.feedbackId === feedbackA,
        );
        expect(presence.at(-1)?.data.users).toEqual([]);
      },
      { timeout: PRESENCE_TTL_MS + 10_000, interval: 250 },
    );
    first = start(nameA);
    await a().ready;
    expect((await a().request(`/api/feedback/${feedbackA}`, cookieA)).status).toBe(200);
    expect(
      (await a().open("restarted", `/api/stream?projectIds=${projectA}`, cookieA, "unknown-before-restart"))
        .status,
    ).toBe(200);
    const marker = randomUUID();
    await b().call(event(marker));
    await vi.waitFor(async () => expect(await hasMarker(a(), "restarted", marker)).toBe(true), {
      timeout: 10_000,
      interval: 30,
    });
  }, 150_000);
  it("rechecks revoked membership and sessions on either process and SSE reconnect", async () => {
    await db()`delete from member where user_id=${userA} and organization_id=${orgA}`;
    for (const instance of [a(), b()]) {
      expect((await instance.request("/api/projects", cookieA)).status).toBe(403);
      expect((await instance.open(`revoked-${randomUUID()}`, "/api/stream", cookieA)).status).toBe(403);
    }
    await db()`delete from session where user_id=${userB}`;
    for (const instance of [a(), b()]) {
      expect((await instance.request("/api/projects", cookieB)).status).toBe(401);
      expect((await instance.open(`revoked-session-${randomUUID()}`, "/api/stream", cookieB)).status).toBe(
        401,
      );
    }
  });
});
