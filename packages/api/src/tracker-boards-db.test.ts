import type * as ApiModule from "./index";
import type * as BossModule from "./jobs/boss";
import type * as BusModule from "./realtime/bus";
import type * as SafeFetchModule from "./outbound/safe-fetch";
import { createHmac, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getRuntimeDb } from "../../db/src/connection";
import { closeIdentityDatabase } from "../../db/src/identity";
import { createCloudFixture } from "./test-helpers/cloud-fixture";

/**
 * The board trackers (Trello, Asana, ClickUp, Notion; ADR 0029) against a real database with row security:
 * connecting through the API, creating items once, linking them by the tracker's own id, pushing state,
 * registering webhooks (including Asana's handshake against the in-process app) and resolving items from
 * signed deliveries. All tracker HTTP is a mock; nothing reaches a real account.
 */
const effects = vi.hoisted(() => ({
  enqueue: vi.fn<(...args: unknown[]) => Promise<void>>(),
  publish: vi.fn<(...args: unknown[]) => Promise<void>>(),
  fetch:
    vi.fn<
      (
        url: string,
        init?: { method?: string; headers?: Record<string, string>; body?: string },
      ) => Promise<Response>
    >(),
}));
vi.mock("./jobs/boss", async (original) => ({
  ...(await original<typeof BossModule>()),
  enqueue: effects.enqueue,
}));
vi.mock("./realtime/bus", async (original) => ({
  ...(await original<typeof BusModule>()),
  publish: effects.publish,
}));
vi.mock("./outbound/safe-fetch", async (original) => ({
  ...(await original<typeof SafeFetchModule>()),
  safeFetch: effects.fetch,
}));

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- the cases read parsed JSON responses and SQL rows */
type Json = Record<string, any>;
type Call = { url: string; method: string; body: any };

const REPO = {
  trello: "5f1a2b3c4d5e6f7a8b9c0d1e",
  asana: "1200000001",
  clickup: "9001",
  notion: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
} as const;
type Provider = keyof typeof REPO;
const PROVIDERS = Object.keys(REPO) as Provider[];
const SETTINGS: Record<Provider, Record<string, string>> = {
  trello: { listId: "list1", doneListId: "done" },
  asana: {},
  clickup: { closedStatus: "complete", openStatus: "to do" },
  notion: { statusProperty: "Status" },
};
const BODY: Record<Provider, Json> = {
  trello: { apiKey: "trello-key-123456", token: "trello-token-abcdef" },
  asana: { token: "asana-token-abcdef" },
  clickup: { token: "pk_clickup_abcdef" },
  notion: { token: "secret_notion_abcdef" },
};

