import { SLACK_ACTIONS, slackConnect, slackRouteCreate } from "@pinwren/core";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { slackClient } from "./slack/client";
import { cardBlockId, feedbackCard, feedbackIdOfBlock, feedbackModal } from "./slack/blocks";
import { permalinkOf } from "./slack/interactions";
import { slackLinkToken, verifySlackLinkToken } from "./slack/link-token";
import { slackManifest, slackRequestUrls } from "./slack/manifest";
import { SLACK_MAX_AGE_S, signSlackRequest, verifySlackSignature } from "./slack/signature";
import { describeError } from "./slack/deliver";

// Interactive Slack (F-071): the pure parts. Signature and replay window, link tokens, Block Kit output and
// its escaping, the Web API client and the manifest. Handlers and routes run against a database in
// slack-db.test.ts; nothing here touches the network.

beforeAll(() => {
  process.env.DATABASE_URL ??= "postgres://unused";
  process.env.PINWREN_URL ??= "http://localhost:3100";
  process.env.PINWREN_SECRET ??= "x".repeat(48);
});

const SECRET = "0123456789abcdef".repeat(2);
const NOW = 1_700_000_000_000;

describe("Slack request signature", () => {
  const body = "payload=%7B%22type%22%3A%22block_actions%22%7D";
  const sign = (b = body, now = NOW, secret = SECRET) => signSlackRequest(secret, b, now);
  const verify = (h: ReturnType<typeof sign>, b = body, now = NOW, secret = SECRET) =>
    verifySlackSignature(
      secret,
      b,
      { timestamp: h["x-slack-request-timestamp"], signature: h["x-slack-signature"] },
      now,
    );

  it("accepts a request signed with the app's secret", () => {
    expect(verify(sign())).toBe("ok");
  });

  it("matches the documented v0 construction", () => {
    // v0=HMAC-SHA256(secret, "v0:<timestamp>:<body>"), hex.
    const h = sign();
    expect(h["x-slack-signature"]).toMatch(/^v0=[0-9a-f]{64}$/);
    expect(h["x-slack-request-timestamp"]).toBe(String(NOW / 1000));
  });

  it("refuses another secret, a changed body and a changed timestamp", () => {
    expect(verify(sign(), body, NOW, "f".repeat(32))).toBe("mismatch");
    expect(verify(sign(), `${body}&x=1`)).toBe("mismatch");
    const h = sign();
    h["x-slack-request-timestamp"] = String(NOW / 1000 + 1);
    expect(verify(h)).toBe("mismatch");
  });

  it("refuses requests outside the replay window, in either direction", () => {
    expect(verify(sign(body, NOW), body, NOW + (SLACK_MAX_AGE_S - 1) * 1000)).toBe("ok");
    expect(verify(sign(body, NOW), body, NOW + (SLACK_MAX_AGE_S + 1) * 1000)).toBe("stale");
    expect(verify(sign(body, NOW), body, NOW - (SLACK_MAX_AGE_S + 1) * 1000)).toBe("stale");
  });

  it("refuses missing or malformed headers", () => {
    const good = sign();
    expect(
      verifySlackSignature(SECRET, body, { timestamp: undefined, signature: good["x-slack-signature"] }, NOW),
    ).toBe("malformed");
    expect(
      verifySlackSignature(
        SECRET,
        body,
        { timestamp: good["x-slack-request-timestamp"], signature: undefined },
        NOW,
      ),
    ).toBe("malformed");
    expect(
      verifySlackSignature(
        SECRET,
        body,
        { timestamp: "yesterday", signature: good["x-slack-signature"] },
        NOW,
      ),
    ).toBe("malformed");
    expect(
      verifySlackSignature(
        SECRET,
        body,
        { timestamp: good["x-slack-request-timestamp"], signature: "v0=abc" },
        NOW,
      ),
    ).toBe("malformed");
    expect(
      verifySlackSignature(
        SECRET,
        body,
        { timestamp: good["x-slack-request-timestamp"], signature: good["x-slack-signature"].slice(3) },
        NOW,
      ),
    ).toBe("malformed");
  });
});

