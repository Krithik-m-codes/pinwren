import type * as ApiModule from "./index";
import type * as BossModule from "./jobs/boss";
import type * as BusModule from "./realtime/bus";
import type * as WorkspaceModule from "./slack/workspace";
import { randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getRuntimeDb } from "../../db/src/connection";
import { closeIdentityDatabase } from "../../db/src/identity";
import { createCloudFixture } from "./test-helpers/cloud-fixture";
import { fakeSlackApi } from "./test-helpers/slack-fake";

/**
 * Interactive Slack against a real database with row security (F-071): the settings API, signed interactivity
 * and slash-command requests, acting as the mapped member, capture from a message, outbound cards and
 * tenant isolation. Slack's Web API is a fake; nothing touches the network.
 */
const effects = vi.hoisted(() => ({
  enqueue: vi.fn<(...args: unknown[]) => Promise<void>>(),
  publish: vi.fn<(...args: unknown[]) => Promise<void>>(),
}));
vi.mock("./jobs/boss", async (original) => ({
  ...(await original<typeof BossModule>()),
  enqueue: effects.enqueue,
}));
vi.mock("./realtime/bus", async (original) => ({
  ...(await original<typeof BusModule>()),
  publish: effects.publish,
}));

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- the cases read parsed JSON responses and SQL rows */
type Json = Record<string, any>;