describe.skipIf(!process.env.PINWREN_ISOLATION_ADMIN_URL)("Board trackers", () => {
  let fixture: Awaited<ReturnType<typeof createCloudFixture>> | undefined;
  let api: typeof ApiModule.app;
  const suffix = randomUUID();
  const orgA = `trk-a-${suffix}`;
  const owner = `owner-${suffix}`;
  const password = randomUUID();
  const jar = new Map<string, string>();
  const projectA = randomUUID();
  const projectB = randomUUID();
  const integration = {} as Record<Provider, string>;
  const calls: Call[] = [];
  /** What the mocked tracker answers; reset per case. */
  let answer: (c: Call) => { status?: number; json?: unknown };

  const db = () => {
    if (!fixture) throw new Error("fixture not ready");
    return fixture.db;
  };
  const request = (
    path: string,
    init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
  ) => {
    const headers = new Headers({
      origin: "http://localhost:3100",
      "content-type": "application/json",
      ...init.headers,
    });
    if (jar.size && !init.headers?.["x-no-cookie"])
      headers.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
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

  const connect = async (provider: Provider, extra: Json = {}) => {
    const response = await request(`/api/projects/${projectA}/integrations`, {
      method: "POST",
      body: { provider, repo: REPO[provider], settings: SETTINGS[provider], ...BODY[provider], ...extra },
    });
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
    return json(response);
  };
  const newItem = async (fields: { priority?: string; status?: string } = {}) => {
    const id = randomUUID();
    const [counted] =
      await db()`update project set feedback_counter = feedback_counter + 1 where id = ${projectA} returning feedback_counter as n`;
    await db()`insert into feedback (id,org_id,project_id,number,kind,priority,status,body,client_id) values (${id},${orgA},${projectA},${Number(counted?.n ?? 0)},'bug',${fields.priority ?? "high"},${fields.status ?? "open"},'It is broken',${randomUUID()})`;
    return id;
  };
  const linkOf = async (feedbackId: string, provider: Provider) =>
    (
      await db()`select * from issue_link where feedback_id = ${feedbackId} and integration_id = ${integration[provider]}`
    )[0] as Json | undefined;

  const mustLink = async (feedbackId: string, provider: Provider): Promise<Json> => {
    const link = await linkOf(feedbackId, provider);
    if (!link) throw new Error(`no ${provider} link for ${feedbackId}`);
    return link;
  };

  /** A tracker that is empty and accepts everything, answering each provider's create with a fresh id. */
  const friendly = (c: Call): { status?: number; json?: unknown } => {
    const u = c.url;
    if (u.includes("trello.com")) {
      if (c.method === "GET" && u.includes("/cards")) return { json: [] };
      if (u.endsWith("/cards"))
        return { json: { id: `card-${randomUUID()}`, idShort: 5, shortUrl: "https://trello.com/c/abc" } };
      if (u.includes("/webhooks")) return { json: { id: "trello-hook" } };
      if (u.includes("/lists/")) return { json: { idBoard: REPO.trello } };
      return { json: { id: REPO.trello, name: "Roadmap" } };
    }
    if (u.includes("asana.com")) {
      if (u.endsWith("/tasks"))
        return {
          json: { data: { gid: `gid-${randomUUID()}`, permalink_url: "https://app.asana.com/0/1/2" } },
        };
      if (c.method === "GET" && u.includes("/tasks?")) return { json: { data: [] } };
      return { json: { data: { name: "Website", gid: "asana-hook" } } };
    }
    if (u.includes("clickup.com")) {
      if (u.includes("/webhook"))
        return { json: { id: "cu-hook", webhook: { id: "cu-hook", secret: "clickup-signing-secret" } } };
      if (u.endsWith("/team")) return { json: { teams: [{ id: "333" }] } };
      if (c.method === "GET" && u.includes("/task?")) return { json: { tasks: [] } };
      if (u.endsWith("/task"))
        return { json: { id: `cu-${randomUUID()}`, url: "https://app.clickup.com/t/x" } };
      return {
        json: {
          name: "Bugs",
          statuses: [
            { status: "to do", type: "open" },
            { status: "complete", type: "closed" },
          ],
        },
      };
    }
    if (u.includes("/query")) return { json: { results: [] } };
    if (u.endsWith("/pages")) return { json: { id: randomUUID(), url: "https://www.notion.so/p" } };
    return {
      json: {
        title: [{ plain_text: "Feedback" }],
        properties: { Name: { type: "title" }, Status: { type: "status" } },
      },
    };
  };

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
    await d`insert into organization (id,name,slug) values (${orgA},${orgA},${orgA})`;
    await d`insert into "user" (id,name,email,email_verified) values (${owner},${owner},${`${owner}@test.invalid`},true)`;
    await d`insert into account (id,account_id,provider_id,user_id,password) values (${randomUUID()},${owner},'credential',${owner},${hashed})`;
    await d`insert into member (id,organization_id,user_id,role) values (${randomUUID()},${orgA},${owner},'owner')`;
    for (const project of [projectA, projectB]) {
      await d`insert into project (id,org_id,name,slug,public_key,allowed_origins,identity_secret,action_secret) values (${project},${orgA},'P',${project},${project},${d.array(["https://customer.test"])},${randomUUID()},${randomUUID()})`;
    }
    api = (await import("./index")).app;
    const signed = await request("/api/auth/sign-in/email", {
      method: "POST",
      body: { email: `${owner}@test.invalid`, password },
    });
    expect(signed.status).toBe(200);
    take(signed);
    take(
      await request("/api/auth/organization/set-active", { method: "POST", body: { organizationId: orgA } }),
    );
  }, 120_000);
  beforeEach(() => {
    calls.length = 0;
    answer = friendly;
    effects.enqueue.mockReset().mockResolvedValue(undefined);
    effects.publish.mockReset().mockResolvedValue(undefined);
    effects.fetch.mockReset().mockImplementation((url, init) => {
      const c: Call = {
        url,
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(init.body) : undefined,
      };
      calls.push(c);
      const r = answer(c);
      return Promise.resolve(new Response(JSON.stringify(r.json ?? {}), { status: r.status ?? 200 }));
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

  it("refuses what a tracker doesn't take: a missing key, another tracker's setting, a bad id", async () => {
    const post = (body: Json) => request(`/api/projects/${projectA}/integrations`, { method: "POST", body });
    expect(
      (
        await post({
          provider: "trello",
          repo: REPO.trello,
          token: "trello-token-abcdef",
          settings: { listId: "l" },
        })
      ).status,
    ).toBe(400);
    expect((await post({ provider: "trello", repo: REPO.trello, ...BODY.trello, settings: {} })).status).toBe(
      400,
    );
    expect(
      (await post({ provider: "asana", repo: REPO.asana, ...BODY.asana, settings: { listId: "x" } })).status,
    ).toBe(400);
    expect((await post({ provider: "asana", repo: "not-a-gid", ...BODY.asana })).status).toBe(400);
    expect(
      (
        await post({
          provider: "notion",
          repo: REPO.notion,
          ...BODY.notion,
          apiUrl: "https://notion.example.com",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post({
          provider: "clickup",
          repo: REPO.clickup,
          ...BODY.clickup,
          webhookSecret: "x".repeat(20),
        })
      ).status,
    ).toBe(400);
    expect(
      (await post({ provider: "github", repo: "acme/web", token: "ghp_abcdefgh", apiKey: "k".repeat(10) }))
        .status,
    ).toBe(400);
  });

  it("connects each tracker without ever returning or storing a credential in the clear", async () => {
    for (const provider of PROVIDERS) {
      const created = await connect(provider);
      integration[provider] = created.integration.id;
      const out = created.integration as Json;
      expect(out.settings).toEqual(SETTINGS[provider]);
      expect(out.webhookUrl).toBe(
        `http://localhost:3100/api/integrations/${provider}/webhook?i=${integration[provider]}`,
      );
      // Trello waits for the pasted app secret, Asana and Notion for the tracker's handshake, ClickUp for nothing.
      expect(out.webhookPending).toBe(provider !== "clickup");
      expect(out.webhookRegistered).toBe(false);
      expect(out.tokenHint).toBe(`…${BODY[provider].token.slice(-4)}`);
      expect(out.apiKey).toBe(provider === "trello" ? BODY.trello.apiKey : null);
      const text = JSON.stringify(created);
      expect(text).not.toContain(BODY[provider].token);
      const [row] =
        await db()`select token, settings from issue_integration where id = ${integration[provider]}`;
      expect(String(row?.token)).toMatch(/^v1\./);
      expect(String(row?.token)).not.toContain(BODY[provider].token);
    }
    // One of each per project.
    const again = await request(`/api/projects/${projectA}/integrations`, {
      method: "POST",
      body: { provider: "asana", repo: REPO.asana, ...BODY.asana },
    });
    expect(again.status).toBe(409);
    const listed = await json(await request(`/api/projects/${projectA}/integrations`));
    expect(listed.integrations.map((i: Json) => i.provider).sort()).toEqual([
      "asana",
      "clickup",
      "notion",
      "trello",
    ]);
    expect(JSON.stringify(listed)).not.toContain("webhookSecret");
  });

  it("tests the connection, and settles Trello's short link on the board's long id", async () => {
    for (const provider of PROVIDERS) {
      const res = await json(
        await request(`/api/integrations/${integration[provider]}/test`, { method: "POST" }),
      );
      expect(res.ok, `${provider}: ${JSON.stringify(res)}`).toBe(true);
    }
    await request(`/api/integrations/${integration.trello}`, { method: "PATCH", body: { repo: "AbCd1234" } });
    answer = (c) =>
      c.url.includes("/lists/")
        ? { json: { idBoard: REPO.trello } }
        : { json: { id: REPO.trello, name: "Roadmap" } };
    await request(`/api/integrations/${integration.trello}/test`, { method: "POST" });
    const [row] = await db()`select repo from issue_integration where id = ${integration.trello}`;
    expect(row?.repo).toBe(REPO.trello);
    answer = () => ({ status: 401, json: { message: "bad token" } });
    const denied = await json(
      await request(`/api/integrations/${integration.clickup}/test`, { method: "POST" }),
    );
    expect(denied.ok).toBe(false);
    expect(denied.message).toContain("401");
    const [errored] = await db()`select last_error from issue_integration where id = ${integration.clickup}`;
    expect(String(errored?.last_error)).toContain("401");
  });

  it("saves the mapping as a whole and refuses keys the tracker doesn't have", async () => {
    const patch = (id: string, body: Json) => request(`/api/integrations/${id}`, { method: "PATCH", body });
    const ok = await patch(integration.notion, {
      settings: {
        statusProperty: "Phase",
        closedValue: "Shipped",
        priorityProperty: "Priority",
        priorityHigh: "P1",
      },
    });
    expect(ok.status).toBe(200);
    expect((await json(ok)).integration.settings).toEqual({
      statusProperty: "Phase",
      closedValue: "Shipped",
      priorityProperty: "Priority",
      priorityHigh: "P1",
    });
    expect((await patch(integration.notion, { settings: { listId: "x" } })).status).toBe(400);
    expect((await patch(integration.trello, { settings: {} })).status).toBe(400);
    expect((await patch(integration.clickup, { settings: { priorityHigh: "9" } })).status).toBe(400);
    expect((await patch(integration.asana, { email: "a@b.co" })).status).toBe(400);
    expect((await patch(integration.asana, { apiKey: "k".repeat(10) })).status).toBe(400);
    await patch(integration.notion, { settings: SETTINGS.notion });
  });

  it("registers webhooks: Asana's handshake, ClickUp's secret, and Trello only once it has its app secret", async () => {
    // Asana calls the target while the registration request is open; here the mock plays Asana.
    answer = (c) => {
      if (c.url.includes("asana.com") && c.url.endsWith("/webhooks") && c.method === "POST")
        return { json: { data: { gid: "asana-hook" } } };
      return friendly(c);
    };
    effects.fetch.mockImplementation(async (url, init) => {
      const c: Call = {
        url,
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(init.body) : undefined,
      };
      calls.push(c);
      if (c.url.includes("asana.com") && c.url.endsWith("/webhooks") && c.method === "POST") {
        const target = new URL(c.body.data.target as string);
        const hello = await request(`${target.pathname}${target.search}`, {
          method: "POST",
          body: {},
          headers: { "x-hook-secret": "asana-hook-secret-1", "x-no-cookie": "1" },
        });
        expect(hello.status).toBe(200);
        expect(hello.headers.get("x-hook-secret")).toBe("asana-hook-secret-1");
      }
      const r = answer(c);
      return new Response(JSON.stringify(r.json ?? {}), { status: r.status ?? 200 });
    });
    const asana = await request(`/api/integrations/${integration.asana}/register-webhook`, {
      method: "POST",
    });
    expect(asana.status, JSON.stringify(await asana.clone().json())).toBe(200);
    expect((await json(asana)).integration).toMatchObject({ webhookRegistered: true, webhookPending: false });
    const [row] =
      await db()`select webhook_secret, webhook_ref from issue_integration where id = ${integration.asana}`;
    const { decryptSecret } = await import("./crypto");
    expect(decryptSecret(String(row?.webhook_secret))).toBe("asana-hook-secret-1");
    expect(row?.webhook_ref).toBe("asana-hook");

    const clickup = await json(
      await request(`/api/integrations/${integration.clickup}/register-webhook`, { method: "POST" }),
    );
    expect(clickup.integration).toMatchObject({ webhookRegistered: true, webhookPending: false });
    const [cu] = await db()`select webhook_secret from issue_integration where id = ${integration.clickup}`;
    expect(decryptSecret(String(cu?.webhook_secret))).toBe("clickup-signing-secret");

    // Trello signs with the Power-Up's app secret: registering before it is pasted is refused.
    const early = await request(`/api/integrations/${integration.trello}/register-webhook`, {
      method: "POST",
    });
    expect(early.status).toBe(400);
    await request(`/api/integrations/${integration.trello}`, {
      method: "PATCH",
      body: { webhookSecret: "trello-app-secret-0123456789" },
    });
    const trello = await json(
      await request(`/api/integrations/${integration.trello}/register-webhook`, { method: "POST" }),
    );
    expect(trello.integration).toMatchObject({ webhookRegistered: true, webhookPending: false });

    // Notion's subscription is made by hand; and its secret can't be rotated into something Pinwren made up.
    const notion = await request(`/api/integrations/${integration.notion}/register-webhook`, {
      method: "POST",
    });
    expect(notion.status).toBe(400);
    const rotated = await json(
      await request(`/api/integrations/${integration.notion}/rotate-webhook-secret`, { method: "POST" }),
    );
    expect(rotated).toMatchObject({ secret: null, pending: true });
    const none = await request(`/api/integrations/${integration.asana}/rotate-webhook-secret`, {
      method: "POST",
    });
    expect(none.status).toBe(409);
    // The board trackers have no secret to reveal.
    const reveal = await json(await request(`/api/integrations/${integration.clickup}/webhook-secret`));
    expect(reveal.secret).toBeNull();
    // Notion took part in the handshake test below; leave it waiting for a token.
    const [n] = await db()`select webhook_pending from issue_integration where id = ${integration.notion}`;
    expect(n?.webhook_pending).toBe(true);
  });

  it.each(PROVIDERS)("creates the %s item once and links it by the tracker's id", async (provider) => {
    const id = await newItem();
    const send = () =>
      request(`/api/feedback/${id}/issues`, {
        method: "POST",
        body: { integrationId: integration[provider] },
      });
    const first = await send();
    expect(first.status, JSON.stringify(await first.clone().json())).toBe(201);
    const { issue } = await json(first);
    expect(issue.provider).toBe(provider);
    expect(issue.externalId).toBeTruthy();
    expect(issue.number).toBe(provider === "trello" ? 5 : null);
    const creates = calls.filter((c) => c.method === "POST" && !c.url.includes("/query")).length;
    expect(creates).toBe(1);
    const link = await linkOf(id, provider);
    expect(link).toMatchObject({ external_id: issue.externalId, state: "open", provider });
    // Sending again returns the same link and doesn't create another item.
    calls.length = 0;
    const second = await json(await send());
    expect(second.issue.id).toBe(issue.id);
    expect(calls).toHaveLength(0);
    const [act] = await db()`select data from activity where feedback_id = ${id} and type = 'issue_linked'`;
    expect(act?.data).toMatchObject({ provider, externalId: issue.externalId });
    expect(JSON.stringify(calls)).not.toContain("It is broken-secret");
  });

  it("adopts the item an interrupted create already made instead of duplicating it", async () => {
    const id = await newItem();
    const { issueTitle } = await import("./integrations/issues");
    const title = issueTitle({
      number: Number((await db()`select number from feedback where id = ${id}`)[0]?.number),
      title: null,
      body: "It is broken",
    });
    answer = (c) =>
      c.method === "GET" && c.url.includes("/task?")
        ? {
            json: {
              tasks: [{ id: "cu-existing", name: title, url: "https://app.clickup.com/t/cu-existing" }],
            },
          }
        : friendly(c);
    const res = await json(
      await request(`/api/feedback/${id}/issues`, {
        method: "POST",
        body: { integrationId: integration.clickup },
      }),
    );
    expect(res.issue.externalId).toBe("cu-existing");
    expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/task"))).toBe(false);
  });

  it("pushes close and reopen to the item, addressing it by the tracker's id", async () => {
    const { runIssueJob } = await import("./integrations/issues");
    const id = await newItem();
    await request(`/api/feedback/${id}/issues`, {
      method: "POST",
      body: { integrationId: integration.trello },
    });
    const link = await mustLink(id, "trello");
    calls.length = 0;
    await runIssueJob({ type: "state", linkId: link.id, state: "closed", orgId: orgA });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "PUT" });
    expect(calls[0]?.url).toBe(`https://api.trello.com/1/cards/${link.external_id}`);
    expect(calls[0]?.body).toEqual({ idList: "done", closed: false });
    expect((await linkOf(id, "trello"))?.state).toBe("closed");
    await runIssueJob({ type: "state", linkId: link.id, state: "open", orgId: orgA });
    expect((await linkOf(id, "trello"))?.state).toBe("open");
    // A tracker that refuses leaves the link as it was, and the error is shown on the integration.
    answer = () => ({ status: 500, json: { message: "boom" } });
    await expect(
      runIssueJob({ type: "state", linkId: link.id, state: "closed", orgId: orgA }),
    ).rejects.toThrow(/500/);
    expect((await linkOf(id, "trello"))?.state).toBe("open");
    const [row] = await db()`select last_error from issue_integration where id = ${integration.trello}`;
    expect(String(row?.last_error)).toContain("500");
  });

  it("resolves the item from a signed ClickUp delivery, once, and ignores a forged one", async () => {
    const id = await newItem();
    await request(`/api/feedback/${id}/issues`, {
      method: "POST",
      body: { integrationId: integration.clickup },
    });
    const link = await mustLink(id, "clickup");
    const send = (secret: string, historyId = randomUUID()) => {
      const body = {
        webhook_id: "cu-hook",
        event: "taskStatusUpdated",
        task_id: link.external_id,
        history_items: [{ id: historyId, field: "status", after: { status: "complete", type: "closed" } }],
      };
      return request(`/api/integrations/clickup/webhook?i=${integration.clickup}`, {
        method: "POST",
        body,
        headers: {
          "x-signature": createHmac("sha256", secret).update(JSON.stringify(body)).digest("hex"),
          "x-no-cookie": "1",
        },
      });
    };
    expect((await send("not-the-secret")).status).toBe(401);
    expect((await db()`select status from feedback where id = ${id}`)[0]?.status).toBe("open");
    const historyId = randomUUID();
    const ok = await send("clickup-signing-secret", historyId);
    expect(ok.status, JSON.stringify(await ok.clone().json())).toBe(200);
    expect((await db()`select status from feedback where id = ${id}`)[0]?.status).toBe("resolved");
    expect((await linkOf(id, "clickup"))?.state).toBe("closed");
    const [act] =
      await db()`select actor_kind, data from activity where feedback_id = ${id} and type = 'status_changed'`;
    expect(act).toMatchObject({ actor_kind: "integration" });
    expect(act?.data).toMatchObject({ via: "clickup", from: "open", to: "resolved" });
    // The same delivery again is acknowledged and not applied twice.
    const again = await json(await send("clickup-signing-secret", historyId));
    expect(again.duplicate).toBe(true);
  });

  it("takes Notion's verification token while waiting, then resolves items from signed page updates", async () => {
    const hello = await request(`/api/integrations/notion/webhook?i=${integration.notion}`, {
      method: "POST",
      body: { verification_token: "secret_notion_verification" },
      headers: { "x-no-cookie": "1" },
    });
    expect(hello.status).toBe(200);
    // The admin types the token back into Notion's verification dialog, so Notion's (and only Notion's) is revealable.
    const reveal = await json(await request(`/api/integrations/${integration.notion}/webhook-secret`));
    expect(reveal).toMatchObject({ secret: "secret_notion_verification", pending: false });
    const id = await newItem();
    await request(`/api/feedback/${id}/issues`, {
      method: "POST",
      body: { integrationId: integration.notion },
    });
    const link = await mustLink(id, "notion");
    answer = () => ({ json: { properties: { Status: { type: "status", status: { name: "Done" } } } } });
    const body = {
      id: randomUUID(),
      type: "page.properties_updated",
      entity: { id: String(link.external_id), type: "page" },
      data: { parent: { id: REPO.notion, type: "database" } },
    };
    const res = await request(`/api/integrations/notion/webhook?i=${integration.notion}`, {
      method: "POST",
      body,
      headers: {
        "x-notion-signature": `sha256=${createHmac("sha256", "secret_notion_verification").update(JSON.stringify(body)).digest("hex")}`,
        "x-no-cookie": "1",
      },
    });
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    expect((await db()`select status from feedback where id = ${id}`)[0]?.status).toBe("resolved");
    // Notion unreachable while reading the page: ask for a redelivery rather than dropping the change.
    answer = () => ({ status: 500, json: {} });
    const retry = { ...body, id: randomUUID() };
    const down = await request(`/api/integrations/notion/webhook?i=${integration.notion}`, {
      method: "POST",
      body: retry,
      headers: {
        "x-notion-signature": `sha256=${createHmac("sha256", "secret_notion_verification").update(JSON.stringify(retry)).digest("hex")}`,
        "x-no-cookie": "1",
      },
    });
    expect(down.status).toBe(503);
  });

  it("removes the webhook it registered when the integration is disconnected", async () => {
    calls.length = 0;
    const res = await request(`/api/integrations/${integration.clickup}`, { method: "DELETE" });
    expect(res.status).toBe(204);
    expect(calls.some((c) => c.method === "DELETE" && c.url.endsWith("/webhook/cu-hook"))).toBe(true);
    expect(
      (await db()`select count(*)::int as n from issue_integration where id = ${integration.clickup}`)[0]?.n,
    ).toBe(0);
  });
});
