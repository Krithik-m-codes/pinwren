import { createHmac } from "node:crypto";
import { ISSUE_PROVIDERS } from "@pinwren/core";
import { beforeAll, describe, expect, it } from "vitest";

// The tracker adapter SDK and the Trello / Asana / ClickUp / Notion adapters (ADR 0032). Every outbound call
// goes through an injected fetch: nothing here touches the network or a database.

beforeAll(() => {
  process.env.DATABASE_URL ??= "postgres://unused";
  process.env.PINWREN_URL ??= "http://localhost:3100";
  process.env.PINWREN_SECRET ??= "x".repeat(48);
});

type Seen = { url: string; method: string; headers: Headers; body: unknown };
type Reply = { status?: number; json?: unknown; text?: string; headers?: Record<string, string> };

/** A fake `safeFetch` that records each request and answers from `reply` (which may be a queue). */
function fakeFetch(reply: ((s: Seen) => Reply) | Reply[]) {
  const seen: Seen[] = [];
  const queue = Array.isArray(reply) ? [...reply] : null;
  const impl = ((url: string, init: RequestInit) => {
    const s: Seen = {
      url,
      method: init.method ?? "GET",
      headers: new Headers(init.headers),
      body: typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : null,
    };
    seen.push(s);
    const r = queue ? (queue.shift() ?? {}) : (reply as (s: Seen) => Reply)(s);
    const status = r.status ?? 200;
    const body = status === 204 ? null : (r.text ?? JSON.stringify(r.json ?? {}));
    return Promise.resolve(new Response(body, { status, headers: r.headers ?? {} }));
  }) as unknown as typeof fetch;
  return { impl, seen };
}

const hex = (secret: string, raw: string) => createHmac("sha256", secret).update(raw).digest("hex");
const req = (raw: string, headers: Record<string, string>, callbackUrl = "http://localhost:3100/hook") => ({
  raw,
  headers: new Headers(headers),
  body: JSON.parse(raw || "{}") as Record<string, unknown>,
  callbackUrl,
});

const issue = {
  title: "#7 Button is broken",
  body: "**md** body",
  labels: ["feedback"],
  kind: "bug",
  priority: "high",
  source: {
    number: 7,
    quote: "<b>hi</b> @everyone [x](https://evil.example)\nline two",
    facts: [["Project", "Site"]] as [string, string][],
    link: "http://localhost:3100/inbox?item=f1",
    productName: "Pinwren",
  },
};

describe("adapter registry", () => {
  it("has one adapter per provider, with webhooks for every board tracker", async () => {
    const { ADAPTERS } = await import("./integrations/adapters");
    const { BOARD_PROVIDERS } = await import("@pinwren/core");
    expect(Object.keys(ADAPTERS).sort()).toEqual([...ISSUE_PROVIDERS].sort());
    for (const p of ISSUE_PROVIDERS) expect(ADAPTERS[p].provider).toBe(p);
    for (const p of BOARD_PROVIDERS) {
      const hooks = ADAPTERS[p].webhooks;
      expect(hooks, p).toBeDefined();
      expect(typeof hooks?.verify, p).toBe("function");
      expect(typeof hooks?.events, p).toBe("function");
      expect(typeof ADAPTERS[p].findExisting, p).toBe("function");
    }
  });

  it("gives board trackers a webhook URL that names the integration", async () => {
    const { webhookUrlFor } = await import("./integrations/issues");
    const id = "11111111-1111-4111-8111-111111111111";
    expect(webhookUrlFor("github", id)).toBe("http://localhost:3100/api/integrations/github/webhook");
    expect(webhookUrlFor("notion", id)).toBe(`http://localhost:3100/api/integrations/notion/webhook?i=${id}`);
  });
});

