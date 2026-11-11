import {
  MAX_SLACK_ROUTES,
  slackConnectionUpdate,
  slackLinkClaim,
  slackRouteCreate,
  slackRouteUpdate,
  slackTest,
} from "@pinwren/core";
import {
  getDb,
  member,
  project,
  slackRoute,
  slackUserLink,
  slackWorkspace,
  user,
  withOrg,
} from "@pinwren/db";
import { zValidator } from "@hono/zod-validator";
import { and, asc, count, eq } from "drizzle-orm";
import { Hono } from "hono";
import { requireOrgAdmin, type SessionVars } from "../context";
import { encryptSecret } from "../crypto";
import { ApiError, notFound } from "../errors";
import { consume } from "../rate-limit";
import { slackApiForToken, slackApiFor, workspaceOfOrg, recordSlackError } from "../slack/workspace";
import { describeError } from "../slack/deliver";
import { memberByEmail, saveLink } from "../slack/identity";
import { verifySlackLinkToken } from "../slack/link-token";
import { slackManifest, slackRequestUrls, SLACK_SCOPES } from "../slack/manifest";

// Settings › Integrations › Slack (workspace admins): the app's credentials, channel routing, the member
// mapping and the test button. Secrets are encrypted at rest and never returned; the bot token's last four
// characters identify it. Calls that reach Slack hold no database transaction while they wait.

type Workspace = typeof slackWorkspace.$inferSelect;
type Route = typeof slackRoute.$inferSelect;

const connectionOut = (w: Workspace) => ({
  id: w.id,
  teamId: w.teamId,
  teamName: w.teamName,
  teamUrl: w.teamUrl,
  botUserId: w.botUserId,
  tokenHint: w.tokenHint,
  active: w.active,
  lastError: w.lastError,
  createdAt: w.createdAt,
  updatedAt: w.updatedAt,
});

const routeOut = (r: Route) => ({
  id: r.id,
  projectId: r.projectId,
  channelId: r.channelId,
  channelName: r.channelName,
  events: r.events,
});

const hint = (token: string) => `…${token.slice(-4)}`;

async function requireWorkspace(orgId: string): Promise<Workspace> {
  const ws = await workspaceOfOrg(orgId);
  if (!ws) throw new ApiError(409, "SLACK_NOT_CONNECTED", "Connect your Slack app first");
  return ws;
}

async function assertProject(orgId: string, projectId: string | null | undefined) {
  if (!projectId) return;
  const [p] = await getDb()
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.orgId, orgId)));
  if (!p) throw notFound("Project");
}

async function ownRoute(orgId: string, id: string): Promise<Route> {
  const [r] = await getDb()
    .select()
    .from(slackRoute)
    .where(and(eq(slackRoute.id, id), eq(slackRoute.orgId, orgId)));
  if (!r) throw notFound("Route");
  return r;
}

