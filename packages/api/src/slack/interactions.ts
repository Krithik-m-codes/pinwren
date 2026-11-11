import {
  FEEDBACK_KINDS,
  feedbackStatus,
  roleCan,
  SLACK_ACTIONS,
  SLACK_CALLBACKS,
  SLACK_CHANNEL_ID,
  slackModalValues,
} from "@pinwren/core";
import { feedback, feedbackLabel, getDb, project, slackRoute, withOrg } from "@pinwren/db";
import { and, asc, eq, isNull } from "drizzle-orm";
import { ApiError } from "../errors";
import { consume } from "../rate-limit";
import { updateFeedback } from "../services/feedback";
import { createFeedbackFromSlack } from "../services/slack-capture";
import { feedbackIdOfBlock, feedbackModal, HELP_TEXT, MODAL_ACTION, MODAL_BLOCKS } from "./blocks";
import { buildCard } from "./cards";
import { REFRESHED_HEADLINE } from "./deliver";
import { type ActorResult, type SlackActor, resolveActor } from "./identity";
import type { SlackApi } from "./client";
import { slackLinkToken, slackLinkUrl } from "./link-token";
import type { SlackWorkspaceRow } from "./workspace";

// What Slack's interactivity and slash-command requests do once `routes/slack.ts` has verified them. Every
// handler acts as the *mapped Pinwren member* (never as the Slack user directly): the same permission
// matrix and the same update path as the dashboard, then the original message is refreshed.

export type SlackCtx = {
  ws: Pick<SlackWorkspaceRow, "id" | "orgId" | "teamId" | "teamUrl">;
  api: SlackApi;
};

type Raw = Record<string, unknown>;
export const rec = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? (v as unknown[]) : []);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Slack ids look like `U0123ABCD`; anything else is not a user we can act for. */
const SLACK_ID = /^[A-Z0-9]{9,15}$/;

/** An action per user and minute, and new items per user and hour. */
const ACTIONS_PER_MIN = 60;
const CAPTURES_PER_HOUR = 20;

export type EphemeralReply = { response_type: "ephemeral"; text: string };
const ephemeralReply = (text: string): EphemeralReply => ({ response_type: "ephemeral", text });

/** The text shown to someone who can't act: how to fix it, never what the server knows about others. */
function denial(ctx: SlackCtx, slackUserId: string, r: Extract<ActorResult, { ok: false }>): string {
  switch (r.reason) {
    case "unlinked": {
      const url = slackLinkUrl(slackLinkToken(ctx.ws.id, slackUserId));
      return (
        `Your Slack email (${r.email ?? "unknown"}) doesn't match a member of this Pinwren workspace. ` +
        `Sign in to Pinwren with that address, or link your account yourself: <${url}|Link my Pinwren account>. ` +
        "The link works for an hour."
      );
    }
    case "no_email":
      return "Pinwren couldn't read your Slack email. Ask a Slack admin to let the app read emails (users:read.email), or link your account with /pinwren link.";
    case "not_allowed":
      return "Guests and bots can't act on Pinwren feedback from Slack.";
    case "lookup_failed":
      return "Pinwren couldn't look you up in Slack just now. Try again in a moment.";
  }
}

async function say(ctx: SlackCtx, channel: string | null, slackUserId: string, text: string) {
  if (!channel) return;
  await ctx.api.postEphemeral({ channel, user: slackUserId, text });
}

/** The member behind a Slack user, or an ephemeral message explaining why not. */
async function actorOrExplain(
  ctx: SlackCtx,
  slackUserId: string,
): Promise<{ actor: SlackActor } | { message: string }> {
  const r = await resolveActor(ctx.ws, slackUserId, ctx.api);
  return r.ok ? { actor: r.actor } : { message: denial(ctx, slackUserId, r) };
}

// --- Card buttons ------------------------------------------------------------------------------------