describe("HTTP client backoff", () => {
  it("waits out a 429 with Retry-After and retries", async () => {
    const { backoff } = await import("./integrations/sdk/http");
    const { createIssue } = await import("./integrations/trackers");
    const slept: number[] = [];
    const real = backoff.sleep;
    backoff.sleep = (ms) => {
      slept.push(ms);
      return Promise.resolve();
    };
    try {
      // Asana wraps its answers in { data }.
      const wrapped = fakeFetch([
        { status: 429, headers: { "retry-after": "2" } },
        { json: { data: { gid: "1200", permalink_url: "https://app.asana.com/0/1/1200" } } },
      ]);
      const ref = await createIssue(
        { provider: "asana", token: "asana_pat_123", repo: "123456", apiUrl: null, settings: {} },
        { title: "t", body: "b", labels: [] },
        wrapped.impl,
      );
      expect(ref.externalId).toBe("1200");
      expect(wrapped.seen).toHaveLength(2);
      expect(slept).toEqual([2000]);
    } finally {
      backoff.sleep = real;
    }
  });

  it("gives up with the wait when the tracker asks for longer than it is worth waiting", async () => {
    const { createIssue, TrackerError } = await import("./integrations/trackers");
    const { impl, seen } = fakeFetch([{ status: 429, headers: { "retry-after": "120" } }]);
    const err = await createIssue(
      { provider: "clickup", token: "pk_123456789", repo: "9001", apiUrl: null, settings: {} },
      { title: "t", body: "b", labels: [] },
      impl,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TrackerError);
    expect((err as InstanceType<typeof TrackerError>).status).toBe(429);
    expect((err as InstanceType<typeof TrackerError>).retryAfterMs).toBe(120_000);
    expect(seen).toHaveLength(1);
  });

  it("retries a 503 with exponential backoff, at most twice, then reports it", async () => {
    const { backoff } = await import("./integrations/sdk/http");
    const { setIssueState } = await import("./integrations/trackers");
    const slept: number[] = [];
    const real = { sleep: backoff.sleep, jitter: backoff.jitter };
    backoff.sleep = (ms) => {
      slept.push(ms);
      return Promise.resolve();
    };
    backoff.jitter = () => 0;
    try {
      const { impl, seen } = fakeFetch(() => ({ status: 503, json: { message: "maintenance" } }));
      await expect(
        setIssueState(
          { provider: "asana", token: "asana_pat_123", repo: "123456", apiUrl: null },
          { number: null, externalId: "55" },
          "closed",
          impl,
        ),
      ).rejects.toThrow(/503 maintenance/);
      expect(seen).toHaveLength(3);
      expect(slept).toEqual([500, 1000]);
    } finally {
      Object.assign(backoff, real);
    }
  });

  it("does not retry the existing trackers (their jobs retry instead)", async () => {
    const { createIssue } = await import("./integrations/trackers");
    const { impl, seen } = fakeFetch(() => ({ status: 429, json: { message: "rate limited" } }));
    await expect(
      createIssue(
        { provider: "github", token: "ghp_x", repo: "acme/web", apiUrl: "https://ghe.example.com/api/v3" },
        { title: "t", body: "b", labels: [] },
        impl,
      ),
    ).rejects.toThrow(/429 rate limited/);
    expect(seen).toHaveLength(1);
  });

  it("never echoes a raw body, but shows a short plain-text error from Trello", async () => {
    const { checkAccess } = await import("./integrations/trackers");
    const trello = {
      provider: "trello" as const,
      token: "tok",
      repo: "5f1a2b3c4d5e6f7a8b9c0d1e",
      apiUrl: null,
      apiKey: "key12345",
      settings: {},
    };
    const a = await checkAccess(trello, fakeFetch(() => ({ status: 401, text: "invalid token" })).impl);
    expect(a).toEqual({ ok: false, message: "401 invalid token (check the API key and the token)" });
    const notion = {
      provider: "notion" as const,
      token: "secret_x",
      repo: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
      apiUrl: null,
      settings: {},
    };
    const b = await checkAccess(
      notion,
      fakeFetch(() => ({ status: 500, text: "<html>internal path /srv</html>" })).impl,
    );
    expect(b.ok).toBe(false);
    expect((b as { message: string }).message).not.toContain("/srv");
  });
});

