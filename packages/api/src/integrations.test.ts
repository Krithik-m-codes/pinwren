import { createHmac } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

// Wave 5 integrations: Teams / Telegram / ntfy channels and Linear / Jira trackers. Every outbound call is
// made through an injected fetch, so nothing here touches the network or the database.

beforeAll(() => {
  process.env.DATABASE_URL ??= "postgres://unused";
  process.env.PINWREN_URL ??= "http://localhost:3100";
  process.env.PINWREN_SECRET ??= "x".repeat(48);
});

type Seen = { url: string; method: string; headers: Headers; body: unknown };

/** A fake `safeFetch` that records each request and answers from `reply`. */
function fakeFetch(reply: (s: Seen) => { status?: number; json?: unknown }) {
  const seen: Seen[] = [];
  const impl = ((url: string, init: RequestInit) => {
    const s: Seen = {
      url,
      method: init.method ?? "GET",
      headers: new Headers(init.headers),
      body: typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : null,
    };
    seen.push(s);
    const r = reply(s);
    const status = r.status ?? 200;
    return Promise.resolve(new Response(status === 204 ? null : JSON.stringify(r.json ?? {}), { status }));
  }) as unknown as typeof fetch;
  return { impl, seen };
}

const payload = (event = "feedback.created", extra: Record<string, unknown> = {}) => ({
  id: "e1",
  event,
  apiVersion: "2026-11-01",
  createdAt: "2026-10-21T00:00:00.000Z",
  data: {
    feedback: {
      id: "f1",
      number: 7,
      projectId: "p1",
      projectName: "Site",
      kind: "bug",
      status: "open",
      priority: "high",
      title: "**bold** [x](https://evil.example) {{DATE(2020-01-01T00:00:00Z)}}",
      body: "<b>hi</b> @everyone [x](https://evil.example)\n- list",
      pageUrl: "https://example.com/a?b=1&c=2",
      reporterName: "@admin",
      assigneeIds: [],
      createdAt: "2026-10-21T00:00:00.000Z",
      updatedAt: "2026-10-21T00:00:00.000Z",
      url: "http://localhost:3100/inbox?item=f1&org=o1",
    },
    ...extra,
  },
});