export async function handleBlockActions(ctx: SlackCtx, p: Raw): Promise<void> {
  const slackUser = str(rec(p.user).id);
  if (!slackUser || !SLACK_ID.test(slackUser)) return;
  const channel = str(rec(p.container).channel_id) ?? str(rec(p.channel).id);
  const ts = str(rec(p.container).message_ts) ?? str(rec(p.message).ts);
  const action = rec(arr(p.actions)[0]);
  const actionId = str(action.action_id);
  if (!actionId || actionId === SLACK_ACTIONS.open) return;

  const itemId =
    feedbackIdOfBlock(action.block_id) ?? (UUID.test(str(action.value) ?? "") ? str(action.value) : null);
  if (!itemId) return;
  if (!(await consume(`slack:act:${ctx.ws.id}:${slackUser}`, ACTIONS_PER_MIN, 60))) {
    return say(ctx, channel, slackUser, "You're going a little fast: try again in a minute.");
  }

  const who = await actorOrExplain(ctx, slackUser);
  if ("message" in who) return say(ctx, channel, slackUser, who.message);
  if (!roleCan(who.actor.role, "feedback.update")) {
    return say(ctx, channel, slackUser, "Your role in this Pinwren workspace can't change feedback.");
  }

  try {
    await withOrg(ctx.ws.orgId, async () => {
      const [current] = await getDb()
        .select({ assigneeIds: feedback.assigneeIds, projectId: feedback.projectId })
        .from(feedback)
        .where(and(eq(feedback.id, itemId), eq(feedback.orgId, ctx.ws.orgId), isNull(feedback.deletedAt)));
      if (!current) throw new ApiError(404, "NOT_FOUND", "That feedback is gone");
      const actor = { kind: "user" as const, userId: who.actor.userId, via: "slack" as const };
      const selected = str(rec(action.selected_option).value);
      if (actionId === SLACK_ACTIONS.assignMe) {
        if (current.assigneeIds.includes(who.actor.userId)) return;
        await updateFeedback(ctx.ws.orgId, actor, itemId, {
          assigneeIds: [...current.assigneeIds, who.actor.userId],
        });
      } else if (actionId === SLACK_ACTIONS.setStatus) {
        const status = feedbackStatus.safeParse(selected);
        if (!status.success) throw new ApiError(400, "VALIDATION_ERROR", "Unknown status");
        await updateFeedback(ctx.ws.orgId, actor, itemId, { status: status.data });
      } else if (actionId === SLACK_ACTIONS.addLabel) {
        if (!selected || !UUID.test(selected)) throw new ApiError(400, "VALIDATION_ERROR", "Unknown label");
        const have = await getDb()
          .select({ id: feedbackLabel.labelId })
          .from(feedbackLabel)
          .where(eq(feedbackLabel.feedbackId, itemId));
        if (have.some((l) => l.id === selected)) return;
        await updateFeedback(ctx.ws.orgId, actor, itemId, { labelIds: [...have.map((l) => l.id), selected] });
      }
    });
  } catch (err) {
    if (err instanceof ApiError) return say(ctx, channel, slackUser, err.message);
    throw err;
  }

  // The original message shows the new state straight away (the dispatch job adds the thread note).
  if (channel && ts) {
    const built = await buildCard(ctx.ws.orgId, itemId);
    if (built) await ctx.api.updateMessage({ channel, ts, ...built.card(REFRESHED_HEADLINE) });
  }
}

// --- Capture: message shortcut, `/pinwren new`, the modal ---------------------------------------------

/** `https://acme.slack.com/archives/C0123/p1700000000123456`, from the workspace url and the message. */
export function permalinkOf(
  teamUrl: string | null,
  channel: string | null,
  ts: string | null,
): string | null {
  if (!teamUrl || !channel || !ts || !/^\d{9,12}\.\d{1,8}$/.test(ts) || !SLACK_CHANNEL_ID.test(channel)) {
    return null;
  }
  try {
    const base = new URL(teamUrl);
    if (base.protocol !== "https:") return null;
    return `${base.origin}/archives/${channel}/p${ts.replace(".", "")}`;
  } catch {
    return null;
  }
}