describe("Trello", () => {
  const cfg = {
    provider: "trello" as const,
    token: "tok_abcdef",
    apiKey: "key_abcdef",
    repo: "5f1a2b3c4d5e6f7a8b9c0d1e",
    apiUrl: null,
    settings: { listId: "list1", doneListId: "list9", priorityHigh: "High priority" },
  };

  it("creates a card on the list with matched labels, authenticated by header", async () => {
    const { createIssue } = await import("./integrations/trackers");
    const { impl, seen } = fakeFetch((s) =>
      s.url.includes("/labels")
        ? {
            json: [
              { id: "lb1", name: "Feedback" },
              { id: "lb2", name: "High priority" },
            ],
          }
        : { json: { id: "card1", idShort: 42, shortUrl: "https://trello.com/c/abc" } },
    );
    const ref = await createIssue(cfg, issue, impl);
    expect(ref).toEqual({ number: 42, url: "https://trello.com/c/abc", externalId: "card1" });
    expect(seen[0]?.url).toBe(
      "https://api.trello.com/1/boards/5f1a2b3c4d5e6f7a8b9c0d1e/labels?fields=name&limit=1000",
    );
    expect(seen[0]?.headers.get("authorization")).toBe(
      'OAuth oauth_consumer_key="key_abcdef", oauth_token="tok_abcdef"',
    );
    expect(seen.every((s) => !s.url.includes("tok_abcdef") && !s.url.includes("key_abcdef"))).toBe(true);
    expect(seen[1]?.body).toMatchObject({
      idList: "list1",
      name: issue.title,
      idLabels: "lb1,lb2",
      pos: "top",
    });
  });

  it("needs a list, and skips labels the board doesn't have", async () => {
    const { createIssue, TrackerError } = await import("./integrations/trackers");
    await expect(
      createIssue({ ...cfg, settings: {} }, issue, fakeFetch(() => ({ json: [] })).impl),
    ).rejects.toBeInstanceOf(TrackerError);
    const { impl, seen } = fakeFetch((s) =>
      s.url.includes("/labels")
        ? { json: [] }
        : { json: { id: "c", idShort: 1, shortUrl: "https://trello.com/c/x" } },
    );
    await createIssue(cfg, issue, impl);
    expect(seen[1]?.body).not.toHaveProperty("idLabels");
  });

  it("moves the card to the done list and back, or archives it without one", async () => {
    const { setIssueState } = await import("./integrations/trackers");
    const a = fakeFetch(() => ({ json: {} }));
    await setIssueState(cfg, { number: 42, externalId: "card1" }, "closed", a.impl);
    expect(a.seen[0]).toMatchObject({ method: "PUT", url: "https://api.trello.com/1/cards/card1" });
    expect(a.seen[0]?.body).toEqual({ idList: "list9", closed: false });
    const b = fakeFetch(() => ({ json: {} }));
    await setIssueState(cfg, { number: 42, externalId: "card1" }, "open", b.impl);
    expect(b.seen[0]?.body).toEqual({ idList: "list1", closed: false });
    const c = fakeFetch(() => ({ json: {} }));
    await setIssueState(
      { ...cfg, settings: { listId: "list1" } },
      { number: 1, externalId: "card1" },
      "closed",
      c.impl,
    );
    expect(c.seen[0]?.body).toEqual({ closed: true });
  });

  it("tests the connection, resolving the board id and checking the list belongs to it", async () => {
    const { checkAccess } = await import("./integrations/trackers");
    const ok = await checkAccess(
      { ...cfg, repo: "AbCd1234" },
      fakeFetch((s) =>
        s.url.includes("/boards/")
          ? { json: { id: "5f1a2b3c4d5e6f7a8b9c0d1e", name: "Roadmap" } }
          : { json: { idBoard: "5f1a2b3c4d5e6f7a8b9c0d1e" } },
      ).impl,
    );
    expect(ok).toEqual({ ok: true, name: "Roadmap", repo: "5f1a2b3c4d5e6f7a8b9c0d1e" });
    const other = await checkAccess(
      cfg,
      fakeFetch((s) =>
        s.url.includes("/boards/")
          ? { json: { id: "5f1a2b3c4d5e6f7a8b9c0d1e", name: "Roadmap" } }
          : { json: { idBoard: "someOtherBoard" } },
      ).impl,
    );
    expect(other).toEqual({ ok: false, message: "The list is not on this board" });
  });

  it("finds a card an interrupted create already made", async () => {
    const { findExistingIssue } = await import("./integrations/trackers");
    const { impl, seen } = fakeFetch(() => ({
      json: [
        { id: "x", idShort: 1, name: "other", shortUrl: "https://trello.com/c/x" },
        { id: "card1", idShort: 42, name: issue.title, shortUrl: "https://trello.com/c/abc" },
      ],
    }));
    expect(await findExistingIssue(cfg, issue, impl)).toEqual({
      number: 42,
      url: "https://trello.com/c/abc",
      externalId: "card1",
    });
    expect(seen[0]?.url).toContain("/lists/list1/cards");
    expect(await findExistingIssue(cfg, { ...issue, title: "nope" }, impl)).toBeNull();
  });

  it("registers the webhook on the board's long id and removes it", async () => {
    const { adapterFor } = await import("./integrations/trackers");
    const hooks = adapterFor("trello").webhooks;
    const { impl, seen } = fakeFetch(() => ({ json: { id: "wh1" } }));
    expect(
      await hooks?.register?.(cfg, "http://localhost:3100/api/integrations/trello/webhook?i=1", impl),
    ).toEqual({
      ref: "wh1",
    });
    expect(seen[0]?.body).toEqual({
      callbackURL: "http://localhost:3100/api/integrations/trello/webhook?i=1",
      idModel: "5f1a2b3c4d5e6f7a8b9c0d1e",
      description: "Pinwren",
    });
    await hooks?.unregister?.(cfg, "wh1", impl);
    expect(seen[1]).toMatchObject({ method: "DELETE", url: "https://api.trello.com/1/webhooks/wh1" });
  });

  it("verifies X-Trello-Webhook over the body and the callback URL", async () => {
    const { adapterFor } = await import("./integrations/trackers");
    const hooks = adapterFor("trello").webhooks;
    const raw = JSON.stringify({ action: { id: "a1", type: "updateCard", data: {} } });
    const cb = "http://localhost:3100/api/integrations/trello/webhook?i=1";
    const sign = (secret: string, url = cb) =>
      createHmac("sha1", secret).update(raw).update(url).digest("base64");
    expect(hooks?.verify("app-secret", req(raw, { "x-trello-webhook": sign("app-secret") }, cb))).toBe(true);
    expect(hooks?.verify("app-secret", req(raw, { "x-trello-webhook": sign("other") }, cb))).toBe(false);
    // A signature made for a different callback URL (another integration) is refused.
    expect(
      hooks?.verify("app-secret", req(raw, { "x-trello-webhook": sign("app-secret", cb + "2") }, cb)),
    ).toBe(false);
    expect(hooks?.verify("app-secret", req(raw, { "x-trello-webhook": "not base64" }, cb))).toBe(false);
    expect(hooks?.verify("app-secret", req(raw, {}, cb))).toBe(false);
  });

  it("reads moves to and from the done list, and archiving when there is none", async () => {
    const { adapterFor } = await import("./integrations/trackers");
    const hooks = adapterFor("trello").webhooks;
    if (!hooks) throw new Error("no webhooks");
    const ev = (data: object, type = "updateCard") =>
      hooks.events(
        cfg,
        req(JSON.stringify({ action: { id: "a", type, data } }), {}),
        fakeFetch(() => ({})).impl,
      );
    const card = { id: "card1", idShort: 42 };
    expect(await ev({ card, listAfter: { id: "list9" }, listBefore: { id: "list1" } })).toEqual([
      { number: 42, externalId: "card1", state: "closed" },
    ]);
    expect(await ev({ card, listAfter: { id: "list1" }, listBefore: { id: "list9" } })).toEqual([
      { number: 42, externalId: "card1", state: "open" },
    ]);
    expect(await ev({ card, listAfter: { id: "list2" }, listBefore: { id: "list1" } })).toEqual([]);
    expect(await ev({ card, listAfter: { id: "list9" } }, "createCard")).toEqual([]);
    const noDone = { ...cfg, settings: { listId: "list1" } };
    const archived = await hooks.events(
      noDone,
      req(
        JSON.stringify({
          action: {
            id: "a",
            type: "updateCard",
            data: { card: { ...card, closed: true }, old: { closed: false } },
          },
        }),
        {},
      ),
      fakeFetch(() => ({})).impl,
    );
    expect(archived).toEqual([{ number: 42, externalId: "card1", state: "closed" }]);
  });
});