describe("Teams, Telegram and ntfy formatting", () => {
  it("builds an Adaptive Card whose text can't format, link or template", async () => {
    const { buildRequest } = await import("./webhooks/format");
    const req = buildRequest("teams", payload(), null);
    expect(req.url).toBeUndefined();
    const card = JSON.parse(req.body) as {
      type: string;
      attachments: {
        contentType: string;
        content: { body: { text?: string }[]; actions: { url: string }[] };
      }[];
    };
    expect(card.type).toBe("message");
    const a = card.attachments[0];
    expect(a?.contentType).toBe("application/vnd.microsoft.card.adaptive");
    const text = JSON.stringify(a?.content.body);
    expect(text).not.toContain("**bold**");
    expect(text).not.toContain("[x](");
    expect(text).not.toContain("{{DATE");
    expect(a?.content.actions[0]?.url).toBe("http://localhost:3100/inbox?item=f1&org=o1");
  });

  it("sends Telegram HTML with the chat id in the body and no raw markup or mentions", async () => {
    const { buildRequest } = await import("./webhooks/format");
    const { telegramTarget } = await import("./webhooks/url");
    const target = telegramTarget("123456789:AAbbccddeeffgghhiijjkkllmmnnooppqq", "-1001234567890");
    const req = buildRequest("telegram", payload(), null, undefined, target);
    expect(req.url).toBe(
      "https://api.telegram.org/bot123456789:AAbbccddeeffgghhiijjkkllmmnnooppqq/sendMessage",
    );
    const body = JSON.parse(req.body) as { chat_id: string; text: string; parse_mode: string };
    expect(body.chat_id).toBe("-1001234567890");
    expect(body.parse_mode).toBe("HTML");
    expect(body.text).not.toContain("<b>hi</b>");
    expect(body.text).toContain("&lt;b&gt;hi&lt;/b&gt;");
    expect(body.text).not.toContain("@everyone");
    expect(body.text).not.toMatch(/@admin/);
    expect(body.text).toContain('<a href="http://localhost:3100/inbox?item=f1&amp;org=o1">');
  });

  it("refuses a Telegram target that isn't one", async () => {
    const { buildRequest } = await import("./webhooks/format");
    expect(() => buildRequest("telegram", payload(), null, undefined, "https://example.com/hook")).toThrow();
  });

  it("publishes to ntfy as JSON at the server root, with priority, click link and auth", async () => {
    const { buildRequest, ntfyTarget } = await import("./webhooks/format");
    expect(ntfyTarget("https://ntfy.example.com/sub/path/alerts")).toEqual({
      url: "https://ntfy.example.com/sub/path/",
      topic: "alerts",
    });
    expect(ntfyTarget("https://ntfy.sh/")).toBeNull();
    const req = buildRequest("ntfy", payload(), "tk_abc123", undefined, "https://ntfy.sh/pinwren-bugs");
    expect(req.url).toBe("https://ntfy.sh/");
    expect(req.headers.authorization).toBe("Bearer tk_abc123");
    const body = JSON.parse(req.body) as Record<string, unknown>;
    expect(body).toMatchObject({
      topic: "pinwren-bugs",
      priority: 4,
      markdown: false,
      click: "http://localhost:3100/inbox?item=f1&org=o1",
      tags: ["bug"],
    });
    const basic = buildRequest("ntfy", payload(), "me:pw", undefined, "https://ntfy.sh/t");
    expect(basic.headers.authorization).toBe(`Basic ${Buffer.from("me:pw").toString("base64")}`);
  });

  it("titles every wave-5 event, with the new value for priority and status changes", async () => {
    const { eventTitle, eventText, EVENT_TITLES } = await import("./webhooks/format");
    const { WEBHOOK_EVENTS } = await import("@pinwren/core");
    for (const e of WEBHOOK_EVENTS) expect(EVENT_TITLES[e], e).toBeTruthy();
    const p = payload("feedback.priority_changed", { changes: { priority: { from: "low", to: "urgent" } } });
    expect(eventTitle(p)).toBe("Priority changed → urgent");
    const c = payload("comment.updated", {
      comment: {
        id: "c1",
        body: "edited text",
        visibility: "public",
        authorName: null,
        team: true,
        createdAt: "",
      },
    });
    expect(eventText(c)).toBe("edited text");
    expect(eventText(payload("feedback.deleted"))).toContain("hi");
  });

  it("masks Telegram and chat URLs and keeps the chat id readable", async () => {
    const { maskedWebhookUrl, storedWebhookUrl, telegramChatOf, telegramTarget } =
      await import("./webhooks/url");
    const stored = storedWebhookUrl(
      "telegram",
      telegramTarget("123456789:AAbbccddeeffgghhiijjkkllmmnnooppqq", "@pinwren_bugs"),
    );
    expect(stored).not.toContain("AAbb");
    const e = { url: stored, kind: "telegram" as const };
    expect(maskedWebhookUrl(e)).toBe("https://api.telegram.org/bot123456789:…ppqq");
    expect(telegramChatOf(e)).toBe("@pinwren_bugs");
    const ntfy = { url: storedWebhookUrl("ntfy", "https://ntfy.sh/secret-topic"), kind: "ntfy" as const };
    expect(maskedWebhookUrl(ntfy)).toBe("https://ntfy.sh/…opic");
  });

  it("posts each kind through the injected fetch and reports the status", async () => {
    const { sendOnce } = await import("./webhooks/deliver");
    const { storedWebhookUrl, telegramTarget } = await import("./webhooks/url");
    const { encryptSecret } = await import("./crypto");
    const { impl, seen } = fakeFetch(() => ({ status: 200, json: { ok: true } }));
    const base = {
      id: "w1",
      orgId: "o1",
      projectId: null,
      name: null,
      events: ["feedback.created"],
      active: true,
      failingSince: null,
      createdBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const tg = {
      ...base,
      kind: "telegram" as const,
      url: storedWebhookUrl("telegram", telegramTarget("123456789:AAbbccddeeffgghhiijjkkllmmnnooppqq", "42")),
      secret: null,
    };
    const nt = {
      ...base,
      kind: "ntfy" as const,
      url: storedWebhookUrl("ntfy", "https://ntfy.sh/topic"),
      secret: encryptSecret("tk_x"),
    };
    const teams = {
      ...base,
      kind: "teams" as const,
      url: storedWebhookUrl("teams", "https://prod-1.westus.logic.azure.com/workflows/abc"),
      secret: null,
    };
    for (const e of [tg, nt, teams]) expect((await sendOnce(e, payload(), impl)).ok).toBe(true);
    expect(seen.map((s) => s.url)).toEqual([
      "https://api.telegram.org/bot123456789:AAbbccddeeffgghhiijjkkllmmnnooppqq/sendMessage",
      "https://ntfy.sh/",
      "https://prod-1.westus.logic.azure.com/workflows/abc",
    ]);
    expect(seen[1]?.headers.get("authorization")).toBe("Bearer tk_x");
    const { impl: failing } = fakeFetch(() => ({
      status: 400,
      json: { ok: false, description: "chat not found" },
    }));
    const r = await sendOnce(tg, payload(), failing);
    expect(r).toMatchObject({ ok: false, responseCode: 400, error: "HTTP 400" });
  });
});

describe("Linear", () => {
  const cfg = { provider: "linear" as const, token: "lin_api_x", repo: "ENG", apiUrl: null };

  it("creates an issue in the team with existing labels and returns its key", async () => {
    const { createIssue } = await import("./integrations/trackers");
    const { impl, seen } = fakeFetch((s) => {
      const q = (s.body as { query: string }).query;
      if (q.includes("teams("))
        return { json: { data: { teams: { nodes: [{ id: "t1", key: "ENG", name: "Eng" }] } } } };
      if (q.includes("issueLabels"))
        return {
          json: {
            data: {
              issueLabels: {
                nodes: [
                  { id: "l1", name: "bug", team: null },
                  { id: "l2", name: "bug", team: { id: "other" } },
                ],
              },
            },
          },
        };
      return {
        json: {
          data: {
            issueCreate: {
              success: true,
              issue: { identifier: "ENG-12", number: 12, url: "https://linear.app/acme/issue/ENG-12/x" },
            },
          },
        },
      };
    });
    const ref = await createIssue(cfg, { title: "t", body: "b", labels: ["bug"] }, impl);
    expect(ref).toEqual({ number: 12, key: "ENG-12", url: "https://linear.app/acme/issue/ENG-12/x" });
    expect(seen.every((s) => s.url === "https://api.linear.app/graphql" && s.method === "POST")).toBe(true);
    expect(seen[0]?.headers.get("authorization")).toBe("lin_api_x");
    expect((seen[2]?.body as { variables: unknown }).variables).toEqual({
      input: { teamId: "t1", title: "t", description: "b", labelIds: ["l1"] },
    });
  });

  it("moves the issue to the first completed / unstarted state, and skips when already there", async () => {
    const { setIssueState } = await import("./integrations/trackers");
    const states = [
      { id: "s-done2", type: "completed", position: 5 },
      { id: "s-backlog", type: "backlog", position: 0 },
      { id: "s-todo", type: "unstarted", position: 1 },
      { id: "s-done", type: "completed", position: 4 },
    ];
    let current = "unstarted";
    const { impl, seen } = fakeFetch((s) => {
      const q = (s.body as { query: string }).query;
      if (q.includes("issue(id"))
        return {
          json: {
            data: { issue: { id: "uuid-1", state: { type: current }, team: { states: { nodes: states } } } },
          },
        };
      return { json: { data: { issueUpdate: { success: true } } } };
    });
    await setIssueState(cfg, 12, "closed", impl);
    expect((seen[0]?.body as { variables: unknown }).variables).toEqual({ id: "ENG-12" });
    expect((seen[1]?.body as { variables: unknown }).variables).toEqual({ id: "uuid-1", stateId: "s-done" });
    current = "canceled";
    await setIssueState(cfg, 12, "closed", impl);
    expect(seen).toHaveLength(3); // only the lookup: already closed
    await setIssueState(cfg, 12, "open", impl);
    expect((seen[4]?.body as { variables: unknown }).variables).toEqual({ id: "uuid-1", stateId: "s-todo" });
  });

  it("turns GraphQL errors and unknown teams into readable TrackerErrors", async () => {
    const { checkAccess, createIssue, TrackerError } = await import("./integrations/trackers");
    const { impl: denied } = fakeFetch(() => ({
      status: 400,
      json: { errors: [{ message: "x", extensions: { userPresentableMessage: "Authentication required" } }] },
    }));
    await expect(createIssue(cfg, { title: "t", body: "b", labels: [] }, denied)).rejects.toThrow(
      TrackerError,
    );
    await expect(createIssue(cfg, { title: "t", body: "b", labels: [] }, denied)).rejects.toThrow(
      /Authentication required/,
    );
    const { impl: none } = fakeFetch(() => ({ json: { data: { teams: { nodes: [] } } } }));
    const missing = await checkAccess(cfg, none);
    expect(!missing.ok && missing.message).toMatch(/No Linear team/);
    const { impl: ok } = fakeFetch(() => ({
      json: { data: { teams: { nodes: [{ id: "t", key: "ENG", name: "Eng" }] } } },
    }));
    expect(await checkAccess(cfg, ok)).toEqual({ ok: true, name: "Eng (ENG)" });
  });

  it("verifies Linear signatures and freshness and reads state changes", async () => {
    const { linearFresh, linearIssueEvent, verifyLinearSignature } = await import("./integrations/inbound");
    const raw = '{"a":1}';
    const sig = createHmac("sha256", "lin_wh_secret_value").update(raw).digest("hex");
    expect(verifyLinearSignature("lin_wh_secret_value", raw, sig)).toBe(true);
    expect(verifyLinearSignature("other-secret-value", raw, sig)).toBe(false);
    expect(verifyLinearSignature("lin_wh_secret_value", raw, "nope")).toBe(false);
    expect(linearFresh({ webhookTimestamp: 1_000_000 }, 1_000_000 + 60_000)).toBe(true);
    expect(linearFresh({ webhookTimestamp: 1_000_000 }, 1_000_000 + 10 * 60_000)).toBe(false);
    expect(linearFresh({}, 0)).toBe(false);
    const ev = (type: string, updatedFrom: object = { stateId: "s0" }) => ({
      type: "Issue",
      action: "update",
      updatedFrom,
      data: { identifier: "ENG-12", number: 12, team: { key: "ENG" }, state: { type } },
    });
    expect(linearIssueEvent(ev("completed"))).toEqual({ key: "ENG", number: 12, state: "closed" });
    expect(linearIssueEvent(ev("canceled"))?.state).toBe("closed");
    expect(linearIssueEvent(ev("started"))?.state).toBe("open");
    expect(linearIssueEvent(ev("completed", { title: "old" }))).toBeNull();
    expect(linearIssueEvent({ ...ev("completed"), type: "Comment" })).toBeNull();
  });
});

describe("Jira Cloud", () => {
  const cfg = {
    provider: "jira" as const,
    token: "atl-token",
    email: "dev@example.com",
    repo: "WEB",
    apiUrl: "https://acme.atlassian.net/jira/",
  };

  it("creates a Bug with an ADF description and space-free labels", async () => {
    const { createIssue } = await import("./integrations/trackers");
    const { impl, seen } = fakeFetch((s) =>
      s.method === "GET"
        ? {
            json: {
              issueTypes: [
                { id: "10", name: "Task" },
                { id: "11", name: "Bug" },
                { id: "12", name: "Sub-task", subtask: true },
              ],
            },
          }
        : {
            status: 201,
            json: { id: "1000", key: "WEB-7", self: "https://acme.atlassian.net/rest/api/3/issue/1000" },
          },
    );
    const adf = { type: "doc", version: 1, content: [] };
    const ref = await createIssue(
      cfg,
      { title: "t", body: "b", labels: ["needs triage"], kind: "bug", adf },
      impl,
    );
    expect(ref).toEqual({ number: 7, key: "WEB-7", url: "https://acme.atlassian.net/browse/WEB-7" });
    expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual([
      "GET https://acme.atlassian.net/rest/api/3/issue/createmeta/WEB/issuetypes",
      "POST https://acme.atlassian.net/rest/api/3/issue",
    ]);
    expect(seen[1]?.headers.get("authorization")).toBe(
      `Basic ${Buffer.from("dev@example.com:atl-token").toString("base64")}`,
    );
    expect(seen[1]?.body).toEqual({
      fields: {
        project: { key: "WEB" },
        issuetype: { id: "11" },
        summary: "t",
        description: adf,
        labels: ["needs-triage"],
      },
    });
  });

  it("falls back to Task for non-bugs", async () => {
    const { createIssue } = await import("./integrations/trackers");
    const { impl, seen } = fakeFetch((s) =>
      s.method === "GET"
        ? {
            json: {
              issueTypes: [
                { id: "10", name: "Task" },
                { id: "11", name: "Bug" },
              ],
            },
          }
        : { status: 201, json: { key: "WEB-8" } },
    );
    await createIssue(cfg, { title: "t", body: "line 1\nline 2", labels: [], kind: "idea" }, impl);
    const fields = (seen[1]?.body as { fields: { issuetype: unknown; description: { content: unknown[] } } })
      .fields;
    expect(fields.issuetype).toEqual({ id: "10" });
    expect(fields.description.content).toHaveLength(2);
  });

  it("transitions into the done / to-do category (204 answers are fine)", async () => {
    const { setIssueState, TrackerError } = await import("./integrations/trackers");
    const transitions = [
      { id: "21", to: { statusCategory: { key: "indeterminate" } } },
      { id: "31", to: { statusCategory: { key: "done" } } },
      { id: "11", to: { statusCategory: { key: "new" } } },
    ];
    const { impl, seen } = fakeFetch((s) =>
      s.method === "GET" ? { json: { transitions } } : { status: 204 },
    );
    await setIssueState(cfg, 7, "closed", impl);
    await setIssueState(cfg, 7, "open", impl);
    expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual([
      "GET https://acme.atlassian.net/rest/api/3/issue/WEB-7/transitions",
      "POST https://acme.atlassian.net/rest/api/3/issue/WEB-7/transitions",
      "GET https://acme.atlassian.net/rest/api/3/issue/WEB-7/transitions",
      "POST https://acme.atlassian.net/rest/api/3/issue/WEB-7/transitions",
    ]);
    expect(seen[1]?.body).toEqual({ transition: { id: "31" } });
    expect(seen[3]?.body).toEqual({ transition: { id: "11" } });
    const { impl: stuck } = fakeFetch(() => ({ json: { transitions: [] } }));
    await expect(setIssueState(cfg, 7, "closed", stuck)).rejects.toThrow(TrackerError);
  });

  it("reports Jira's own error messages with a hint", async () => {
    const { checkAccess } = await import("./integrations/trackers");
    const { impl } = fakeFetch(() => ({
      status: 404,
      json: { errorMessages: ["No project could be found with key 'WEB'."], errors: {} },
    }));
    const r = await checkAccess(cfg, impl);
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.message).toMatch(/No project could be found.*check the site URL/);
  });

  it("verifies X-Hub-Signature and reads status-category changes", async () => {
    const { jiraIssueEvent, verifyJiraSignature } = await import("./integrations/inbound");
    const raw = '{"b":2}';
    const sig = `sha256=${createHmac("sha256", "whsec_jira_secret").update(raw).digest("hex")}`;
    expect(verifyJiraSignature("whsec_jira_secret", raw, sig)).toBe(true);
    expect(verifyJiraSignature("whsec_other_secret", raw, sig)).toBe(false);
    const ev = (category: string, field = "status") => ({
      webhookEvent: "jira:issue_updated",
      changelog: { items: [{ field }] },
      issue: {
        key: "WEB-7",
        fields: { project: { key: "WEB" }, status: { statusCategory: { key: category } } },
      },
    });
    expect(jiraIssueEvent(ev("done"))).toEqual({ key: "WEB", number: 7, state: "closed" });
    expect(jiraIssueEvent(ev("indeterminate"))?.state).toBe("open");
    expect(jiraIssueEvent(ev("done", "summary"))).toBeNull();
    expect(jiraIssueEvent({ ...ev("done"), webhookEvent: "jira:issue_created" })).toBeNull();
  });

  it("builds an ADF issue body where the reporter's text is plain text", async () => {
    const { issueAdf, issueBody, splitJiraCredential, jiraCredential } =
      await import("./integrations/issues");
    const input = {
      number: 7,
      kind: "bug",
      projectName: "Site",
      body: "[x](javascript:alert(1)) @here",
      pageUrl: "https://example.com/",
      reporterName: null,
      environment: null,
      link: "http://localhost:3100/inbox?item=1",
      productName: "Pinwren",
    };
    const doc = JSON.stringify(issueAdf(input));
    expect(doc).toContain('"text":"[x](javascript:alert(1)) @here"');
    expect(doc.match(/"type":"link"/g)).toHaveLength(1);
    expect(doc).toContain('"href":"http://localhost:3100/inbox?item=1"');
    const md = issueBody(input, "linear");
    expect(md).not.toContain("<sub>");
    expect(md).toContain("- **Project:** Site");
    expect(md).not.toContain("[x](javascript");
    expect(splitJiraCredential(jiraCredential("dev@example.com", "tok"))).toEqual({
      email: "dev@example.com",
      token: "tok",
    });
  });
});