describe("link tokens", () => {
  const ws = "8b7c3a52-1d3e-4f5a-9c61-0a1b2c3d4e5f";

  it("round-trips the workspace and the Slack user", () => {
    const claim = verifySlackLinkToken(slackLinkToken(ws, "U0123ABCD", NOW), NOW + 1000);
    expect(claim).toMatchObject({ workspaceId: ws, slackUserId: "U0123ABCD" });
  });

  it("expires after an hour", () => {
    const token = slackLinkToken(ws, "U0123ABCD", NOW);
    expect(verifySlackLinkToken(token, NOW + 59 * 60_000)).not.toBeNull();
    expect(verifySlackLinkToken(token, NOW + 61 * 60_000)).toBeNull();
  });

  it("rejects forged, tampered and malformed tokens", () => {
    const token = slackLinkToken(ws, "U0123ABCD", NOW);
    const [part, sig] = token.split(".");
    const other = Buffer.from(`${ws}.U0ZZZZZZZZ.${Math.floor(NOW / 1000) + 3600}`).toString("base64url");
    expect(verifySlackLinkToken(`${other}.${sig ?? ""}`, NOW)).toBeNull();
    expect(verifySlackLinkToken(`${part ?? ""}.${"A".repeat(43)}`, NOW)).toBeNull();
    expect(verifySlackLinkToken(`${token}.extra`, NOW)).toBeNull();
    expect(verifySlackLinkToken("", NOW)).toBeNull();
    expect(verifySlackLinkToken("x".repeat(600), NOW)).toBeNull();
    expect(verifySlackLinkToken(null)).toBeNull();
  });
});

const feedback = {
  id: "8b7c3a52-1d3e-4f5a-9c61-0a1b2c3d4e5f",
  number: 7,
  projectId: "p1",
  projectName: "Site *<!channel>*",
  kind: "bug",
  status: "open",
  priority: "high",
  title: "<!here> click <@U123|x> now",
  body: "Press <https://evil.example|here> & *win*",
  pageUrl: "https://example.test/<script>",
  reporterName: "<!everyone>",
  assigneeIds: [] as string[],
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  url: "https://pinwren.test/inbox?item=1",
};

describe("feedback card", () => {
  const card = (over: Partial<Parameters<typeof feedbackCard>[0]> = {}) =>
    feedbackCard({
      feedback,
      headline: "New feedback",
      assigneeNames: [],
      labelNames: [],
      projectLabels: [{ id: "6f1b7c04-2b36-4a8e-8c15-6a3a3b0a9d21", name: "Billing" }],
      ...over,
    });
  const actions = (c = card()) =>
    (c.blocks as { type: string; block_id?: string; elements: Record<string, unknown>[] }[]).find(
      (b) => b.type === "actions",
    );

  it("has the four controls with stable action ids, and the item id in the block id", () => {
    const a = actions();
    expect(a?.block_id).toBe(cardBlockId(feedback.id));
    expect(feedbackIdOfBlock(a?.block_id)).toBe(feedback.id);
    expect(a?.elements.map((e) => e.action_id)).toEqual([
      SLACK_ACTIONS.assignMe,
      SLACK_ACTIONS.setStatus,
      SLACK_ACTIONS.addLabel,
      SLACK_ACTIONS.open,
    ]);
    const status = a?.elements[1] as { options: { value: string }[]; initial_option: { value: string } };
    expect(status.options.map((o) => o.value)).toContain("resolved");
    expect(status.initial_option.value).toBe("open");
  });

  it("hides the label menu when the project has no labels, and every control for a trashed item", () => {
    expect(actions(card({ projectLabels: [] }))?.elements.map((e) => e.action_id)).not.toContain(
      SLACK_ACTIONS.addLabel,
    );
    expect(actions(card({ readOnly: true }))).toBeUndefined();
  });

  it("never lets visitor text form a link, mention or formatting", () => {
    const json = JSON.stringify(card({ labelNames: ["<!channel>"], assigneeNames: ["<@U1>"] }));
    // Only our own link survives as a link; everything from the visitor is entity-escaped.
    expect(json).not.toContain("<!channel>");
    expect(json).not.toContain("<!here>");
    expect(json).not.toContain("<!everyone>");
    expect(json).not.toContain("<@U");
    expect(json).not.toContain("<https://evil.example");
    expect(json).toContain("&lt;!here&gt;");
    expect(json).toContain("https://pinwren.test/inbox?item=1");
    const first = (card().blocks[0] as { text: { type: string; text: string } }).text;
    expect(first.type).toBe("mrkdwn");
    expect(first.text).not.toMatch(/\*Site \*/);
  });

  it("puts the title and body in plain_text blocks", () => {
    const sections = (card().blocks as { type: string; text?: { type: string } }[]).filter(
      (b) => b.type === "section",
    );
    expect(sections.slice(1).every((s) => s.text?.type === "plain_text")).toBe(true);
  });

  it("only accepts uuid item ids from a block id", () => {
    expect(feedbackIdOfBlock("pw:not-a-uuid")).toBeNull();
    expect(feedbackIdOfBlock("other:" + feedback.id)).toBeNull();
    expect(feedbackIdOfBlock(42)).toBeNull();
  });
});