describe("Asana", () => {
  const cfg = {
    provider: "asana" as const,
    token: "asana_pat_123",
    repo: "1200000001",
    apiUrl: null,
    settings: { sectionGid: "sec1", priorityField: "cf1", priorityHigh: "opt-high" },
  };

  it("creates a task in the project with plain-text notes, tags, priority and a section", async () => {
    const { createIssue } = await import("./integrations/trackers");
    const { impl, seen } = fakeFetch((s) => {
      if (s.url.includes("/projects/") && s.url.includes("workspace"))
        return { json: { data: { workspace: { gid: "w1" } } } };
      if (s.url.includes("/tags")) return { json: { data: [{ gid: "tag1", name: "feedback" }] } };
      if (s.url.endsWith("/tasks"))
        return { json: { data: { gid: "9001", permalink_url: "https://app.asana.com/0/1/9001" } } };
      return { json: { data: {} } };
    });
    const ref = await createIssue(cfg, issue, impl);
    expect(ref).toEqual({ number: null, url: "https://app.asana.com/0/1/9001", externalId: "9001" });
    expect(seen[0]?.headers.get("authorization")).toBe("Bearer asana_pat_123");
    const create = seen.find((s) => s.url.endsWith("/tasks"))?.body as { data: Record<string, unknown> };
    expect(create.data).toMatchObject({
      name: issue.title,
      projects: ["1200000001"],
      tags: ["tag1"],
      custom_fields: { cf1: "opt-high" },
    });
    // Plain text: the reporter's words are quoted verbatim, never turned into markup or links.
    expect(create.data.notes).toContain("> <b>hi</b> @everyone [x](https://evil.example)");
    expect(create.data.notes).toContain("Open #7 in Pinwren: http://localhost:3100/inbox?item=f1");
    expect(create.data).not.toHaveProperty("html_notes");
    expect(seen.at(-1)).toMatchObject({
      method: "POST",
      url: "https://app.asana.com/api/1.0/sections/sec1/addTask",
    });
    expect(seen.at(-1)?.body).toEqual({ data: { task: "9001" } });
  });

  it("completes and uncompletes the task", async () => {
    const { setIssueState } = await import("./integrations/trackers");
    const { impl, seen } = fakeFetch(() => ({ json: { data: {} } }));
    await setIssueState(cfg, { number: null, externalId: "9001" }, "closed", impl);
    await setIssueState(cfg, { number: null, externalId: "9001" }, "open", impl);
    expect(seen.map((s) => s.body)).toEqual([{ data: { completed: true } }, { data: { completed: false } }]);
    expect(seen[0]).toMatchObject({ method: "PUT", url: "https://app.asana.com/api/1.0/tasks/9001" });
  });

  it("registers a project webhook filtered to completion changes", async () => {
    const { adapterFor } = await import("./integrations/trackers");
    const hooks = adapterFor("asana").webhooks;
    const { impl, seen } = fakeFetch(() => ({ json: { data: { gid: "wh9" } } }));
    expect(await hooks?.register?.(cfg, "https://pinwren.example/hook?i=1", impl)).toEqual({ ref: "wh9" });
    expect(seen[0]?.body).toEqual({
      data: {
        resource: "1200000001",
        target: "https://pinwren.example/hook?i=1",
        filters: [{ resource_type: "task", action: "changed", fields: ["completed"] }],
      },
    });
  });

  it("answers the handshake by echoing X-Hook-Secret, and ignores ordinary deliveries", async () => {
    const { adapterFor } = await import("./integrations/trackers");
    const hooks = adapterFor("asana").webhooks;
    expect(hooks?.handshake?.(req("{}", { "x-hook-secret": "s3cret-from-asana" }))).toEqual({
      secret: "s3cret-from-asana",
      reply: { "x-hook-secret": "s3cret-from-asana" },
    });
    expect(hooks?.handshake?.(req('{"events":[]}', {}))).toBeNull();
  });

  it("verifies X-Hook-Signature", async () => {
    const { adapterFor } = await import("./integrations/trackers");
    const hooks = adapterFor("asana").webhooks;
    const raw = '{"events":[]}';
    expect(hooks?.verify("sec", req(raw, { "x-hook-signature": hex("sec", raw) }))).toBe(true);
    expect(hooks?.verify("sec", req(raw, { "x-hook-signature": hex("other", raw) }))).toBe(false);
    expect(hooks?.verify("sec", req(raw + " ", { "x-hook-signature": hex("sec", raw) }))).toBe(false);
    expect(hooks?.verify("sec", req(raw, {}))).toBe(false);
  });

  it("reads each changed task once and reports its completion", async () => {
    const { adapterFor } = await import("./integrations/trackers");
    const hooks = adapterFor("asana").webhooks;
    const event = (gid: string, field = "completed") => ({
      action: "changed",
      resource: { gid, resource_type: "task" },
      change: { field, action: "changed" },
    });
    const body = {
      events: [
        event("1"),
        event("1"),
        event("2"),
        event("3", "name"),
        { action: "added", resource: { gid: "4", resource_type: "task" } },
      ],
    };
    const { impl, seen } = fakeFetch((s) => ({
      json: { data: { completed: s.url.includes("/tasks/1?") } },
    }));
    const out = await hooks?.events(cfg, req(JSON.stringify(body), {}), impl);
    expect(out).toEqual([
      { number: null, externalId: "1", state: "closed" },
      { number: null, externalId: "2", state: "open" },
    ]);
    expect(seen).toHaveLength(2);
  });

  it("tests the connection and that the section is in the project", async () => {
    const { checkAccess } = await import("./integrations/trackers");
    const ok = await checkAccess(
      cfg,
      fakeFetch((s) =>
        s.url.includes("/sections/")
          ? { json: { data: { project: { gid: "1200000001" } } } }
          : { json: { data: { name: "Website" } } },
      ).impl,
    );
    expect(ok).toEqual({ ok: true, name: "Website" });
    const bad = await checkAccess(
      cfg,
      fakeFetch((s) =>
        s.url.includes("/sections/")
          ? { json: { data: { project: { gid: "elsewhere" } } } }
          : { json: { data: { name: "Website" } } },
      ).impl,
    );
    expect(bad).toEqual({ ok: false, message: "The section is not in this project" });
    const denied = await checkAccess(
      cfg,
      fakeFetch(() => ({ status: 403, json: { errors: [{ message: "Not authorized" }] } })).impl,
    );
    expect(denied).toEqual({
      ok: false,
      message: "403 Not authorized (check the project id and the token's access)",
    });
  });

  it("finds an existing task by its title", async () => {
    const { findExistingIssue } = await import("./integrations/trackers");
    const { impl } = fakeFetch(() => ({
      json: { data: [{ gid: "9001", name: issue.title, permalink_url: "https://app.asana.com/0/1/9001" }] },
    }));
    expect(await findExistingIssue(cfg, issue, impl)).toMatchObject({ externalId: "9001" });
  });
});