describe("tracker settings validation", () => {
  it("checks the repository / team / project key per provider", async () => {
    const { issueIntegrationCreate, normalizeTrackerRepo, trackerRepoError } = await import("@pinwren/core");
    expect(trackerRepoError("github", "o/r")).toBeNull();
    expect(trackerRepoError("github", "a/b/c")).toMatch(/owner\/name/);
    expect(trackerRepoError("gitlab", "a/b/c")).toBeNull();
    expect(trackerRepoError("linear", "ENG")).toBeNull();
    expect(trackerRepoError("linear", "o/r")).toMatch(/team key/);
    expect(trackerRepoError("jira", "web")).toBeNull();
    expect(normalizeTrackerRepo("jira", " web ")).toBe("WEB");
    const jira = { provider: "jira", token: "atl-token-1", repo: "WEB" };
    expect(issueIntegrationCreate.safeParse(jira).success).toBe(false);
    expect(
      issueIntegrationCreate.safeParse({ ...jira, email: "a@b.co", apiUrl: "https://acme.atlassian.net" })
        .success,
    ).toBe(true);
    expect(
      issueIntegrationCreate.safeParse({ provider: "linear", token: "lin_api_x", repo: "ENG" }).success,
    ).toBe(true);
    expect(
      issueIntegrationCreate.safeParse({
        provider: "github",
        token: "ghp_xxxxxx",
        repo: "o/r",
        email: "a@b.co",
      }).success,
    ).toBe(false);
  });

  it("requires a bot token + chat id for Telegram and a URL for every other kind", async () => {
    const { webhookCreate } = await import("@pinwren/core");
    const events = ["feedback.created"];
    expect(webhookCreate.safeParse({ kind: "telegram", events }).success).toBe(false);
    expect(
      webhookCreate.safeParse({
        kind: "telegram",
        events,
        botToken: "123456789:AAbbccddeeffgghhiijjkkllmmnnooppqq",
        chatId: "-1001234567890",
      }).success,
    ).toBe(true);
    expect(webhookCreate.safeParse({ kind: "teams", events }).success).toBe(false);
    expect(
      webhookCreate.safeParse({ kind: "ntfy", events, url: "https://ntfy.sh/t", accessToken: "tk_1" })
        .success,
    ).toBe(true);
    expect(
      webhookCreate.safeParse({
        kind: "slack",
        events,
        url: "https://hooks.slack.com/x",
        accessToken: "tk_1",
      }).success,
    ).toBe(false);
  });
});
