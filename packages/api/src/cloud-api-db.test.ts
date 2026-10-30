import type * as ApiModule from "./index";
import type * as BossModule from "./jobs/boss";
import type * as BusModule from "./realtime/bus";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from "vitest";
import { currentOrgId } from "../../db/src";
import { getRuntimeDb } from "../../db/src/connection";
import { closeIdentityDatabase } from "../../db/src/identity";
import { createCloudFixture } from "./test-helpers/cloud-fixture";

const effects = vi.hoisted(() => ({
  enqueue: vi.fn<(...args: unknown[]) => Promise<void>>(),
  publish: vi.fn<(...args: unknown[]) => Promise<void>>(),
  subscribe: vi.fn(),
}));
vi.mock("./jobs/boss", async (original) => ({
  ...(await original<typeof BossModule>()),
  enqueue: effects.enqueue,
}));
vi.mock("./realtime/bus", async (original) => ({
  ...(await original<typeof BusModule>()),
  publish: effects.publish,
  subscribe: effects.subscribe,
}));

describe.skipIf(!process.env.PINWREN_ISOLATION_ADMIN_URL)("Cloud authenticated HTTP API isolation", () => {
  let fixture: Awaited<ReturnType<typeof createCloudFixture>> | undefined;
  let api: typeof ApiModule.app;
  const suffix = randomUUID(),
    password = randomUUID();
  const orgA = `api-a-${suffix}`,
    orgB = `api-b-${suffix}`;
  const userA = `user-a-${suffix}`,
    userB = `user-b-${suffix}`;
  const projectA = randomUUID(),
    projectB = randomUUID(),
    feedbackA = randomUUID(),
    feedbackB = randomUUID(),
    assetB = randomUUID();
  const tokenA = `pwt_${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "")}`;
  const tokenB = `pwt_${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "")}`;
  const readToken = `pwt_${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "")}`;
  const cookiesA = new Map<string, string>(),
    cookiesB = new Map<string, string>();
  const queueContexts: (string | undefined)[] = [],
    publishContexts: (string | undefined)[] = [];
  const database = () => {
    if (!fixture) throw new Error("API fixture is not ready");
    return fixture.db;
  };
  function takeCookies(response: Response, jar: Map<string, string>) {
    for (const cookie of response.headers.getSetCookie()) {
      const value = cookie.split(";")[0] ?? "",
        equals = value.indexOf("=");
      if (equals < 0) continue;
      const key = value.slice(0, equals),
        content = value.slice(equals + 1);
      if (content) jar.set(key, content);
      else jar.delete(key);
    }
  }
  function request(
    path: string,
    options: { method?: string; jar?: Map<string, string>; token?: string; body?: unknown } = {},
  ) {
    const headers = new Headers({
      origin: "http://localhost:3100",
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    });
    if (options.jar)
      headers.set("cookie", [...options.jar].map(([key, value]) => `${key}=${value}`).join("; "));
    if (options.token) headers.set("authorization", `Bearer ${options.token}`);
    return api.request(`http://localhost:3100${path}`, {
      method: options.method ?? "GET",
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  }
  async function signIn(user: string, org: string, jar: Map<string, string>) {
    const signed = await request("/api/auth/sign-in/email", {
      method: "POST",
      body: { email: `${user}@test.invalid`, password },
    });
    expect(signed.status).toBe(200);
    takeCookies(signed, jar);
    const active = await request("/api/auth/organization/set-active", {
      method: "POST",
      jar,
      body: { organizationId: org },
    });
    expect(active.status).toBe(200);
    takeCookies(active, jar);
  }
  beforeAll(async () => {
    fixture = await createCloudFixture();
    vi.stubEnv("PINWREN_MODE", "cloud");
    vi.stubEnv("DATABASE_URL", fixture.runtimeUrl);
    vi.stubEnv("PINWREN_SERVICE_DATABASE_URL", fixture.serviceUrl);
    vi.stubEnv("PINWREN_URL", "http://localhost:3100");
    vi.stubEnv("PINWREN_SECRET", randomUUID() + randomUUID());
    vi.stubEnv("PINWREN_DISABLE_SIGNUP", "false");
    vi.stubEnv("PINWREN_ADMIN_EMAILS", undefined);
    const hashed = await hashPassword(password);
    const { hashToken } = await import("./crypto");
    for (const [org, user, projectId, feedbackId, secret] of [
      [orgA, userA, projectA, feedbackA, tokenA],
      [orgB, userB, projectB, feedbackB, tokenB],
    ] as const) {
      await fixture.db`insert into organization (id,name,slug) values (${org},${org},${org})`;
      await fixture.db`insert into "user" (id,name,email,email_verified) values (${user},${user},${`${user}@test.invalid`},true)`;
      await fixture.db`insert into account (id,account_id,provider_id,user_id,password) values (${randomUUID()},${user},'credential',${user},${hashed})`;
      await fixture.db`insert into member (id,organization_id,user_id,role) values (${randomUUID()},${org},${user},'owner')`;
      await fixture.db`insert into project (id,org_id,name,slug,public_key) values (${projectId},${org},${org},${org},${projectId})`;
      await fixture.db`insert into feedback (id,org_id,project_id,number,kind,body,client_id) values (${feedbackId},${org},${projectId},1,'bug',${org},${randomUUID()})`;
      await fixture.db`insert into api_token (org_id,user_id,name,prefix,hash,scopes) values (${org},${user},'api fixture',${secret.slice(0, 12)},${await hashToken(secret)},${fixture.db.array(["feedback:read", "feedback:write"])})`;
    }
    await fixture.db`insert into api_token (org_id,user_id,name,prefix,hash,scopes) values (${orgA},${userA},'read fixture',${readToken.slice(0, 12)},${await hashToken(readToken)},${fixture.db.array(["feedback:read"])})`;
    await fixture.db`insert into feedback_asset (id,org_id,feedback_id,kind,storage_key,content_type,bytes) values (${assetB},${orgB},${feedbackB},'attachment',${assetB},'text/plain',1)`;
    api = (await import("./index")).app;
    await signIn(userA, orgA, cookiesA);
    await signIn(userB, orgB, cookiesB);
  }, 120_000);
  beforeEach(() => {
    effects.enqueue.mockClear();
    effects.publish.mockClear();
    queueContexts.length = 0;
    publishContexts.length = 0;
    effects.enqueue.mockImplementation(() => {
      queueContexts.push(currentOrgId());
      return Promise.resolve();
    });
    effects.publish.mockImplementation(() => {
      publishContexts.push(currentOrgId());
      return Promise.resolve();
    });
  });
  afterAll(async () => {
    if (fixture) {
      await closeIdentityDatabase();
      await getRuntimeDb().$client.end();
      await fixture.dispose();
    }
    vi.unstubAllEnvs();
  });

  it("serves only the signed-in workspace and preserves the current user's private account flags", async () => {
    const response = await request("/api/projects", { jar: cookiesA });
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain(projectA);
    expect(body).not.toContain(projectB);
    const me = await request("/api/me", { jar: cookiesA });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({
      orgId: orgA,
      user: { id: userA, emailVerified: true, twoFactorEnabled: false },
      setupNeeded: false,
    });
  });

  it("rejects foreign feedback, projects and asset downloads with a cookie session", async () => {
    expect((await request(`/api/feedback/${feedbackA}`, { jar: cookiesA })).status).toBe(200);
    for (const path of [`/api/feedback/${feedbackB}`, `/api/projects/${projectB}`, `/api/assets/${assetB}`])
      expect((await request(path, { jar: cookiesA })).status).toBe(404);
    expect(
      (
        await request(`/api/feedback/${feedbackB}`, {
          method: "PATCH",
          jar: cookiesA,
          body: { title: "foreign write" },
        })
      ).status,
    ).toBe(404);
    expect((await request(`/api/feedback/${feedbackB}`, { method: "DELETE", jar: cookiesA })).status).toBe(
      404,
    );
    expect(await database()`select title,deleted_at from feedback where id=${feedbackB}`).toMatchObject([
      { title: null, deleted_at: null },
    ]);
  });

  it("applies token organization, current membership and scope checks before tenant queries", async () => {
    const response = await request("/api/v1/projects", { token: tokenA });
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain(projectA);
    expect(body).not.toContain(projectB);
    expect((await request(`/api/v1/feedback/${feedbackB}`, { token: tokenA })).status).toBe(404);
    expect((await request(`/api/v1/assets/${assetB}`, { token: tokenA })).status).toBe(404);
    expect(
      (
        await request(`/api/v1/feedback/${feedbackA}`, {
          method: "PATCH",
          token: readToken,
          body: { title: "scope failure" },
        })
      ).status,
    ).toBe(403);
    const own = await request("/api/v1/token", { token: tokenB });
    expect(own.status).toBe(200);
    expect(await own.json()).toMatchObject({ orgId: orgB, user: { id: userB } });
  });

  it("publishes and enqueues a successful write only after commit without holding the database transaction", async () => {
    expect(
      (
        await request(`/api/feedback/${feedbackA}`, {
          method: "PATCH",
          jar: cookiesA,
          body: { title: "committed title" },
        })
      ).status,
    ).toBe(200);
    await vi.waitFor(() => expect(effects.publish).toHaveBeenCalled());
    expect(effects.enqueue).toHaveBeenCalled();
    expect(queueContexts.every((value) => value === undefined)).toBe(true);
    expect(publishContexts.every((value) => value === undefined)).toBe(true);
    expect(await database()`select title from feedback where id=${feedbackA}`).toMatchObject([
      { title: "committed title" },
    ]);
  });

  it("does not open Cloud signup or promote the first account to instance administrator", async () => {
    const email = `stranger-${randomUUID()}@test.invalid`;
    const response = await request("/api/auth/sign-up/email", {
      method: "POST",
      body: { name: "Stranger", email, password },
    });
    expect(response.status).toBe(403);
    expect(await database()`select id from "user" where email=${email}`).toHaveLength(0);
    const { promoteFirstAccount } = await import("./services/setup");
    expect(await promoteFirstAccount()).toBeNull();
    expect(await database()`select key from setting where key='instance.admins'`).toHaveLength(0);
  });

  it("rechecks membership even when a previously authenticated session or token is reused", async () => {
    await database()`delete from member where organization_id=${orgA} and user_id=${userA}`;
    try {
      expect((await request("/api/projects", { jar: cookiesA })).status).toBe(403);
      expect((await request("/api/v1/projects", { token: tokenA })).status).toBe(401);
    } finally {
      await database()`insert into member (id,organization_id,user_id,role) values (${randomUUID()},${orgA},${userA},'owner')`;
    }
  });

  it("streams two export batches under finite tenant scopes after returning the response", async () => {
    await database()`insert into feedback (org_id,project_id,number,kind,body,client_id)
      select ${orgA},${projectA},n,'bug','batch export',gen_random_uuid() from generate_series(2,102) n`;
    const response = await request("/api/feedback/export?format=json", { jar: cookiesA });
    expect(response.status).toBe(200);
    const data = (await response.json()) as { items: { id: string }[] };
    expect(data.items).toHaveLength(102);
    expect(data.items.some((item) => item.id === feedbackB)).toBe(false);
    await database()`delete from feedback where org_id=${orgA} and number>1`;
  });

  it("validates SSE projects without keeping a transaction open during subscription and reconnect", async () => {
    const unsubscribe = vi.fn();
    effects.subscribe.mockImplementation(() => {
      expect(currentOrgId()).toBeUndefined();
      return Promise.resolve({ backlog: [], presence: [], unsubscribe });
    });
    const response = await request(`/api/stream?projectIds=${projectA}`, { jar: cookiesA });
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    await reader?.read();
    await reader?.cancel();
    await vi.waitFor(() => expect(unsubscribe).toHaveBeenCalled());
    expect((await request(`/api/stream?projectIds=${projectB}`, { jar: cookiesA })).status).toBe(404);
    await database()`delete from member where organization_id=${orgA} and user_id=${userA}`;
    try {
      expect((await request(`/api/stream?projectIds=${projectA}`, { jar: cookiesA })).status).toBe(403);
    } finally {
      await database()`insert into member (id,organization_id,user_id,role) values (${randomUUID()},${orgA},${userA},'owner')`;
    }
  });

  it("delegates MCP tools through the same verified token organization", async () => {
    const response = await request("/mcp", {
      method: "POST",
      token: tokenA,
      body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_projects", arguments: {} } },
    });
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain(projectA);
    expect(body).not.toContain(projectB);
  });

  it("keeps account edits and invitations independent of the active organization", async () => {
    const response = await request("/api/me/profile", {
      method: "PATCH",
      jar: cookiesA,
      body: { name: "Updated account" },
    });
    expect(response.status).toBe(200);
    expect(await database()`select name from "user" where id=${userA}`).toMatchObject([
      { name: "Updated account" },
    ]);
    expect((await request("/api/me/invitations", { jar: cookiesA })).status).toBe(200);
  });

  it("reports only the active organization's seat count across consecutive entitlement requests", async () => {
    await database()`insert into member (id,organization_id,user_id,role) values (${randomUUID()},${orgB},${userA},'member')`;
    try {
      for (const [jar, used] of [
        [cookiesA, 1],
        [cookiesB, 2],
        [cookiesA, 1],
      ] as const) {
        const response = await request("/api/me/entitlements", { jar });
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ seats: { used } });
      }
    } finally {
      await database()`delete from member where organization_id=${orgB} and user_id=${userA}`;
    }
  });

  it("rejects a foreign active organization stored in an otherwise valid session", async () => {
    await database()`update session set active_organization_id=${orgB} where user_id=${userA}`;
    try {
      expect((await request("/api/projects", { jar: cookiesA })).status).toBe(403);
    } finally {
      await database()`update session set active_organization_id=${orgA} where user_id=${userA}`;
    }
  });

  it("broadcasts presence only after its finite database work commits", async () => {
    const response = await request("/api/presence", {
      method: "POST",
      jar: cookiesA,
      body: { feedbackId: feedbackA },
    });
    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(effects.publish).toHaveBeenCalled());
    expect(publishContexts).toEqual([undefined]);
  });

  it("immediately rejects a revoked Cloud session instead of trusting its previously issued cookie cache", async () => {
    await database()`delete from session where user_id=${userA}`;
    expect((await request("/api/projects", { jar: cookiesA })).status).toBe(401);
  });
});