describe("ClickUp", () => {
  const cfg = {
    provider: "clickup" as const,
    token: "pk_123456789",
    repo: "9001",
    apiUrl: null,
    settings: {} as Record<string, string>,
  };
  const statuses = [
    { status: "to do", type: "open", orderindex: 0 },
    { status: "in progress", type: "custom", orderindex: 1 },
    { status: "complete", type: "closed", orderindex: 2 },
  ];

  it("creates a task with the mapped priority and adds tags after, tolerating unknown tags", async () => {
    const { createIssue } = await import("./integrations/trackers");
    const { impl, seen } = fakeFetch((s) =>
      s.url.includes("/tag/")
        ? { status: 400, json: { err: "Tag does not exist" } }
        : { json: { id: "86abc", custom_id: "WEB-12", url: "https://app.clickup.com/t/86abc" } },
    );
    const ref = await createIssue({ ...cfg, settings: { priorityHigh: "1" } }, issue, impl);
    expect(ref).toEqual({
      number: null,
      url: "https://app.clickup.com/t/86abc",
      externalId: "86abc",
      key: "WEB-12",
    });
    expect(seen[0]?.headers.get("authorization")).toBe("pk_123456789");
    expect(seen[0]?.url).toBe("https://api.clickup.com/api/v2/list/9001/task");
    expect(seen[0]?.body).toMatchObject({ name: issue.title, markdown_description: issue.body, priority: 1 });
    expect(seen[1]).toMatchObject({
      method: "POST",
      url: "https://api.clickup.com/api/v2/task/86abc/tag/feedback",
    });
    const dflt = fakeFetch(() => ({ json: { id: "a", url: "https://app.clickup.com/t/a" } }));
    await createIssue(cfg, { ...issue, labels: [] }, dflt.impl);
    expect(dflt.seen[0]?.body).toMatchObject({ priority: 2 });
    await createIssue(cfg, { ...issue, labels: [], priority: "none" }, dflt.impl);
    expect(dflt.seen[1]?.body).not.toHaveProperty("priority");
  });

  it("sets the list's closed / first open status, or the configured ones", async () => {
    const { setIssueState } = await import("./integrations/trackers");
    const a = fakeFetch((s) => (s.method === "GET" ? { json: { name: "Bugs", statuses } } : { json: {} }));
    await setIssueState(cfg, { number: null, externalId: "86abc" }, "closed", a.impl);
    await setIssueState(cfg, { number: null, externalId: "86abc" }, "open", a.impl);
    const puts = a.seen.filter((s) => s.method === "PUT");
    expect(puts.map((p) => p.body)).toEqual([{ status: "complete" }, { status: "to do" }]);
    expect(puts[0]?.url).toBe("https://api.clickup.com/api/v2/task/86abc");
    const b = fakeFetch(() => ({ json: {} }));
    await setIssueState(
      { ...cfg, settings: { closedStatus: "shipped" } },
      { number: null, externalId: "86abc" },
      "closed",
      b.impl,
    );
    expect(b.seen).toHaveLength(1);
    expect(b.seen[0]?.body).toEqual({ status: "shipped" });
  });

  it("registers a list webhook (finding the only workspace) and returns the signing secret", async () => {
    const { adapterFor } = await import("./integrations/trackers");
    const hooks = adapterFor("clickup").webhooks;
    const { impl, seen } = fakeFetch((s) =>
      s.method === "GET"
        ? { json: { teams: [{ id: "333" }] } }
        : { json: { id: "wh1", webhook: { id: "wh1", secret: "clickup-secret" } } },
    );
    expect(await hooks?.register?.(cfg, "https://pinwren.example/hook?i=1", impl)).toEqual({
      ref: "wh1",
      secret: "clickup-secret",
    });
    expect(seen[1]?.url).toBe("https://api.clickup.com/api/v2/team/333/webhook");
    expect(seen[1]?.body).toEqual({
      endpoint: "https://pinwren.example/hook?i=1",
      events: ["taskStatusUpdated"],
      list_id: 9001,
    });
    // Several workspaces and no teamId: ask rather than guess.
    const many = fakeFetch(() => ({ json: { teams: [{ id: "1" }, { id: "2" }] } }));
    await expect(hooks?.register?.(cfg, "https://pinwren.example/hook?i=1", many.impl)).rejects.toThrow(
      /teamId/,
    );
  });

  it("verifies X-Signature and builds a delivery id from the history item", async () => {
    const { adapterFor } = await import("./integrations/trackers");
    const hooks = adapterFor("clickup").webhooks;
    const raw = JSON.stringify({
      webhook_id: "wh1",
      event: "taskStatusUpdated",
      task_id: "86abc",
      history_items: [{ id: "h1" }],
    });
    expect(hooks?.verify("s", req(raw, { "x-signature": hex("s", raw) }))).toBe(true);
    expect(hooks?.verify("s", req(raw, { "x-signature": hex("t", raw) }))).toBe(false);
    expect(hooks?.verify("s", req(raw, {}))).toBe(false);
    expect(hooks?.deliveryId(req(raw, {}))).toBe("wh1:h1");
  });

  it("reads status changes: closed / done types close, others reopen; a configured closed status wins", async () => {
    const { adapterFor } = await import("./integrations/trackers");
    const hooks = adapterFor("clickup").webhooks;
    if (!hooks) throw new Error("no webhooks");
    const delivery = (after: object, event = "taskStatusUpdated", field = "status") =>
      req(JSON.stringify({ event, task_id: "86abc", history_items: [{ field, after }] }), {});
    const run = (c: typeof cfg, r: ReturnType<typeof req>) => hooks.events(c, r, fakeFetch(() => ({})).impl);
    expect(await run(cfg, delivery({ status: "complete", type: "closed" }))).toEqual([
      { number: null, externalId: "86abc", state: "closed" },
    ]);
    expect(await run(cfg, delivery({ status: "in progress", type: "custom" }))).toEqual([
      { number: null, externalId: "86abc", state: "open" },
    ]);
    expect(
      await run(
        { ...cfg, settings: { closedStatus: "Shipped" } },
        delivery({ status: "shipped", type: "custom" }),
      ),
    ).toEqual([{ number: null, externalId: "86abc", state: "closed" }]);
    expect(await run(cfg, delivery({ status: "x" }, "taskCreated"))).toEqual([]);
    expect(await run(cfg, delivery({ status: "x" }, "taskStatusUpdated", "assignee"))).toEqual([]);
  });

  it("tests the connection against the list's statuses", async () => {
    const { checkAccess } = await import("./integrations/trackers");
    const reply = fakeFetch(() => ({ json: { name: "Bugs", statuses } })).impl;
    expect(await checkAccess(cfg, reply)).toEqual({ ok: true, name: "Bugs" });
    const bad = await checkAccess({ ...cfg, settings: { closedStatus: "nope" } }, reply);
    expect(bad).toEqual({ ok: false, message: 'The list has no status called "nope" (closedStatus)' });
    const none = await checkAccess(
      cfg,
      fakeFetch(() => ({ json: { name: "Bugs", statuses: [statuses[0]] } })).impl,
    );
    expect(none.ok).toBe(false);
  });
});