/** First line of a message, as a title suggestion. */
const titleOf = (text: string) => text.split("\n")[0]?.trim().slice(0, 120) ?? "";

async function openCapture(
  ctx: SlackCtx,
  a: {
    triggerId: string;
    slackUser: string;
    channel: string | null;
    ts: string | null;
    text: string;
    title: string;
  },
): Promise<string | null> {
  const who = await actorOrExplain(ctx, a.slackUser);
  if ("message" in who) return who.message;
  if (!roleCan(who.actor.role, "feedback.create")) {
    return "Your role in this Pinwren workspace can't file feedback.";
  }
  const { projects, routed } = await withOrg(ctx.ws.orgId, async () => {
    const db = getDb();
    const projects = await db
      .select({ id: project.id, name: project.name })
      .from(project)
      .where(and(eq(project.orgId, ctx.ws.orgId), isNull(project.archivedAt)))
      .orderBy(asc(project.name))
      .limit(100);
    const routes = a.channel
      ? await db
          .select({ projectId: slackRoute.projectId })
          .from(slackRoute)
          .where(and(eq(slackRoute.workspaceId, ctx.ws.id), eq(slackRoute.channelId, a.channel)))
      : [];
    return { projects, routed: routes.find((r) => r.projectId)?.projectId ?? undefined };
  });
  if (!projects.length)
    return "This Pinwren workspace has no projects yet: create one in the dashboard first.";
  const view = feedbackModal({
    projects,
    kinds: FEEDBACK_KINDS,
    initial: { title: a.title, body: a.text, projectId: routed },
    metadata: { ...(a.channel ? { c: a.channel } : {}), ...(a.ts ? { ts: a.ts } : {}) },
  });
  const opened = await ctx.api.openView({ triggerId: a.triggerId, view });
  return opened.ok ? null : "Pinwren couldn't open the form (it expires after a few seconds). Try again.";
}

/** The "Create feedback from message" message shortcut. */
export async function handleMessageShortcut(ctx: SlackCtx, p: Raw): Promise<void> {
  const slackUser = str(rec(p.user).id);
  const triggerId = str(p.trigger_id);
  if (!slackUser || !SLACK_ID.test(slackUser) || !triggerId) return;
  const channel = str(rec(p.channel).id);
  const message = rec(p.message);
  const text = str(message.text) ?? "";
  const problem = await openCapture(ctx, {
    triggerId,
    slackUser,
    channel,
    ts: str(message.ts),
    text,
    title: titleOf(text),
  });
  if (problem) await say(ctx, channel, slackUser, problem);
}

/** The global shortcut: the same form, with nothing prefilled. */
export async function handleGlobalShortcut(ctx: SlackCtx, p: Raw): Promise<void> {
  const slackUser = str(rec(p.user).id);
  const triggerId = str(p.trigger_id);
  if (!slackUser || !SLACK_ID.test(slackUser) || !triggerId) return;
  const problem = await openCapture(ctx, {
    triggerId,
    slackUser,
    channel: null,
    ts: null,
    text: "",
    title: "",
  });
  // No channel to answer in: the failure is only visible in the logs, and the shortcut simply does nothing.
  if (problem) console.warn("[pinwren] slack global shortcut:", problem);
}