/** Name of the member list entry: who is mapped, who is not. */
async function mappingOf(orgId: string, workspaceId: string) {
  const rows = await getDb()
    .select({
      userId: user.id,
      name: user.name,
      email: user.email,
      role: member.role,
      linkId: slackUserLink.id,
      slackUserId: slackUserLink.slackUserId,
      source: slackUserLink.source,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .leftJoin(
      slackUserLink,
      and(
        eq(slackUserLink.userId, user.id),
        eq(slackUserLink.workspaceId, workspaceId),
        eq(slackUserLink.orgId, orgId),
      ),
    )
    .where(eq(member.organizationId, orgId))
    .orderBy(asc(user.name));
  return rows.map((r) => ({ ...r, linked: r.linkId !== null }));
}

export const slackSettings = new Hono<{ Variables: SessionVars }>()
  /** The connection, the URLs to paste into the Slack app, the routes and who is mapped. */
  .get("/slack", requireOrgAdmin, async (c) => {
    const db = getDb();
    const [ws] = await db.select().from(slackWorkspace).where(eq(slackWorkspace.orgId, c.var.orgId));
    const base = {
      requestUrls: slackRequestUrls(),
      scopes: SLACK_SCOPES,
      manifest: JSON.stringify(slackManifest(), null, 2),
    };
    if (!ws) return c.json({ connection: null, routes: [], members: [], ...base });
    const routes = await db
      .select()
      .from(slackRoute)
      .where(and(eq(slackRoute.workspaceId, ws.id), eq(slackRoute.orgId, c.var.orgId)))
      .orderBy(asc(slackRoute.createdAt));
    return c.json({
      connection: connectionOut(ws),
      routes: routes.map(routeOut),
      members: await mappingOf(c.var.orgId, ws.id),
      ...base,
    });
  })

  /**
   * Connect, or change credentials. The bot token is proven with `auth.test` first; that call also tells us
   * which Slack team it belongs to, which is what inbound requests are matched on.
   */
  .put("/slack", requireOrgAdmin, zValidator("json", slackConnectionUpdate), async (c) => {
    const body = c.req.valid("json");
    const orgId = c.var.orgId;
    if (!(await consume(`slack:settings:${orgId}`, 20, 3600))) {
      throw new ApiError(429, "RATE_LIMITED", "Too many changes: try again later");
    }
    const current = await workspaceOfOrg(orgId);
    if (!current && (!body.signingSecret || !body.botToken)) {
      throw new ApiError(400, "VALIDATION_ERROR", "Enter the signing secret and the bot token");
    }
    let team: { teamId: string; teamName: string; teamUrl: string | null; botUserId: string | null } | null =
      null;
    if (body.botToken) {
      const test = await slackApiForToken(body.botToken).authTest();
      if (!test.ok) {
        throw new ApiError(400, "SLACK_REJECTED", `Slack rejected the bot token (${test.error})`);
      }
      team = test.data;
      if (current && current.teamId !== team.teamId) {
        throw new ApiError(
          409,
          "SLACK_TEAM_CHANGED",
          "This token belongs to a different Slack workspace: disconnect Slack first to connect another one",
        );
      }
    }
    try {
      const saved = await withOrg(orgId, async (db) => {
        if (current) {
          const [w] = await db
            .update(slackWorkspace)
            .set({
              ...(body.signingSecret ? { signingSecret: encryptSecret(body.signingSecret) } : {}),
              ...(body.botToken
                ? { botToken: encryptSecret(body.botToken), tokenHint: hint(body.botToken), lastError: null }
                : {}),
              ...(team ? { teamName: team.teamName, teamUrl: team.teamUrl, botUserId: team.botUserId } : {}),
              ...(body.active !== undefined ? { active: body.active } : {}),
            })
            .where(and(eq(slackWorkspace.id, current.id), eq(slackWorkspace.orgId, orgId)))
            .returning();
          return w;
        }
        if (!team || !body.botToken || !body.signingSecret) return undefined;
        const [w] = await db
          .insert(slackWorkspace)
          .values({
            orgId,
            teamId: team.teamId,
            teamName: team.teamName,
            teamUrl: team.teamUrl,
            botUserId: team.botUserId,
            signingSecret: encryptSecret(body.signingSecret),
            botToken: encryptSecret(body.botToken),
            tokenHint: hint(body.botToken),
            active: body.active ?? true,
            createdBy: c.var.userId,
          })
          .returning();
        return w;
      });
      if (!saved) throw notFound("Slack connection");
      return c.json({ connection: connectionOut(saved) }, current ? 200 : 201);
    } catch (err) {
      // `team_id` is unique across organisations: another workspace already owns this Slack team.
      const code = err as { code?: string; cause?: { code?: string } };
      if ((code.cause?.code ?? code.code) === "23505") {
        throw new ApiError(
          409,
          "SLACK_TEAM_TAKEN",
          "This Slack workspace is already connected to another Pinwren workspace",
        );
      }
      throw err;
    }
  })

  /** Disconnect: routes, mappings and message links go with it. */
  .delete("/slack", requireOrgAdmin, async (c) => {
    await getDb().delete(slackWorkspace).where(eq(slackWorkspace.orgId, c.var.orgId));
    return c.body(null, 204);
  })

  /** Channels the app can see, for the picker. A failure (missing scope) is an answer, not an error. */
  .get("/slack/channels", requireOrgAdmin, async (c) => {
    const ws = await requireWorkspace(c.var.orgId);
    const api = slackApiFor(ws);
    if (!api) return c.json({ channels: [], error: "The stored bot token can't be read: enter it again" });
    const r = await api.listChannels();
    if (!r.ok) return c.json({ channels: [], error: describeError(r.error) });
    return c.json({
      channels: r.data.sort((a, b) => a.name.localeCompare(b.name)),
      error: null,
    });
  })

  .post("/slack/routes", requireOrgAdmin, zValidator("json", slackRouteCreate), async (c) => {
    const body = c.req.valid("json");
    const ws = await requireWorkspace(c.var.orgId);
    await assertProject(c.var.orgId, body.projectId);
    const [n] = await getDb()
      .select({ n: count() })
      .from(slackRoute)
      .where(and(eq(slackRoute.workspaceId, ws.id), eq(slackRoute.orgId, c.var.orgId)));
    if ((n?.n ?? 0) >= MAX_SLACK_ROUTES) {
      throw new ApiError(409, "TOO_MANY_ROUTES", `At most ${MAX_SLACK_ROUTES} channel routes`);
    }
    const [r] = await getDb()
      .insert(slackRoute)
      .values({
        orgId: c.var.orgId,
        workspaceId: ws.id,
        projectId: body.projectId,
        channelId: body.channelId,
        channelName: body.channelName ?? null,
        events: [...new Set(body.events)],
      })
      .returning();
    if (!r) throw new Error("route insert failed");
    return c.json({ route: routeOut(r) }, 201);
  })

  .patch("/slack/routes/:id", requireOrgAdmin, zValidator("json", slackRouteUpdate), async (c) => {
    const body = c.req.valid("json");
    const current = await ownRoute(c.var.orgId, c.req.param("id"));
    await assertProject(c.var.orgId, body.projectId);
    const set: Partial<typeof slackRoute.$inferInsert> = {};
    if (body.projectId !== undefined) set.projectId = body.projectId;
    if (body.channelId !== undefined) set.channelId = body.channelId;
    if (body.channelName !== undefined) set.channelName = body.channelName;
    if (body.events !== undefined) set.events = [...new Set(body.events)];
    if (!Object.keys(set).length) return c.json({ route: routeOut(current) });
    const [r] = await getDb()
      .update(slackRoute)
      .set(set)
      .where(and(eq(slackRoute.id, current.id), eq(slackRoute.orgId, c.var.orgId)))
      .returning();
    if (!r) throw notFound("Route");
    return c.json({ route: routeOut(r) });
  })

  .delete("/slack/routes/:id", requireOrgAdmin, async (c) => {
    const r = await ownRoute(c.var.orgId, c.req.param("id"));
    await getDb()
      .delete(slackRoute)
      .where(and(eq(slackRoute.id, r.id), eq(slackRoute.orgId, c.var.orgId)));
    return c.body(null, 204);
  })

  /**
   * Check the connection and post a test message. Always 200 with `{ ok, message }` so the screen can show
   * what to fix (the bot isn't in the channel, a scope is missing…).
   */
  .post("/slack/test", requireOrgAdmin, zValidator("json", slackTest), async (c) => {
    const body = c.req.valid("json");
    const orgId = c.var.orgId;
    const ws = await requireWorkspace(orgId);
    if (!(await consume(`slack:test:${orgId}`, 20, 600))) {
      throw new ApiError(429, "RATE_LIMITED", "Too many tests: try again in a few minutes");
    }
    const api = slackApiFor(ws);
    if (!api) return c.json({ ok: false, message: "The stored bot token can't be read: enter it again" });
    const auth = await api.authTest();
    if (!auth.ok) {
      await recordSlackError(ws, describeError(auth.error));
      return c.json({ ok: false, message: describeError(auth.error) });
    }
    let channel = body.channelId ?? null;
    if (!channel) {
      const route = body.routeId
        ? await withOrg(orgId, () => ownRoute(orgId, body.routeId ?? ""))
        : (
            await withOrg(orgId, (db) =>
              db
                .select()
                .from(slackRoute)
                .where(and(eq(slackRoute.workspaceId, ws.id), eq(slackRoute.orgId, orgId)))
                .orderBy(asc(slackRoute.createdAt))
                .limit(1),
            )
          )[0];
      channel = route?.channelId ?? null;
    }
    if (!channel) {
      await recordSlackError(ws, null);
      return c.json({
        ok: true,
        message: `Connected to ${auth.data.teamName}. Add a channel route to send a test message.`,
        channelId: null,
      });
    }
    const text = "Test message from Pinwren: the Slack app is connected and can post here.";
    const posted = await api.postMessage({
      channel,
      text,
      blocks: [{ type: "section", text: { type: "plain_text", text, emoji: false } }],
    });
    if (!posted.ok) {
      await recordSlackError(ws, describeError(posted.error));
      return c.json({ ok: false, message: describeError(posted.error), channelId: channel });
    }
    await recordSlackError(ws, null);
    return c.json({ ok: true, message: `Posted a test message to ${channel}.`, channelId: channel });
  })

  /** Map Slack people to members by verified email, in one pass (Slack's user list, capped at 1,000). */
  .post("/slack/sync-members", requireOrgAdmin, async (c) => {
    const orgId = c.var.orgId;
    const ws = await requireWorkspace(orgId);
    if (!(await consume(`slack:sync:${orgId}`, 10, 3600))) {
      throw new ApiError(429, "RATE_LIMITED", "Too many syncs: try again later");
    }
    const api = slackApiFor(ws);
    if (!api)
      throw new ApiError(409, "SECRET_UNREADABLE", "The stored bot token can't be read: enter it again");
    const people = await api.listUsers();
    if (!people.ok) throw new ApiError(502, "SLACK_ERROR", describeError(people.error));
    let linked = 0;
    let scanned = 0;
    const known = await withOrg(orgId, (db) =>
      db
        .select({ slackUserId: slackUserLink.slackUserId })
        .from(slackUserLink)
        .where(and(eq(slackUserLink.workspaceId, ws.id), eq(slackUserLink.orgId, orgId))),
    );
    const have = new Set(known.map((k) => k.slackUserId));
    for (const p of people.data) {
      if (p.isBot || p.isRestricted || p.deleted || !p.email) continue;
      scanned++;
      if (have.has(p.id)) continue;
      const found = await memberByEmail(orgId, p.email);
      if (!found) continue;
      await saveLink(ws, p.id, found.userId, "email");
      linked++;
    }
    return c.json({ linked, scanned });
  })

  .delete("/slack/links/:id", requireOrgAdmin, async (c) => {
    const [row] = await getDb()
      .delete(slackUserLink)
      .where(and(eq(slackUserLink.id, c.req.param("id")), eq(slackUserLink.orgId, c.var.orgId)))
      .returning({ id: slackUserLink.id });
    if (!row) throw notFound("Link");
    return c.body(null, 204);
  })

  /**
   * "Link my account": the signed-in member accepts the token from a Slack message. The token names the
   * Slack user; this request's session says who they are in Pinwren, in the workspace the token belongs to.
   */
  .post("/slack/link", zValidator("json", slackLinkClaim), async (c) => {
    const claim = verifySlackLinkToken(c.req.valid("json").token);
    if (!claim)
      throw new ApiError(400, "INVALID_LINK", "This link has expired: run /pinwren link again in Slack");
    const ws = await workspaceOfOrg(c.var.orgId);
    if (ws?.id !== claim.workspaceId) {
      throw new ApiError(
        409,
        "WRONG_WORKSPACE",
        "This link is for a different Pinwren workspace: switch to it, then open the link again",
      );
    }
    await saveLink(ws, claim.slackUserId, c.var.userId, "manual");
    return c.json({ linked: true, teamName: ws.teamName });
  });