describe("capture modal", () => {
  const modal = (initial = {}) =>
    feedbackModal({
      projects: [
        { id: "a", name: "Alpha" },
        { id: "b", name: "Beta" },
      ],
      kinds: ["comment", "bug"],
      initial,
      metadata: { c: "C0123456789", ts: "1700000000.000100" },
    }) as {
      callback_id: string;
      private_metadata: string;
      blocks: { block_id?: string; element?: Record<string, unknown> }[];
    };

  it("asks for title, details, project and type, prefilled from the message", () => {
    const m = modal({ title: "Checkout fails", body: "It spins", projectId: "b", kind: "bug" });
    expect(m.callback_id).toBe("pinwren_feedback_modal");
    expect(JSON.parse(m.private_metadata)).toEqual({ c: "C0123456789", ts: "1700000000.000100" });
    const byId: Record<string, Record<string, unknown> | undefined> = Object.fromEntries<
      Record<string, unknown> | undefined
    >(m.blocks.filter((b) => b.block_id).map((b) => [b.block_id ?? "", b.element]));
    expect(Object.keys(byId)).toEqual(["title", "body", "project", "kind"]);
    expect(byId.title).toMatchObject({ initial_value: "Checkout fails" });
    expect((byId.project as { initial_option: { value: string } }).initial_option.value).toBe("b");
    expect((byId.kind as { initial_option: { value: string } }).initial_option.value).toBe("bug");
  });
});

describe("message permalinks", () => {
  it("builds the archive url from the workspace url, channel and timestamp", () => {
    expect(permalinkOf("https://acme.slack.com/", "C0123456789", "1700000000.000100")).toBe(
      "https://acme.slack.com/archives/C0123456789/p1700000000000100",
    );
  });
  it("refuses anything that is not https or a Slack id", () => {
    expect(permalinkOf("http://acme.slack.com/", "C0123456789", "1700000000.000100")).toBeNull();
    expect(permalinkOf("javascript:alert(1)", "C0123456789", "1700000000.000100")).toBeNull();
    expect(permalinkOf("https://acme.slack.com/", "../x", "1700000000.000100")).toBeNull();
    expect(permalinkOf("https://acme.slack.com/", "C0123456789", "later")).toBeNull();
    expect(permalinkOf(null, "C0123456789", "1700000000.000100")).toBeNull();
  });
});