/** The modal's submission: validate, create the item as the mapped member, confirm in the channel. */
export async function handleViewSubmission(ctx: SlackCtx, p: Raw): Promise<Raw | null> {
  const view = rec(p.view);
  if (view.callback_id !== SLACK_CALLBACKS.modal) return null;
  const slackUser = str(rec(p.user).id);
  const viewId = str(view.id);
  if (!slackUser || !SLACK_ID.test(slackUser) || !viewId) return null;
  const values = rec(rec(view.state).values);
  const read = (block: string) => rec(rec(values[block])[MODAL_ACTION]);
  const errors = (field: string, message: string) => ({
    response_action: "errors",
    errors: { [field]: message },
  });

  const parsed = slackModalValues.safeParse({
    title: str(read(MODAL_BLOCKS.title).value) ?? "",
    body: str(read(MODAL_BLOCKS.body).value) ?? "",
    projectId: str(rec(read(MODAL_BLOCKS.project).selected_option).value),
    kind: str(rec(read(MODAL_BLOCKS.kind).selected_option).value),
  });
  if (!parsed.success) return errors(MODAL_BLOCKS.project, "Pick a project and a type");
  const input = parsed.data;
  if (!input.title && !input.body) return errors(MODAL_BLOCKS.title, "Add a title or some details");

  const who = await actorOrExplain(ctx, slackUser);
  if ("message" in who) return errors(MODAL_BLOCKS.title, who.message.replace(/<[^|>]*\|([^>]*)>/g, "$1"));
  if (!roleCan(who.actor.role, "feedback.create")) {
    return errors(MODAL_BLOCKS.title, "Your role in this Pinwren workspace can't file feedback.");
  }
  if (!(await consume(`slack:new:${ctx.ws.id}:${slackUser}`, CAPTURES_PER_HOUR, 3600))) {
    return errors(MODAL_BLOCKS.title, "You've filed a lot of feedback this hour: try again later.");
  }

  let meta: Raw = {};
  try {
    meta = rec(JSON.parse(str(view.private_metadata) ?? "{}"));
  } catch {
    // Not ours: file without a permalink.
  }
  const channel = str(meta.c);
  const permalink = permalinkOf(ctx.ws.teamUrl, channel, str(meta.ts));

  let created: { id: string; number: number; duplicate: boolean };
  try {
    created = await createFeedbackFromSlack(ctx.ws.orgId, who.actor.userId, {
      projectId: input.projectId,
      kind: input.kind,
      title: input.title || null,
      body: input.body || input.title,
      viewId,
      permalink,
    });
  } catch (err) {
    if (err instanceof ApiError) return errors(MODAL_BLOCKS.project, err.message);
    throw err;
  }
  if (!created.duplicate) {
    const where = channel ?? slackUser;
    await ctx.api.postEphemeral({
      channel: where,
      user: slackUser,
      text: `Filed as #${created.number}. It will appear in the Pinwren inbox.`,
    });
  }
  return null;
}

// --- Slash command ----------------------------------------------------------------------------------

/** `/pinwren [help | new [title] | link]`. Returns the immediate (ephemeral) answer. */
export async function handleCommand(ctx: SlackCtx, form: URLSearchParams): Promise<EphemeralReply | null> {
  const slackUser = form.get("user_id") ?? "";
  if (!SLACK_ID.test(slackUser)) return null;
  const text = (form.get("text") ?? "").trim();
  const [sub = "help", ...rest] = text.split(/\s+/);
  const command = sub.toLowerCase();

  if (command === "" || command === "help") return ephemeralReply(HELP_TEXT);

  if (command === "link") {
    const url = slackLinkUrl(slackLinkToken(ctx.ws.id, slackUser));
    return ephemeralReply(
      `Open <${url}|this link> while signed in to Pinwren to link your Slack account. It works for an hour.`,
    );
  }

  if (command === "new") {
    const triggerId = form.get("trigger_id");
    if (!triggerId) return ephemeralReply("Slack didn't send a trigger for the form: try again.");
    const channel = form.get("channel_id");
    const problem = await openCapture(ctx, {
      triggerId,
      slackUser,
      channel: channel && SLACK_CHANNEL_ID.test(channel) ? channel : null,
      ts: null,
      text: "",
      title: rest.join(" ").slice(0, 200),
    });
    return problem ? ephemeralReply(problem) : null;
  }

  return ephemeralReply(`I don't know "${text.slice(0, 40).replace(/[<>&]/g, "")}".\n\n${HELP_TEXT}`);
}