describe.skipIf(!process.env.PINWREN_ISOLATION_ADMIN_URL)("Interactive Slack", () => {
  let fixture: Awaited<ReturnType<typeof createCloudFixture>> | undefined;
  let api: typeof ApiModule.app;
  const suffix = randomUUID();
  const orgA = `slack-a-${suffix}`;
  const orgB = `slack-b-${suffix}`;
  const owner = `owner-${suffix}`;
  const editor = `editor-${suffix}`;
  const viewer = `viewer-${suffix}`;
  const outsider = `outsider-${suffix}`;
  const email = (u: string) => `${u}@test.invalid`;
  const password = randomUUID();
  const signingSecret = randomBytes(16).toString("hex");
  const signingSecretB = randomBytes(16).toString("hex");
  const jars = { owner: new Map<string, string>(), editor: new Map<string, string>() };
  const ids = {
    projectA: randomUUID(),
    projectA2: randomUUID(),
    projectB: randomUUID(),
    labelA: randomUUID(),
    itemA: randomUUID(),
    itemB: randomUUID(),
    teamA: "",
    teamB: `T${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`,
  };
  ids.teamA = `T${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
  const SLACK = {
    owner: "U0OWNER001",
    viewer: "U0VIEWER01",
    stranger: "U0STRANGE1",
    guest: "U0GUEST001",
    noEmail: "U0NOEMAIL1",
    editor: "U0EDITOR01",
    outsider: "U0OUTSIDE1",
  } as const;
  const people: Record<string, { email: string | null; isRestricted?: boolean }> = {
    [SLACK.owner]: { email: email(owner) },
    [SLACK.viewer]: { email: email(viewer) },
    [SLACK.stranger]: { email: "stranger@elsewhere.invalid" },
    [SLACK.guest]: { email: email(owner), isRestricted: true },
    [SLACK.noEmail]: { email: null },
    [SLACK.editor]: { email: email(editor) },
    [SLACK.outsider]: { email: email(outsider) },
  };
  let slack = fakeSlackApi({});
  const resetSlack = (extra: Parameters<typeof fakeSlackApi>[0] = {}) => {
    slack = fakeSlackApi({
      userInfo: vi.fn((id: string) => {
        const p = people[id];
        return Promise.resolve(
          p
            ? {
                ok: true as const,
                data: {
                  id,
                  name: id,
                  email: p.email,
                  isBot: false,
                  isRestricted: p.isRestricted ?? false,
                  deleted: false,
                },
              }
            : { ok: false as const, error: "user_not_found" },
        );
      }),
      authTest: vi.fn(() =>
        Promise.resolve({
          ok: true as const,
          data: {
            teamId: ids.teamA,
            teamName: "Acme",
            teamUrl: "https://acme.slack.com/",
            botUserId: "U0BOT00001",
          },
        }),
      ),
      ...extra,
    });
    return slack;
  };
  let workspaces: typeof WorkspaceModule;
  /** One double per test, handed out for every API call the code under test makes. */
  const useSlack = (extra: Parameters<typeof fakeSlackApi>[0] = {}) => {
    const current = resetSlack(extra);
    workspaces.setSlackApiFactory(() => current);
    return current;
  };
  /** Like `useSlack`, but the double is only built when the code first asks for it. */
  const useSlackLazily = (build: () => ReturnType<typeof fakeSlackApi>) => {
    let current: ReturnType<typeof fakeSlackApi> | undefined;
    workspaces.setSlackApiFactory(() => (current ??= build()));
  };

  const db = () => {
    if (!fixture) throw new Error("fixture not ready");
    return fixture.db;
  };
  const request = (
    path: string,
    init: { method?: string; body?: unknown; jar?: Map<string, string> } = {},
  ) => {
    const headers = new Headers({ origin: "http://localhost:3100", "content-type": "application/json" });
    const jar = init.jar ?? jars.owner;
    if (jar.size) headers.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
    return api.request(`http://localhost:3100${path}`, {
      method: init.method ?? "GET",
      headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  };
  const take = (response: Response, jar: Map<string, string>) => {
    for (const cookie of response.headers.getSetCookie()) {
      const part = cookie.split(";")[0] ?? "";
      const eq = part.indexOf("=");
      if (eq > 0 && part.slice(eq + 1)) jar.set(part.slice(0, eq), part.slice(eq + 1));
    }
  };
  const json = async (response: Response) => (await response.json()) as Json;
  const signIn = async (user: string, org: string, jar: Map<string, string>) => {
    const signed = await request("/api/auth/sign-in/email", {
      method: "POST",
      body: { email: email(user), password },
      jar,
    });
    expect(signed.status).toBe(200);
    take(signed, jar);
    take(
      await request("/api/auth/organization/set-active", {
        method: "POST",
        body: { organizationId: org },
        jar,
      }),
      jar,
    );
  };

  /** A request as Slack sends it: form-encoded, signed with the app's secret. */
  const slackPost = async (
    route: "interactivity" | "commands",
    form: Record<string, string>,
    opts: { secret?: string; now?: number } = {},
  ) => {
    const { signSlackRequest } = await import("./slack/signature");
    const raw = new URLSearchParams(form).toString();
    return api.request(`http://localhost:3100/api/slack/${route}`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...signSlackRequest(opts.secret ?? signingSecret, raw, opts.now),
      },
      body: raw,
    });
  };
  const interact = (payload: Json, opts: { secret?: string } = {}) =>
    slackPost(
      "interactivity",
      { payload: JSON.stringify({ team: { id: ids.teamA }, trigger_id: randomUUID(), ...payload }) },
      opts,
    );
  const press = (action: Json, user: string = SLACK.owner, extra: Json = {}, item: string = ids.itemA) =>
    interact({
      type: "block_actions",
      user: { id: user },
      container: { type: "message", channel_id: "C0ROUTEA01", message_ts: "1700000000.000100" },
      actions: [{ block_id: `pw:${item}`, ...action }],
      ...extra,
    });
  const item = async (id = ids.itemA) => (await db()`select * from feedback where id = ${id}`)[0] as Json;
  const ephemerals = () => slack.postEphemeral.mock.calls.map((c: unknown[]) => c[0] as Json);

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
    for (const org of [orgA, orgB])
      await d`insert into organization (id,name,slug) values (${org},${org},${org})`;
    for (const [user, org, role] of [
      [owner, orgA, "owner"],
      [editor, orgA, "member"],
      [viewer, orgA, "viewer"],
      [outsider, orgB, "owner"],
    ] as const) {
      await d`insert into "user" (id,name,email,email_verified) values (${user},${user},${email(user)},true)`;
      await d`insert into account (id,account_id,provider_id,user_id,password) values (${randomUUID()},${user},'credential',${user},${hashed})`;
      await d`insert into member (id,organization_id,user_id,role) values (${randomUUID()},${org},${user},${role})`;
    }
    for (const [org, project, name] of [
      [orgA, ids.projectA, "Alpha"],
      [orgA, ids.projectA2, "Beta"],
      [orgB, ids.projectB, "Gamma"],
    ] as const) {
      await d`insert into project (id,org_id,name,slug,public_key,allowed_origins,identity_secret,action_secret) values (${project},${org},${name},${project},${project},${d.array(["https://customer.test"])},${randomUUID()},${randomUUID()})`;
    }
    await d`insert into label (id,org_id,project_id,name,color) values (${ids.labelA},${orgA},${ids.projectA},'Billing','#112233')`;
    for (const [id, org, project] of [
      [ids.itemA, orgA, ids.projectA],
      [ids.itemB, orgB, ids.projectB],
    ] as const) {
      await d`insert into feedback (id,org_id,project_id,number,kind,body,client_id) values (${id},${org},${project},1,'bug','It is <!channel> broken',${randomUUID()})`;
      await d`update project set feedback_counter = 1 where id = ${project}`;
    }
    api = (await import("./index")).app;
    workspaces = await import("./slack/workspace");
    await signIn(owner, orgA, jars.owner);
    await signIn(editor, orgA, jars.editor);
  }, 120_000);
  beforeEach(() => {
    effects.enqueue.mockReset().mockResolvedValue(undefined);
    effects.publish.mockReset().mockResolvedValue(undefined);
    useSlack();
    // `resetSlack` per factory call would hand out a new double each time; keep one per test.
    const current = resetSlack();
    workspaces.setSlackApiFactory(() => current);
  });
  afterAll(async () => {
    workspaces.setSlackApiFactory(null);
    if (fixture) {
      await closeIdentityDatabase();
      await getRuntimeDb().$client.end();
      await fixture.dispose();
    }
    vi.unstubAllEnvs();
  });

  // --- Settings ---------------------------------------------------------------------------------------

  it("connects the app, proves the token and never returns a secret", async () => {
    const bad = resetSlack({
      authTest: vi.fn(() => Promise.resolve({ ok: false as const, error: "invalid_auth" })),
    });
    workspaces.setSlackApiFactory(() => bad);
    const rejected = await request("/api/slack", {
      method: "PUT",
      body: { signingSecret, botToken: `xoxb-${"1".repeat(30)}` },
    });
    expect(rejected.status).toBe(400);
    expect(await db()`select 1 from slack_workspace where org_id = ${orgA}`).toHaveLength(0);

    // Both credentials are needed the first time.
    expect((await request("/api/slack", { method: "PUT", body: { signingSecret } })).status).toBe(400);

    useSlack();
    const created = await request("/api/slack", {
      method: "PUT",
      body: { signingSecret, botToken: `xoxb-${"1".repeat(30)}` },
    });
    expect(created.status, JSON.stringify(await created.clone().json())).toBe(201);
    const text = JSON.stringify(await created.json());
    expect(text).not.toContain(signingSecret);
    expect(text).not.toContain("xoxb-");
    const [row] = await db()`select * from slack_workspace where org_id = ${orgA}`;
    expect(row?.team_id).toBe(ids.teamA);
    expect(row?.signing_secret).toMatch(/^v1\./);
    expect(row?.bot_token).toMatch(/^v1\./);
    expect(row?.token_hint).toBe("…1111");

    const read = await request("/api/slack");
    const body = await read.text();
    expect(body).not.toContain(signingSecret);
    expect(body).not.toContain("xoxb-");
    const parsed = JSON.parse(body) as Json;
    expect(parsed.connection).toMatchObject({ teamName: "Acme", tokenHint: "…1111", active: true });
    expect(parsed.requestUrls.interactivity).toBe("http://localhost:3100/api/slack/interactivity");
    expect((JSON.parse(parsed.manifest as string) as Json).features.slash_commands[0].url).toBe(
      parsed.requestUrls.commands,
    );
  });

  it("is for workspace admins only", async () => {
    for (const [method, path, body] of [
      ["GET", "/api/slack", undefined],
      ["PUT", "/api/slack", { active: false }],
      ["POST", "/api/slack/test", {}],
      ["POST", "/api/slack/routes", { channelId: "C0123456789" }],
      ["POST", "/api/slack/sync-members", {}],
    ] as const) {
      const r = await request(path, { method, jar: jars.editor, ...(body ? { body } : {}) });
      expect(r.status, `${method} ${path}`).toBe(403);
    }
  });

  it("refuses a bot token from a Slack team another workspace already connected", async () => {
    // Workspace B owns its team; A's token resolves to that team too.
    await db()`insert into slack_workspace (org_id,team_id,team_name,signing_secret,bot_token,token_hint) values (${orgB},${ids.teamB},'B','v1.x.y.z','v1.x.y.z','0000')`;
    const clash = await request("/api/slack", {
      method: "PUT",
      body: { botToken: `xoxb-${"4".repeat(30)}` },
    });
    // Same org, different team from the one it already has.
    useSlackLazily(() =>
      resetSlack({
        authTest: vi.fn(() =>
          Promise.resolve({
            ok: true as const,
            data: { teamId: ids.teamB, teamName: "B", teamUrl: null, botUserId: null },
          }),
        ),
      }),
    );
    const other = await request("/api/slack", {
      method: "PUT",
      body: { botToken: `xoxb-${"4".repeat(30)}` },
    });
    expect(clash.status).toBe(200);
    expect(other.status).toBe(409);
    await db()`delete from slack_workspace where org_id = ${orgB}`;
  });

  it("manages routes: per project and event, project must belong to the workspace", async () => {
    const created = await request("/api/slack/routes", {
      method: "POST",
      body: {
        projectId: ids.projectA,
        channelId: "C0ROUTEA01",
        channelName: "feedback",
        events: ["feedback.created", "feedback.status_changed", "comment.created"],
      },
    });
    expect(created.status).toBe(201);
    const route = (await json(created)).route;
    expect(
      (
        await request(`/api/slack/routes/${route.id}`, {
          method: "PATCH",
          body: { events: ["feedback.created"] },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request("/api/slack/routes", {
          method: "POST",
          body: { projectId: ids.projectB, channelId: "C0ROUTEA02" },
        })
      ).status,
    ).toBe(404);
    expect(
      (await request("/api/slack/routes", { method: "POST", body: { channelId: "general" } })).status,
    ).toBe(400);
    await request(`/api/slack/routes/${route.id}`, {
      method: "PATCH",
      body: {
        events: ["feedback.created", "feedback.status_changed", "comment.created", "feedback.assigned"],
      },
    });
    const listed = (await json(await request("/api/slack"))).routes;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ channelId: "C0ROUTEA01", projectId: ids.projectA });
  });

  // --- Card buttons -----------------------------------------------------------------------------------

  it("refuses an unsigned, mis-signed, stale or unknown-team request and changes nothing", async () => {
    const before = await item();
    const payload = {
      type: "block_actions",
      user: { id: SLACK.owner },
      actions: [
        { block_id: `pw:${ids.itemA}`, action_id: "pw_set_status", selected_option: { value: "resolved" } },
      ],
    };
    const form = {
      payload: JSON.stringify({ team: { id: ids.teamA }, trigger_id: randomUUID(), ...payload }),
    };
    const raw = await api.request("http://localhost:3100/api/slack/interactivity", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
    });
    expect(raw.status).toBe(401);
    expect((await slackPost("interactivity", form, { secret: signingSecretB })).status).toBe(401);
    expect((await slackPost("interactivity", form, { now: Date.now() - 6 * 60_000 })).status).toBe(401);
    const unknown = {
      payload: JSON.stringify({ team: { id: "T0UNKNOWN0" }, trigger_id: randomUUID(), ...payload }),
    };
    expect((await slackPost("interactivity", unknown)).status).toBe(401);
    expect((await item()).status).toBe(before.status);
    expect(slack.userInfo).not.toHaveBeenCalled();
  });

  it("Assign to me: acts as the member found by verified email, updates the original message, once", async () => {
    const body = {
      type: "block_actions",
      user: { id: SLACK.owner },
      container: { type: "message", channel_id: "C0ROUTEA01", message_ts: "1700000000.000100" },
      trigger_id: randomUUID(),
      actions: [{ block_id: `pw:${ids.itemA}`, action_id: "pw_assign_me", value: ids.itemA }],
    };
    const form = { payload: JSON.stringify({ team: { id: ids.teamA }, ...body }) };
    expect((await slackPost("interactivity", form)).status).toBe(200);
    expect((await item()).assignee_ids).toEqual([owner]);
    const [link] = await db()`select * from slack_user_link where slack_user_id = ${SLACK.owner}`;
    expect(link).toMatchObject({ user_id: owner, source: "email", org_id: orgA });
    const [activity] =
      await db()`select * from activity where feedback_id = ${ids.itemA} and type = 'assigneeIds_changed'`;
    expect(activity).toMatchObject({ actor_id: owner });
    expect(activity?.data).toMatchObject({ via: "slack" });
    // The original message shows the new assignee.
    expect(slack.updateMessage).toHaveBeenCalledTimes(1);
    const update = slack.updateMessage.mock.calls[0]?.[0] as Json;
    expect(update).toMatchObject({ channel: "C0ROUTEA01", ts: "1700000000.000100" });
    expect(JSON.stringify(update.blocks)).toContain("assigned to");
    // It also went through the normal update path: the domain events were emitted.
    expect(effects.enqueue.mock.calls.some((c) => c[0] === "events.dispatch")).toBe(true);

    // Slack redelivers the same interaction (same trigger id): acknowledged, not done twice.
    expect((await slackPost("interactivity", form)).status).toBe(200);
    expect(slack.updateMessage).toHaveBeenCalledTimes(1);
  });

  it("Set status and Add label go through the same update path", async () => {
    await press({ action_id: "pw_set_status", selected_option: { value: "resolved" } });
    const done = await item();
    expect(done.status).toBe("resolved");
    expect(done.resolved_at).not.toBeNull();
    await press({ action_id: "pw_add_label", selected_option: { value: ids.labelA } });
    expect(
      await db()`select 1 from feedback_label where feedback_id = ${ids.itemA} and label_id = ${ids.labelA}`,
    ).toHaveLength(1);
    // Pressing it again changes nothing and doesn't error.
    await press({ action_id: "pw_add_label", selected_option: { value: ids.labelA } });
    expect(await db()`select 1 from feedback_label where feedback_id = ${ids.itemA}`).toHaveLength(1);
    expect(slack.updateMessage).toHaveBeenCalledTimes(3);
    // Unknown status values are refused with an explanation.
    await press({ action_id: "pw_set_status", selected_option: { value: "banana" } });
    expect((await item()).status).toBe("resolved");
    expect(ephemerals().at(-1)?.text).toMatch(/Unknown status/);
  });

  it("a Viewer in Pinwren cannot change anything from Slack", async () => {
    await press({ action_id: "pw_set_status", selected_option: { value: "open" } }, SLACK.viewer);
    expect((await item()).status).toBe("resolved");
    expect(ephemerals().at(-1)).toMatchObject({ user: SLACK.viewer });
    expect(ephemerals().at(-1)?.text).toMatch(/role/);
  });

  it("an unmatched Slack user gets a link-your-account message and can claim the link signed in", async () => {
    await press({ action_id: "pw_set_status", selected_option: { value: "open" } }, SLACK.stranger);
    expect((await item()).status).toBe("resolved");
    const text = ephemerals().at(-1)?.text as string;
    expect(text).toContain("stranger@elsewhere.invalid");
    const token = /token=([^|>]+)/.exec(text)?.[1] ?? "";
    expect(token).not.toBe("");
    // A member signed in to the workspace accepts the link.
    const claimed = await request("/api/slack/link", {
      method: "POST",
      jar: jars.editor,
      body: { token: decodeURIComponent(token) },
    });
    expect(claimed.status, JSON.stringify(await claimed.clone().json())).toBe(200);
    expect(
      await db()`select user_id, source from slack_user_link where slack_user_id = ${SLACK.stranger}`,
    ).toMatchObject([{ user_id: editor, source: "manual" }]);
    // Now the Slack user acts as that editor.
    await press({ action_id: "pw_set_status", selected_option: { value: "in_progress" } }, SLACK.stranger);
    expect((await item()).status).toBe("in_progress");
    // A forged token is refused.
    expect(
      (
        await request("/api/slack/link", {
          method: "POST",
          jar: jars.editor,
          body: { token: `${decodeURIComponent(token)}x` },
        })
      ).status,
    ).toBe(400);
  });

  it("never maps guests or users without an email", async () => {
    await press({ action_id: "pw_set_status", selected_option: { value: "open" } }, SLACK.guest);
    expect(ephemerals().at(-1)?.text).toMatch(/Guests/);
    await press({ action_id: "pw_set_status", selected_option: { value: "open" } }, SLACK.noEmail);
    expect(ephemerals().at(-1)?.text).toMatch(/email/);
    expect((await item()).status).toBe("in_progress");
    expect(
      await db()`select 1 from slack_user_link where slack_user_id in (${SLACK.guest}, ${SLACK.noEmail})`,
    ).toHaveLength(0);
  });

  it("cannot be pointed at another workspace's feedback", async () => {
    const before = await item(ids.itemB);
    await press(
      { action_id: "pw_set_status", selected_option: { value: "resolved" } },
      SLACK.owner,
      {},
      ids.itemB,
    );
    expect(await item(ids.itemB)).toEqual(before);
    expect(ephemerals().at(-1)?.text).toMatch(/gone/);
  });

  it("refuses a second workspace's signed request naming the first workspace's feedback", async () => {
    // B connects its own app; its owner (mapped by email) presses a button on A's item.
    await db()`insert into slack_workspace (org_id,team_id,team_name,signing_secret,bot_token,token_hint) values (${orgB},${ids.teamB},'B',${(await import("./crypto")).encryptSecret(signingSecretB)},${(await import("./crypto")).encryptSecret(`xoxb-${"5".repeat(30)}`)},'5555')`;
    const before = await item();
    const res = await interact(
      {
        team: { id: ids.teamB },
        type: "block_actions",
        user: { id: SLACK.outsider },
        container: { channel_id: "C0ROUTEB01", message_ts: "1700000000.000100" },
        actions: [
          { block_id: `pw:${ids.itemA}`, action_id: "pw_set_status", selected_option: { value: "wont_fix" } },
        ],
      },
      { secret: signingSecretB },
    );
    expect(res.status).toBe(200);
    expect(await item()).toEqual(before);
    expect(slack.updateMessage).not.toHaveBeenCalled();
    // And A's secret cannot speak for B's team.
    const forged = await interact({
      team: { id: ids.teamB },
      type: "block_actions",
      user: { id: SLACK.outsider },
      actions: [],
    });
    expect(forged.status).toBe(401);
    await db()`delete from slack_workspace where org_id = ${orgB}`;
  });

  // --- Capture ----------------------------------------------------------------------------------------

  it("the message shortcut opens a prefilled form with the message's channel and timestamp", async () => {
    const res = await interact({
      type: "message_action",
      callback_id: "pinwren_create_feedback",
      user: { id: SLACK.owner },
      trigger_id: "trigger-1",
      channel: { id: "C0ROUTEA01" },
      message: { ts: "1700000123.000200", text: "Checkout button does nothing\nsince the deploy" },
    });
    expect(res.status).toBe(200);
    expect(slack.openView).toHaveBeenCalledTimes(1);
    const { triggerId, view } = slack.openView.mock.calls[0]?.[0] as Json;
    expect(triggerId).toBe("trigger-1");
    expect(JSON.parse(view.private_metadata as string)).toEqual({ c: "C0ROUTEA01", ts: "1700000123.000200" });
    const title = view.blocks.find((b: Json) => b.block_id === "title");
    expect(title.element.initial_value).toBe("Checkout button does nothing");
    const projects = view.blocks.find((b: Json) => b.block_id === "project").element.options;
    // Only this workspace's projects are offered; the one routed to the channel is preselected.
    expect(projects.map((o: Json) => o.value).sort()).toEqual([ids.projectA, ids.projectA2].sort());
    expect(view.blocks.find((b: Json) => b.block_id === "project").element.initial_option.value).toBe(
      ids.projectA,
    );
  });

  const submit = (
    values: { title?: string; body?: string; project?: string; kind?: string },
    over: { viewId?: string; user?: string; meta?: Json } = {},
  ) =>
    interact({
      type: "view_submission",
      user: { id: over.user ?? SLACK.owner },
      view: {
        id: over.viewId ?? `V${randomUUID().slice(0, 8)}`,
        callback_id: "pinwren_feedback_modal",
        private_metadata: JSON.stringify(over.meta ?? { c: "C0ROUTEA01", ts: "1700000123.000200" }),
        state: {
          values: {
            title: { v: { value: values.title ?? null } },
            body: { v: { value: values.body ?? null } },
            project: { v: { selected_option: values.project ? { value: values.project } : null } },
            kind: { v: { selected_option: { value: values.kind ?? "bug" } } },
          },
        },
      },
    });

  it("the form creates feedback as the mapped member with the Slack permalink, once per submission", async () => {
    const viewId = "V-create-1";
    const res = await submit(
      { title: "Checkout fails", body: "It spins forever", project: ids.projectA, kind: "bug" },
      { viewId },
    );
    expect(res.status).toBe(200);
    const rows = await db()`select * from feedback where org_id = ${orgA} and title = 'Checkout fails'`;
    expect(rows).toHaveLength(1);
    const f = rows[0] as Json;
    expect(f).toMatchObject({ source: "slack", reporter_id: owner, kind: "bug", project_id: ids.projectA });
    expect(f.body).toContain("It spins forever");
    expect(f.body).toContain("https://acme.slack.com/archives/C0ROUTEA01/p1700000123000200");
    expect(f.metadata).toEqual({ slack: "https://acme.slack.com/archives/C0ROUTEA01/p1700000123000200" });
    expect(f.number).toBe(2);
    expect(
      await db()`select actor_id from activity where feedback_id = ${f.id as string} and type = 'created'`,
    ).toMatchObject([{ actor_id: owner }]);
    expect(effects.enqueue.mock.calls.some((c) => c[0] === "events.dispatch")).toBe(true);
    expect(ephemerals().at(-1)?.text).toMatch(/Filed as #2/);

    // The same view submitted again (a retry): no second item, no second confirmation.
    const again = await submit(
      { title: "Checkout fails", body: "It spins forever", project: ids.projectA },
      { viewId },
    );
    expect(again.status).toBe(200);
    expect(
      await db()`select 1 from feedback where org_id = ${orgA} and title = 'Checkout fails'`,
    ).toHaveLength(1);
    expect(ephemerals().filter((e) => (e.text as string).includes("Filed as"))).toHaveLength(1);
  });

  it("the form validates in the modal and refuses another workspace's project", async () => {
    const empty = await json(await submit({ project: ids.projectA }));
    expect(empty).toMatchObject({
      response_action: "errors",
      errors: { title: expect.stringMatching(/title|details/) },
    });
    const none = await json(await submit({ title: "x" }));
    expect(none.response_action).toBe("errors");
    const foreign = await json(await submit({ title: "x", project: ids.projectB }));
    expect(foreign).toMatchObject({ response_action: "errors", errors: { project: expect.any(String) } });
    expect(await db()`select 1 from feedback where project_id = ${ids.projectB}`).toHaveLength(1);
    // A Viewer can't file feedback.
    const denied = await json(await submit({ title: "x", project: ids.projectA }, { user: SLACK.viewer }));
    expect(denied.response_action).toBe("errors");
    expect(await db()`select 1 from feedback where title = 'x'`).toHaveLength(0);
  });

  it("limits how much one person can file in an hour", async () => {
    const key = `slack:new:%`;
    await db()`delete from rate_limit where key like ${key}`;
    for (let i = 0; i < 20; i++) {
      // A successful submission answers with an empty body (the modal closes).
      const r = await submit({ title: `bulk ${i}`, project: ids.projectA });
      expect(await r.text()).toBe("");
    }
    const over = await json(await submit({ title: "one too many", project: ids.projectA }));
    expect(over.response_action).toBe("errors");
    await db()`delete from rate_limit where key like ${key}`;
  });

  // --- Slash command ----------------------------------------------------------------------------------

  const command = (text: string, user: string = SLACK.owner) =>
    slackPost("commands", {
      team_id: ids.teamA,
      user_id: user,
      channel_id: "C0ROUTEA01",
      command: "/pinwren",
      text,
      trigger_id: randomUUID(),
    });

  it("/pinwren answers help, link and unknown subcommands privately", async () => {
    const help = await json(await command(""));
    expect(help).toMatchObject({ response_type: "ephemeral" });
    expect(help.text).toContain("/pinwren new");
    const link = await json(await command("link"));
    expect(link.text).toContain("/slack/link?token=");
    const unknown = await json(await command("<!channel> boom"));
    expect(unknown.text).not.toContain("<!channel>");
    expect(unknown.text).toContain("/pinwren new");
  });

  it("/pinwren new opens the form with the title, for mapped members only", async () => {
    const ok = await command("new Slow search");
    expect(ok.status).toBe(200);
    const view = (slack.openView.mock.calls[0]?.[0] as Json).view;
    expect(view.blocks.find((b: Json) => b.block_id === "title").element.initial_value).toBe("Slow search");
    expect(JSON.parse(view.private_metadata as string)).toEqual({ c: "C0ROUTEA01" });

    slack.openView.mockClear();
    const denied = await json(await command("new", SLACK.viewer));
    expect(denied.text).toMatch(/can't file/);
    expect(slack.openView).not.toHaveBeenCalled();
    const stranger = await json(await command("new", "U0STRANGER"));
    expect(stranger).toBeDefined();
  });

  // --- Outbound cards ---------------------------------------------------------------------------------

  const event = (type: string, extra: Json = {}) => ({
    id: randomUUID(),
    type: type as never,
    orgId: orgA,
    feedbackId: ids.itemA,
    actor: { kind: "user" as const, id: owner },
    at: new Date().toISOString(),
    ...extra,
  });

  it("posts a card with buttons to every routed channel once, and records it", async () => {
    const { deliverSlack } = await import("./slack/deliver");
    await db()`delete from slack_message where org_id = ${orgA}`;
    const created = event("feedback.created");
    expect(await deliverSlack(created as never, slack)).toMatchObject({ posted: 1, failed: 0 });
    expect(slack.postMessage).toHaveBeenCalledTimes(1);
    const post = slack.postMessage.mock.calls[0]?.[0] as Json;
    expect(post.channel).toBe("C0ROUTEA01");
    expect(post.blocks.some((b: Json) => b.type === "actions" && b.block_id === `pw:${ids.itemA}`)).toBe(
      true,
    );
    // The visitor's `<!channel>` is entity-escaped.
    expect(JSON.stringify(post.blocks)).not.toContain("<!channel>");
    expect(
      await db()`select channel_id, ts from slack_message where feedback_id = ${ids.itemA}`,
    ).toMatchObject([{ channel_id: "C0ROUTEA01", ts: "1700000000.000100" }]);
    // A retried job for the same event posts nothing more.
    expect(await deliverSlack(created as never, slack)).toMatchObject({ posted: 0, updated: 0 });
    expect(slack.postMessage).toHaveBeenCalledTimes(1);
  });

  it("refreshes the card in place and replies in its thread for later events", async () => {
    const { deliverSlack } = await import("./slack/deliver");
    slack.postMessage.mockClear();
    const changed = event("feedback.status_changed", {
      changes: { status: { from: "open", to: "resolved" } },
    });
    await deliverSlack(changed, slack);
    expect(slack.updateMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "C0ROUTEA01", ts: "1700000000.000100" }),
    );
    expect(slack.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "C0ROUTEA01",
        threadTs: "1700000000.000100",
        text: expect.stringContaining("resolved"),
      }),
    );
    // Events the route doesn't carry are ignored; so are other projects' routes.
    slack.postMessage.mockClear();
    await deliverSlack(
      event("feedback.priority_changed", { changes: { priority: { from: "none", to: "high" } } }),
      slack,
    );
    expect(slack.postMessage).not.toHaveBeenCalled();
  });

  it("keeps internal notes out of the channel", async () => {
    const { deliverSlack } = await import("./slack/deliver");
    slack.postMessage.mockClear();
    const [internal] =
      await db()`insert into comment (org_id,feedback_id,body,visibility,author_id) values (${orgA},${ids.itemA},'secret <!channel> note','internal',${owner}) returning id`;
    const [open] =
      await db()`insert into comment (org_id,feedback_id,body,visibility,author_id) values (${orgA},${ids.itemA},'public reply','public',${owner}) returning id`;
    await deliverSlack(event("comment.created", { commentId: internal?.id }), slack);
    expect(slack.postMessage).not.toHaveBeenCalled();
    await deliverSlack(event("comment.created", { commentId: open?.id }), slack);
    expect(slack.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        threadTs: "1700000000.000100",
        text: expect.stringContaining("public reply"),
      }),
    );
  });

  it("asks the queue to retry when Slack rate-limits, and records a fixable error otherwise", async () => {
    const { deliverSlack } = await import("./slack/deliver");
    await db()`delete from slack_message where org_id = ${orgA}`;
    const limited = fakeSlackApi({
      postMessage: vi.fn(() => Promise.resolve({ ok: false as const, error: "ratelimited" })),
    });
    const e = event("feedback.created");
    await expect(deliverSlack(e as never, limited)).rejects.toThrow(/rate limited/);
    // The failed attempt was not marked done, so the retry posts.
    const ok = fakeSlackApi({});
    expect(await deliverSlack(e as never, ok)).toMatchObject({ posted: 1 });

    await db()`delete from slack_message where org_id = ${orgA}`;
    const notIn = fakeSlackApi({
      postMessage: vi.fn(() => Promise.resolve({ ok: false as const, error: "not_in_channel" })),
    });
    expect(await deliverSlack(event("feedback.created") as never, notIn)).toMatchObject({ failed: 1 });
    const [ws] = await db()`select last_error from slack_workspace where org_id = ${orgA}`;
    expect(ws?.last_error).toMatch(/invite/);
  });

  it("does nothing while the connection is switched off", async () => {
    const { deliverSlack } = await import("./slack/deliver");
    await db()`delete from slack_message where org_id = ${orgA}`;
    expect((await request("/api/slack", { method: "PUT", body: { active: false } })).status).toBe(200);
    const off = fakeSlackApi({});
    expect(await deliverSlack(event("feedback.created") as never, off)).toMatchObject({ posted: 0 });
    expect(off.postMessage).not.toHaveBeenCalled();
    const signed = await command("help");
    expect(signed.status).toBe(401);
    expect((await request("/api/slack", { method: "PUT", body: { active: true } })).status).toBe(200);
  });

  // --- Test button, channels, mapping -----------------------------------------------------------------

  it("the test button checks the token and posts to the route's channel, explaining failures", async () => {
    const ok = await json(await request("/api/slack/test", { method: "POST", body: {} }));
    expect(ok).toMatchObject({ ok: true, channelId: "C0ROUTEA01" });
    expect(slack.postMessage).toHaveBeenCalledWith(expect.objectContaining({ channel: "C0ROUTEA01" }));

    useSlackLazily(() =>
      resetSlack({
        postMessage: vi.fn(() => Promise.resolve({ ok: false as const, error: "channel_not_found" })),
      }),
    );
    const bad = await json(await request("/api/slack/test", { method: "POST", body: {} }));
    expect(bad.ok).toBe(false);
    expect(bad.message).toMatch(/channel/);
    const [ws] = await db()`select last_error from slack_workspace where org_id = ${orgA}`;
    expect(ws?.last_error).toMatch(/channel/);

    // A route of another workspace can't be tested.
    const foreign = await request("/api/slack/test", { method: "POST", body: { routeId: randomUUID() } });
    expect(foreign.status).toBe(404);
  });

  it("lists channels for the picker, and a missing scope is an answer rather than an error", async () => {
    useSlackLazily(() =>
      resetSlack({
        listChannels: vi.fn(() =>
          Promise.resolve({
            ok: true as const,
            data: [
              { id: "C0BBBBBBB1", name: "zeta", isMember: true, isPrivate: false },
              { id: "C0AAAAAAA1", name: "alpha", isMember: false, isPrivate: false },
            ],
          }),
        ),
      }),
    );
    const list = await json(await request("/api/slack/channels"));
    expect(list.channels.map((c: Json) => c.name)).toEqual(["alpha", "zeta"]);
    useSlackLazily(() =>
      resetSlack({
        listChannels: vi.fn(() => Promise.resolve({ ok: false as const, error: "missing_scope" })),
      }),
    );
    const missing = await json(await request("/api/slack/channels"));
    expect(missing.channels).toEqual([]);
    expect(missing.error).toMatch(/permission/);
  });

  it("maps members by email in one pass and shows who is linked", async () => {
    await db()`delete from slack_user_link where org_id = ${orgA}`;
    useSlackLazily(() =>
      resetSlack({
        listUsers: vi.fn(() =>
          Promise.resolve({
            ok: true as const,
            data: [
              {
                id: SLACK.owner,
                name: "o",
                email: email(owner),
                isBot: false,
                isRestricted: false,
                deleted: false,
              },
              {
                id: SLACK.editor,
                name: "e",
                email: email(editor),
                isBot: false,
                isRestricted: false,
                deleted: false,
              },
              {
                id: SLACK.guest,
                name: "g",
                email: email(viewer),
                isBot: false,
                isRestricted: true,
                deleted: false,
              },
              {
                id: "U0NOBODY01",
                name: "n",
                email: "nobody@elsewhere.invalid",
                isBot: false,
                isRestricted: false,
                deleted: false,
              },
            ],
          }),
        ),
      }),
    );
    const synced = await json(await request("/api/slack/sync-members", { method: "POST" }));
    expect(synced).toEqual({ linked: 2, scanned: 3 });
    const state = await json(await request("/api/slack"));
    const members = state.members as Json[];
    const byId: Record<string, Json> = Object.fromEntries(members.map((m) => [m.userId as string, m]));
    expect(byId[owner]).toMatchObject({ linked: true, slackUserId: SLACK.owner, source: "email" });
    expect(byId[editor]).toMatchObject({ linked: true });
    expect(byId[viewer]).toMatchObject({ linked: false });
    expect(state.members.map((m: Json) => m.userId)).not.toContain(outsider);
    // Unlinking is an admin action on this workspace's links only.
    expect((await request(`/api/slack/links/${byId[editor]?.linkId}`, { method: "DELETE" })).status).toBe(
      204,
    );
    expect((await request(`/api/slack/links/${byId[editor]?.linkId}`, { method: "DELETE" })).status).toBe(
      404,
    );
  });

  it("disconnecting removes routes, mappings and message links, and stops answering Slack", async () => {
    expect((await request("/api/slack", { method: "DELETE" })).status).toBe(204);
    for (const table of ["slack_workspace", "slack_route", "slack_user_link", "slack_message"]) {
      expect(await db().unsafe(`select 1 from ${table} where org_id = $1`, [orgA])).toHaveLength(0);
    }
    expect((await command("help")).status).toBe(401);
  });
});
