import type * as StorageModule from "./storage";
import type * as OutboundModule from "./outbound/safe-fetch";
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
  put: vi.fn<(...args: unknown[]) => Promise<void>>(),
  get: vi.fn<(...args: unknown[]) => Promise<null>>(),
  remove: vi.fn<(...args: unknown[]) => Promise<void>>(),
  fetch: vi.fn<(...args: unknown[]) => Promise<Response>>(),
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

vi.mock("./storage", async (original) => ({
  ...(await original<typeof StorageModule>()),
  storage: () => ({ put: effects.put, get: effects.get, remove: effects.remove }),
}));
vi.mock("./outbound/safe-fetch", async (original) => ({
  ...(await original<typeof OutboundModule>()),
  safeFetch: effects.fetch,
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
  const externalContexts: (string | undefined)[] = [];
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
    effects.put.mockClear();
    effects.get.mockClear();
    effects.remove.mockClear();
    effects.fetch.mockClear();
    externalContexts.length = 0;
    effects.put.mockImplementation(() => {
      externalContexts.push(currentOrgId());
      return Promise.resolve();
    });
    effects.get.mockImplementation(() => {
      externalContexts.push(currentOrgId());
      return Promise.resolve(null);
    });
    effects.remove.mockImplementation(() => {
      externalContexts.push(currentOrgId());
      return Promise.resolve();
    });
    effects.fetch.mockImplementation(() => {
      externalContexts.push(currentOrgId());
      return Promise.resolve(Response.json({ ok: true, message: "done" }));
    });
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

  it("rejects foreign resources before mixed storage or network operations", async () => {
    for (const [method, path, body] of [
      ["GET", `/api/projects/${projectB}/export`, undefined],
      ["POST", `/api/projects/${projectB}/export`, {}],
      ["GET", `/api/projects/${projectB}/export/download`, undefined],
      ["GET", `/api/rounds/${randomUUID()}/export?format=csv`, undefined],
      ["POST", `/api/feedback/${feedbackB}/actions/test`, {}],
      ["POST", `/api/feedback/${feedbackB}/issues`, { integrationId: randomUUID() }],
      ["POST", `/api/integrations/${randomUUID()}/test`, {}],
      ["POST", `/api/webhooks/${randomUUID()}/test`, {}],
    ] as const) {
      const response = await request(path, { method, jar: cookiesA, body });
      expect.soft(response.status, `${method} ${path}`).toBe(404);
    }
  });

  it("reads export status and commits export requests before enqueueing", async () => {
    expect((await request(`/api/projects/${projectA}/export`, { jar: cookiesA })).status).toBe(200);
    expect(
      (await request(`/api/projects/${projectA}/export`, { method: "POST", jar: cookiesA, body: {} })).status,
    ).toBe(202);
    expect(effects.enqueue).toHaveBeenCalled();
    expect(queueContexts).toEqual([undefined]);
  });

  it("prepares a test email and reporter-erasure preview with finite tenant reads", async () => {
    expect
      .soft(
        (
          await request("/api/email-templates/reporter_received/test", {
            method: "POST",
            jar: cookiesA,
            body: {},
          })
        ).status,
      )
      .toBe(200);
    const response = await request("/api/privacy/erase", {
      method: "POST",
      jar: cookiesA,
      body: { email: "absent@test.invalid", dryRun: true },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      result: { feedback: 0, comments: 0, emails: 0, dryRun: true },
    });
  });

  it("uploads branding files outside the transaction and saves only its tenant metadata", async () => {
    const response = await request("/api/branding/assets", {
      method: "POST",
      jar: cookiesA,
      body: {
        dataUrl:
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jHnQAAAAASUVORK5CYII=",
      },
    });
    expect(response.status).toBe(201);
    expect(effects.put).toHaveBeenCalled();
    expect(externalContexts).toEqual([undefined]);
    expect(await database()`select org_id from brand_asset`).toMatchObject([{ org_id: orgA }]);
  });

  it("runs actions and webhook tests between finite database scopes", async () => {
    await database()`update project set widget_config=${database().json({ panelActions: [{ id: "send", label: "Send", kind: "webhook", url: "https://example.test/action" }] })} where id=${projectA}`;
    const action = await request(`/api/feedback/${feedbackA}/actions/send`, {
      method: "POST",
      jar: cookiesA,
      body: {},
    });
    expect(action.status).toBe(200);
    expect(await action.json()).toMatchObject({ ok: true });
    const endpoint = randomUUID();
    await database()`insert into webhook_endpoint (id,org_id,url) values (${endpoint},${orgA},'https://example.test/hook')`;
    const hook = await request(`/api/webhooks/${endpoint}/test`, { method: "POST", jar: cookiesA, body: {} });
    expect(hook.status).toBe(200);
    expect(await hook.json()).toMatchObject({ delivery: { status: "success" } });
    expect(externalContexts).toEqual([undefined, undefined]);
  });

  it("erases only the active tenant's reporter rows and removes their files after commit", async () => {
    const idA = randomUUID(),
      idB = randomUUID(),
      key = `${projectA}/${randomUUID()}.png`;
    for (const [id, org, projectId] of [
      [idA, orgA, projectA],
      [idB, orgB, projectB],
    ] as const) {
      await database()`insert into feedback (id,org_id,project_id,number,kind,body,client_id,reporter_guest) values (${id},${org},${projectId},99,'bug','erase fixture',${randomUUID()},${database().json({ email: "erase@test.invalid" })})`;
    }
    await database()`insert into feedback_asset (org_id,feedback_id,kind,storage_key,content_type,bytes) values (${orgA},${idA},'screenshot',${key},'image/png',1)`;
    const response = await request("/api/privacy/erase", {
      method: "POST",
      jar: cookiesA,
      body: { email: "erase@test.invalid" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ result: { feedback: 1, dryRun: false } });
    await vi.waitFor(() => expect(effects.remove).toHaveBeenCalledWith(key));
    expect(externalContexts).toEqual([undefined]);
    expect(await database()`select id from feedback where id=${idA}`).toHaveLength(0);
    expect(await database()`select id from feedback where id=${idB}`).toHaveLength(1);
  });

  it("translates feedback with the provider call outside tenant transactions", async () => {
    vi.stubEnv("AI_API_KEY", randomUUID());
    vi.stubEnv("AI_PROVIDER", "anthropic");
    effects.fetch.mockImplementation(() => {
      externalContexts.push(currentOrgId());
      return Promise.resolve(
        Response.json({
          content: [{ type: "text", text: JSON.stringify({ ok: true, translatedText: "Translated" }) }],
        }),
      );
    });
    const response = await request(`/api/feedback/${feedbackA}/ai/translate`, {
      method: "POST",
      jar: cookiesA,
      body: { targetLocale: "fr" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ body: "Translated" });
    expect(externalContexts.length).toBeGreaterThan(0);
    expect(externalContexts.every((value) => value === undefined)).toBe(true);
  });

  it("tests AI provider settings without a transaction spanning the provider request", async () => {
    effects.fetch.mockImplementation(() => {
      externalContexts.push(currentOrgId());
      return Promise.resolve(Response.json({ content: [{ type: "text", text: '{"ok":true}' }] }));
    });
    const response = await request("/api/settings/ai/test", {
      method: "POST",
      jar: cookiesA,
      body: { provider: "anthropic", model: "fixture", apiKey: randomUUID() },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
    expect(externalContexts).toEqual([undefined]);
  });

  it("redelivers webhooks without holding the previous request transaction", async () => {
    const endpoint = randomUUID(),
      delivery = { id: randomUUID() };
    const payload = {
      id: randomUUID(),
      event: "ping",
      apiVersion: "2025-01-01",
      createdAt: new Date().toISOString(),
      data: {},
    };
    await database()`insert into webhook_endpoint (id,org_id,url) values (${endpoint},${orgA},'https://example.test/redeliver')`;
    await database()`insert into webhook_delivery (id,org_id,endpoint_id,event_id,event,payload,status) values (${delivery.id},${orgA},${endpoint},${payload.id},'ping',${database().json(payload)},'success')`;
    const response = await request(`/api/webhook-deliveries/${delivery.id}/redeliver`, {
      method: "POST",
      jar: cookiesA,
      body: {},
    });
    expect(response.status).toBe(200);
    expect(externalContexts).toEqual([undefined]);
  });

  it("checks and creates tracker issues between finite tenant database scopes", async () => {
    const integration = randomUUID();
    const { encryptSecret } = await import("./crypto");
    await database()`insert into issue_integration (id,org_id,project_id,provider,token,token_hint,repo,webhook_secret) values (${integration},${orgA},${projectA},'github',${encryptSecret(randomUUID())},'test','fixture/repo',${encryptSecret(randomUUID())})`;
    effects.fetch.mockImplementation(() => {
      externalContexts.push(currentOrgId());
      return Promise.resolve(Response.json({ number: 123, html_url: "https://example.test/issues/123" }));
    });
    const checked = await request(`/api/integrations/${integration}/test`, {
      method: "POST",
      jar: cookiesA,
      body: {},
    });
    expect(checked.status).toBe(200);
    const created = await request(`/api/feedback/${feedbackA}/issues`, {
      method: "POST",
      jar: cookiesA,
      body: { integrationId: integration },
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ issue: { number: 123 } });
    expect(externalContexts).toEqual([undefined, undefined]);
  });

  it("deletes an account's sole-owned workspace and cleans files after the tenant commit", async () => {
    const org = `delete-${randomUUID()}`,
      person = `delete-${randomUUID()}`,
      projectId = randomUUID(),
      item = randomUUID(),
      key = `${projectId}/${randomUUID()}.png`;
    await database()`insert into organization (id,name,slug) values (${org},${org},${org})`;
    await database()`insert into "user" (id,name,email,email_verified) values (${person},${person},${`${person}@test.invalid`},true)`;
    await database()`insert into account (id,account_id,provider_id,user_id,password) values (${randomUUID()},${person},'credential',${person},${await hashPassword(password)})`;
    await database()`insert into member (id,organization_id,user_id,role) values (${randomUUID()},${org},${person},'owner')`;
    await database()`insert into project (id,org_id,name,slug,public_key) values (${projectId},${org},'delete','delete',${projectId})`;
    await database()`insert into feedback (id,org_id,project_id,number,kind,body,client_id) values (${item},${org},${projectId},1,'bug','delete',${randomUUID()})`;
    await database()`insert into feedback_asset (org_id,feedback_id,kind,storage_key,content_type,bytes) values (${org},${item},'screenshot',${key},'image/png',1)`;
    const jar = new Map<string, string>();
    await signIn(person, org, jar);
    const response = await request("/api/auth/delete-user", { method: "POST", jar, body: { password } });
    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(effects.remove).toHaveBeenCalledWith(key));
    expect(externalContexts).toEqual([undefined]);
    expect(await database()`select id from organization where id=${org}`).toHaveLength(0);
    expect(await database()`select id from organization where id=${orgB}`).toHaveLength(1);
  });

  it("reads and updates only the verified account's global preferences", async () => {
    const response = await request("/api/me/preferences", {
      method: "PATCH",
      jar: cookiesA,
      body: { emailPaused: true, locale: "fr" },
    });
    expect.soft(response.status).toBe(200);
    const own = await request("/api/me/preferences", { jar: cookiesA });
    expect.soft(own.status).toBe(200);
    expect(await own.json()).toMatchObject({ preferences: { emailPaused: true, locale: "fr" } });
    const other = await request("/api/me/preferences", { jar: cookiesB });
    expect(other.status).toBe(200);
    expect(await other.json()).toMatchObject({ preferences: { emailPaused: false, locale: null } });
  });

  it("renders invitation email overrides inside the organization validated by Better Auth", async () => {
    await database()`insert into email_template (org_id,key,subject,body) values (${orgA},'invitation','Scoped invitation A','Invitation to {{orgName}}')`;
    const response = await request("/api/auth/organization/invite-member", {
      method: "POST",
      jar: cookiesA,
      body: { organizationId: orgA, email: `invite-${randomUUID()}@test.invalid`, role: "member" },
    });
    expect(response.status).toBe(200);
    expect(effects.enqueue).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ subject: "Scoped invitation A" }),
    );
    expect(queueContexts).toEqual([undefined]);
  });

  it("immediately rejects a revoked Cloud session instead of trusting its previously issued cookie cache", async () => {
    await database()`delete from session where user_id=${userA}`;
    expect((await request("/api/projects", { jar: cookiesA })).status).toBe(401);
  });
});