describe("Notion", () => {
  const db = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";
  const cfg = {
    provider: "notion" as const,
    token: "secret_abc123",
    repo: db,
    apiUrl: null,
    settings: { priorityProperty: "Priority", priorityHigh: "P1" } as Record<string, string>,
  };
  const schema = {
    title: [{ plain_text: "Feedback" }],
    properties: {
      Name: { id: "title", type: "title" },
      Status: { id: "s", type: "status" },
      Priority: { id: "p", type: "select" },
      Tags: { id: "t", type: "multi_select" },
    },
  };

  it("creates a page whose properties follow the database schema and whose text stays text", async () => {
    const { createIssue } = await import("./integrations/trackers");
    const { impl, seen } = fakeFetch((s) =>
      s.method === "GET"
        ? { json: schema }
        : { json: { id: "ABCDEFABCDEFABCDEFABCDEFABCDEFAB", url: "https://www.notion.so/Page-abcdef" } },
    );
    const ref = await createIssue(cfg, issue, impl);
    expect(ref).toEqual({
      number: null,
      url: "https://www.notion.so/Page-abcdef",
      externalId: "abcdefab-cdef-abcd-efab-cdefabcdefab",
    });
    expect(seen[0]?.headers.get("notion-version")).toBe("2022-06-28");
    expect(seen[0]?.headers.get("authorization")).toBe("Bearer secret_abc123");
    const body = seen[1]?.body as {
      parent: unknown;
      properties: Record<string, unknown>;
      children: object[];
    };
    expect(body.parent).toEqual({ database_id: db });
    expect(body.properties).toEqual({
      Name: { title: [{ type: "text", text: { content: issue.title } }] },
      Status: { status: { name: "Not started" } },
      Priority: { select: { name: "P1" } },
      Tags: { multi_select: [{ name: "feedback" }] },
    });
    // The quote is a text run: no link, no mention, no annotations; only the dashboard link is a link.
    const text = JSON.stringify(body.children);
    expect(body.children[0]).toMatchObject({
      type: "quote",
      quote: {
        rich_text: [{ type: "text", text: { content: "<b>hi</b> @everyone [x](https://evil.example)" } }],
      },
    });
    expect(text.match(/"link"/g)).toHaveLength(1);
    expect(text).toContain("http://localhost:3100/inbox?item=f1");
    expect(text).not.toContain('"mention"');
  });

  it("splits long text into 2000-character runs and caps the blocks", async () => {
    const { createIssue } = await import("./integrations/trackers");
    const { impl, seen } = fakeFetch((s) =>
      s.method === "GET" ? { json: schema } : { json: { id: "abc", url: "https://www.notion.so/x" } },
    );
    await createIssue(cfg, { ...issue, source: { ...issue.source, quote: "x".repeat(4500) } }, impl);
    const body = seen[1]?.body as { children: { quote?: { rich_text: { text: { content: string } }[] } }[] };
    expect(body.children[0]?.quote?.rich_text.map((r) => r.text.content.length)).toEqual([2000, 2000, 500]);
    const lots = fakeFetch((s) =>
      s.method === "GET" ? { json: schema } : { json: { id: "abc", url: "https://www.notion.so/x" } },
    );
    await createIssue(
      cfg,
      { ...issue, source: { ...issue.source, quote: Array.from({ length: 300 }, () => "l").join("\n") } },
      lots.impl,
    );
    expect((lots.seen[1]?.body as { children: unknown[] }).children.length).toBeLessThanOrEqual(100);
  });

  it("sets the status by property type: status, select (configured values) and checkbox", async () => {
    const { setIssueState } = await import("./integrations/trackers");
    const target = { number: null, externalId: "page1" };
    const status = fakeFetch((s) => (s.method === "GET" ? { json: schema } : { json: {} }));
    await setIssueState(cfg, target, "closed", status.impl);
    expect(status.seen[1]).toMatchObject({ method: "PATCH", url: "https://api.notion.com/v1/pages/page1" });
    expect(status.seen[1]?.body).toEqual({ properties: { Status: { status: { name: "Done" } } } });
    const select = fakeFetch((s) =>
      s.method === "GET"
        ? { json: { ...schema, properties: { ...schema.properties, Stage: { type: "select" } } } }
        : { json: {} },
    );
    await setIssueState(
      { ...cfg, settings: { statusProperty: "stage", closedValue: "Shipped", openValue: "Backlog" } },
      target,
      "open",
      select.impl,
    );
    expect(select.seen[1]?.body).toEqual({ properties: { Stage: { select: { name: "Backlog" } } } });
    const check = fakeFetch((s) =>
      s.method === "GET"
        ? { json: { ...schema, properties: { Name: { type: "title" }, Done: { type: "checkbox" } } } }
        : { json: {} },
    );
    await setIssueState({ ...cfg, settings: { statusProperty: "Done" } }, target, "closed", check.impl);
    expect(check.seen[1]?.body).toEqual({ properties: { Done: { checkbox: true } } });
    const none = fakeFetch(() => ({ json: { ...schema, properties: { Name: { type: "title" } } } }));
    await expect(setIssueState(cfg, target, "closed", none.impl)).rejects.toThrow(/no status property/);
  });

  it("captures the verification token and verifies X-Notion-Signature with it", async () => {
    const { adapterFor } = await import("./integrations/trackers");
    const hooks = adapterFor("notion").webhooks;
    expect(hooks?.handshake?.(req('{"verification_token":"secret_verify_token"}', {}))).toEqual({
      secret: "secret_verify_token",
    });
    expect(hooks?.handshake?.(req('{"type":"page.created"}', {}))).toBeNull();
    const raw = JSON.stringify({ id: "ev1", type: "page.properties_updated" });
    const sig = `sha256=${hex("secret_verify_token", raw)}`;
    expect(hooks?.verify("secret_verify_token", req(raw, { "x-notion-signature": sig }))).toBe(true);
    expect(hooks?.verify("secret_other_token", req(raw, { "x-notion-signature": sig }))).toBe(false);
    expect(
      hooks?.verify(
        "secret_verify_token",
        req(raw, { "x-notion-signature": hex("secret_verify_token", raw) }),
      ),
    ).toBe(false);
    expect(hooks?.deliveryId(req(raw, {}))).toBe("ev1");
  });

  it("reads the page when its properties change, only for pages of this database", async () => {
    const { adapterFor } = await import("./integrations/trackers");
    const hooks = adapterFor("notion").webhooks;
    if (!hooks) throw new Error("no webhooks");
    const delivery = (parent: string, type = "page.properties_updated") =>
      req(
        JSON.stringify({
          id: "e",
          type,
          entity: { id: "ABCDEFABCDEFABCDEFABCDEFABCDEFAB", type: "page" },
          data: { parent: { id: parent, type: "database" } },
        }),
        {},
      );
    const page = (props: object) => fakeFetch(() => ({ json: { properties: props } }));
    const done = page({ Status: { type: "status", status: { name: "Done" } } });
    expect(await hooks.events(cfg, delivery(db), done.impl)).toEqual([
      { number: null, externalId: "abcdefab-cdef-abcd-efab-cdefabcdefab", state: "closed" },
    ]);
    expect(done.seen[0]?.url).toBe("https://api.notion.com/v1/pages/ABCDEFABCDEFABCDEFABCDEFABCDEFAB");
    const wip = page({ Status: { type: "status", status: { name: "In progress" } } });
    expect((await hooks.events(cfg, delivery(db.replaceAll("-", "")), wip.impl))[0]?.state).toBe("open");
    const checked = page({ Done: { type: "checkbox", checkbox: true } });
    expect(
      (await hooks.events({ ...cfg, settings: { statusProperty: "done" } }, delivery(db), checked.impl))[0]
        ?.state,
    ).toBe("closed");
    // Another database's page, another event type, or a page with no status: nothing to do, nothing fetched.
    const other = page({});
    expect(await hooks.events(cfg, delivery("ffffffff-ffff-4fff-8fff-ffffffffffff"), other.impl)).toEqual([]);
    expect(await hooks.events(cfg, delivery(db, "page.created"), other.impl)).toEqual([]);
    expect(other.seen).toHaveLength(0);
    expect(await hooks.events(cfg, delivery(db), page({}).impl)).toEqual([]);
  });

  it("finds an existing page by its title and tests the connection", async () => {
    const { findExistingIssue, checkAccess } = await import("./integrations/trackers");
    const { impl, seen } = fakeFetch((s) =>
      s.method === "GET"
        ? { json: schema }
        : { json: { results: [{ id: "pg1", url: "https://www.notion.so/pg1" }] } },
    );
    expect(await findExistingIssue(cfg, issue, impl)).toMatchObject({ externalId: "pg1" });
    expect(seen[1]?.body).toEqual({
      filter: { property: "Name", title: { equals: issue.title } },
      page_size: 1,
    });
    expect(await checkAccess(cfg, fakeFetch(() => ({ json: schema })).impl)).toEqual({
      ok: true,
      name: "Feedback",
    });
    expect(
      await checkAccess(
        { ...cfg, settings: { statusProperty: "Phase" } },
        fakeFetch(() => ({ json: schema })).impl,
      ),
    ).toEqual({
      ok: false,
      message: 'The database has no property called "Phase"',
    });
    const denied = await checkAccess(
      cfg,
      fakeFetch(() => ({ status: 404, json: { message: "Could not find database" } })).impl,
    );
    expect(denied).toEqual({
      ok: false,
      message: "404 Could not find database (share the database with the integration: ••• › Connections)",
    });
  });

  it("normalises ids", async () => {
    const { notionId } = await import("./integrations/adapters/notion");
    expect(notionId("ABCDEFABCDEFABCDEFABCDEFABCDEFAB")).toBe("abcdefab-cdef-abcd-efab-cdefabcdefab");
    expect(notionId("abcdefab-cdef-abcd-efab-cdefabcdefab")).toBe("abcdefab-cdef-abcd-efab-cdefabcdefab");
  });
});