describe("Slack Web API client", () => {
  const reply = (status: number, json: unknown, headers: Record<string, string> = {}) =>
    Promise.resolve(new Response(JSON.stringify(json), { status, headers }));

  it("posts form-encoded calls with the bearer token and JSON-encoded blocks", async () => {
    const calls: { url: string; init: Record<string, unknown> }[] = [];
    const api = slackClient("xoxb-token", ((url: string, init: Record<string, unknown>) => {
      calls.push({ url, init });
      return reply(200, { ok: true, channel: "C0123456789", ts: "1.2" });
    }) as never);
    const r = await api.postMessage({
      channel: "C0123456789",
      text: "hi",
      blocks: [{ type: "divider" }],
      threadTs: "1.1",
    });
    expect(r).toEqual({ ok: true, data: { channel: "C0123456789", ts: "1.2" } });
    const call = calls[0];
    expect(call?.url).toBe("https://slack.com/api/chat.postMessage");
    expect((call?.init.headers as Record<string, string>).authorization).toBe("Bearer xoxb-token");
    const form = new URLSearchParams(call?.init.body as string);
    expect(form.get("channel")).toBe("C0123456789");
    expect(form.get("thread_ts")).toBe("1.1");
    expect(JSON.parse(form.get("blocks") ?? "")).toEqual([{ type: "divider" }]);
    expect(form.get("unfurl_links")).toBe("false");
    expect(call?.init.trusted).toBe(true);
  });

  it("maps Slack errors, rate limits and transport failures without leaking bodies", async () => {
    const failing = (res: () => Promise<Response>) => slackClient("t", () => res());
    expect(
      await failing(() => reply(200, { ok: false, error: "channel_not_found", secret: "x" })).postMessage({
        channel: "C0123456789",
        text: "x",
      }),
    ).toEqual({
      ok: false,
      error: "channel_not_found",
    });
    expect(
      await failing(() => reply(429, {}, { "retry-after": "7" })).postMessage({
        channel: "C0123456789",
        text: "x",
      }),
    ).toEqual({ ok: false, error: "ratelimited", retryAfter: 7 });
    expect((await failing(() => reply(500, "boom")).authTest()).ok).toBe(false);
    expect(
      await failing(() => Promise.reject(new Error("socket hang up with token xoxb-secret"))).authTest(),
    ).toEqual({
      ok: false,
      error: "connection failed",
    });
  });

  it("reads auth.test and users.info into the fields Pinwren uses", async () => {
    const api = slackClient("t", (url: string) =>
      reply(
        200,
        url.endsWith("auth.test")
          ? { ok: true, team_id: "T0123ABCD", team: "Acme", url: "https://acme.slack.com/", user_id: "U0BOT" }
          : {
              ok: true,
              user: {
                id: "U0123ABCD",
                name: "pat",
                is_bot: false,
                profile: { email: "Pat@Example.test", display_name: "Pat" },
              },
            },
      ),
    );
    expect(await api.authTest()).toEqual({
      ok: true,
      data: { teamId: "T0123ABCD", teamName: "Acme", teamUrl: "https://acme.slack.com/", botUserId: "U0BOT" },
    });
    expect(await api.userInfo("U0123ABCD")).toMatchObject({
      ok: true,
      data: { id: "U0123ABCD", email: "pat@example.test", name: "Pat", isBot: false, isRestricted: false },
    });
  });

  it("follows cursors for list calls, up to a page limit", async () => {
    const fetchImpl = vi.fn(() =>
      reply(200, {
        ok: true,
        members: [{ id: "U0123ABCD", profile: {} }],
        response_metadata: { next_cursor: "more" },
      }),
    );
    const r = await slackClient("t", fetchImpl).listUsers();
    expect(r.ok && r.data).toHaveLength(5);
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });
});

describe("settings schemas and manifest", () => {
  it("validates credentials by shape before they reach Slack", () => {
    expect(
      slackConnect.safeParse({ signingSecret: SECRET, botToken: `xoxb-${"1".repeat(30)}` }).success,
    ).toBe(true);
    expect(
      slackConnect.safeParse({ signingSecret: "short", botToken: `xoxb-${"1".repeat(30)}` }).success,
    ).toBe(false);
    expect(
      slackConnect.safeParse({ signingSecret: SECRET, botToken: "xoxp-1111111111111111111111" }).success,
    ).toBe(false);
  });

  it("takes a channel id and a known event list for a route", () => {
    expect(slackRouteCreate.parse({ channelId: "C0123456789" })).toMatchObject({
      projectId: null,
      events: ["feedback.created"],
    });
    expect(slackRouteCreate.safeParse({ channelId: "general" }).success).toBe(false);
    expect(
      slackRouteCreate.safeParse({ channelId: "C0123456789", events: ["feedback.deleted"] }).success,
    ).toBe(false);
    expect(slackRouteCreate.safeParse({ channelId: "C0123456789", events: [] }).success).toBe(false);
  });

  it("derives the request urls and manifest from PINWREN_URL", () => {
    const urls = slackRequestUrls();
    expect(urls.interactivity.endsWith("/api/slack/interactivity")).toBe(true);
    const m = slackManifest();
    expect(m.settings.interactivity.request_url).toBe(urls.interactivity);
    expect(m.features.slash_commands[0]?.url).toBe(urls.commands);
    expect(m.features.shortcuts.map((s) => s.callback_id)).toEqual([
      "pinwren_create_feedback",
      "pinwren_new_feedback",
    ]);
    expect(m.oauth_config.scopes.bot).toContain("users:read.email");
  });

  it("explains Slack errors in words, not codes", () => {
    expect(describeError("not_in_channel")).toMatch(/invite/);
    expect(describeError("invalid_auth")).toMatch(/token/);
    expect(describeError("weird")).toBe("Slack error: weird");
  });
});