describe("tracker settings and repository ids", () => {
  it("accepts only the keys a tracker has, and requires Trello's list", async () => {
    const { trackerSettingsError } = await import("@pinwren/core");
    expect(trackerSettingsError("trello", { listId: "l1", doneListId: "l2" })).toBeNull();
    expect(trackerSettingsError("trello", {})).toBe("listId is required");
    expect(trackerSettingsError("trello", { listId: "l1", teamId: "x" })).toMatch(/teamId is not a setting/);
    expect(trackerSettingsError("github", { listId: "l1" })).toMatch(/not a setting/);
    expect(trackerSettingsError("github", {})).toBeNull();
    expect(trackerSettingsError("clickup", { priorityHigh: "5" })).toMatch(/1 \(urgent\) to 4/);
    expect(trackerSettingsError("clickup", { priorityHigh: "2" })).toBeNull();
    expect(trackerSettingsError("notion", { statusProperty: "Status", closedValue: "Done" })).toBeNull();
  });

  it("validates and normalises each tracker's repository id", async () => {
    const { normalizeTrackerRepo, trackerRepoError } = await import("@pinwren/core");
    expect(trackerRepoError("trello", "5f1a2b3c4d5e6f7a8b9c0d1e")).toBeNull();
    expect(trackerRepoError("trello", "AbCd1234")).toBeNull();
    expect(trackerRepoError("trello", "short")).toMatch(/board id/);
    expect(trackerRepoError("asana", "1200000001")).toBeNull();
    expect(trackerRepoError("asana", "abc")).toMatch(/gid/);
    expect(trackerRepoError("clickup", "901234567")).toBeNull();
    expect(trackerRepoError("clickup", "a b")).toMatch(/list id/);
    expect(trackerRepoError("notion", "0f0f0f0f0f0f4f0f8f0f0f0f0f0f0f0f")).toBeNull();
    expect(trackerRepoError("notion", "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f")).toBeNull();
    expect(trackerRepoError("notion", "nope")).toMatch(/database id/);
    expect(normalizeTrackerRepo("notion", "0F0F0F0F0F0F4F0F8F0F0F0F0F0F0F0F")).toBe(
      "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
    );
    expect(normalizeTrackerRepo("trello", " AbCd1234 ")).toBe("AbCd1234");
  });

  it("requires Trello's API key, refuses one elsewhere, and refuses a self-hosted URL on SaaS trackers", async () => {
    const { issueIntegrationCreate } = await import("@pinwren/core");
    const base = { token: "token-12345678", autoCreate: "manual" as const, labels: [] };
    const trello = {
      ...base,
      provider: "trello",
      repo: "5f1a2b3c4d5e6f7a8b9c0d1e",
      settings: { listId: "l1" },
    };
    expect(issueIntegrationCreate.safeParse(trello).success).toBe(false);
    expect(issueIntegrationCreate.safeParse({ ...trello, apiKey: "apikey-12345678" }).success).toBe(true);
    expect(
      issueIntegrationCreate.safeParse({ ...trello, apiKey: "apikey-12345678", settings: {} }).success,
    ).toBe(false);
    const asana = { ...base, provider: "asana", repo: "1200000001" };
    expect(issueIntegrationCreate.safeParse(asana).success).toBe(true);
    expect(issueIntegrationCreate.safeParse({ ...asana, apiKey: "apikey-12345678" }).success).toBe(false);
    expect(issueIntegrationCreate.safeParse({ ...asana, apiUrl: "https://asana.example.com" }).success).toBe(
      false,
    );
    expect(issueIntegrationCreate.safeParse({ ...asana, settings: { bogus: "x" } }).success).toBe(false);
    expect(
      issueIntegrationCreate.safeParse({
        ...base,
        provider: "github",
        repo: "acme/web",
        apiUrl: "https://ghe.example.com/api/v3",
      }).success,
    ).toBe(true);
  });
});

describe("issue source for board trackers", () => {
  it("carries the quote, facts and dashboard link without any escaping the tracker would misread", async () => {
    const { issueSource } = await import("./integrations/issues");
    const s = issueSource({
      number: 7,
      kind: "bug",
      projectName: "Site",
      body: "@here <b>x</b>",
      pageUrl: "https://example.com/a",
      reporterName: "@octocat",
      environment: { browser: "Chrome 140", os: "macOS", viewport: { w: 1280, h: 800 } },
      link: "http://localhost:3100/inbox?item=1",
      productName: "Pinwren",
    });
    expect(s.quote).toBe("@here <b>x</b>");
    expect(s.facts).toContainEqual(["Viewport", "1280 × 800"]);
    expect(s.facts).toContainEqual(["Reporter", "@octocat"]);
    expect(s.link).toBe("http://localhost:3100/inbox?item=1");
  });
});
