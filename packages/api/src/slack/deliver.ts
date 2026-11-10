import { slackMessage, slackRoute, user, getDb, withOrg } from "@pinwren/db";
import { and, eq, inArray } from "drizzle-orm";
import { statusLabel, excerpt } from "../email/templates";
import type { DomainEvent } from "../events";
import { exhausted, consume } from "../rate-limit";
import { loadCommentPayload } from "../services/feedback-payload";
import { EVENT_TITLES, plain, slackEscape } from "../webhooks/format";
import { buildCard } from "./cards";
import type { SlackApi } from "./client";
import { recordSlackError, SLACK_AUTH_ERRORS, slackApiFor, workspaceOfOrg } from "./workspace";

// Outbound: a domain event becomes a card (or an update of the card, plus a thread reply) in every channel
// routed for it. Runs as its own job so a Slack outage can never hold back notifications, emails or webhooks;
// the job is retried only when Slack rate-limits us.

/** How long a delivered (event, route) pair is remembered, so a retried job never posts twice. */
const DONE_WINDOW_S = 24 * 3600;

/** First line of a card that is refreshed in place: what happened is in the thread under it. */
export const REFRESHED_HEADLINE = "Feedback";

const done = (e: DomainEvent, channel: string) => `slack:out:${e.id ?? ""}:${channel}`;

async function actorName(e: DomainEvent): Promise<string> {
  if (e.actor.kind === "guest") return "A visitor";
  if (e.actor.kind === "integration") return "An issue tracker";
  if (!e.actor.id) return "Someone";
  const [u] = await withOrg(e.orgId, () =>
    getDb()
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, e.actor.id ?? "")),
  );
  return u?.name ?? "Someone";
}

function headlineOf(e: DomainEvent): string {
  const to = e.changes?.status?.to ?? e.changes?.priority?.to;
  const base = EVENT_TITLES[e.type] ?? e.type;
  return e.type === "feedback.status_changed" && typeof to === "string"
    ? `${base} → ${statusLabel(to)}`
    : e.type === "feedback.priority_changed" && typeof to === "string"
      ? `${base} → ${to}`
      : base;
}

/** The one-line thread reply for an event on an item whose card already exists. */
async function noteOf(e: DomainEvent, assigneeNames: string): Promise<string | null> {
  const by = await actorName(e);
  switch (e.type) {
    case "feedback.status_changed": {
      const to = e.changes?.status?.to;
      return typeof to === "string" ? `${by} set the status to ${statusLabel(to)}` : null;
    }
    case "feedback.assigned":
      return assigneeNames ? `${by} assigned this to ${assigneeNames}` : `${by} removed the assignee`;
    case "feedback.priority_changed": {
      const to = e.changes?.priority?.to;
      return typeof to === "string" ? `${by} set the priority to ${to}` : null;
    }
    case "comment.created": {
      if (!e.commentId) return null;
      const c = await withOrg(e.orgId, () => loadCommentPayload(e.commentId ?? ""));
      // Internal notes stay in the dashboard: a channel is usually wider than the team.
      if (!c || c.visibility === "internal") return null;
      return `${c.authorName ?? "A visitor"}: ${excerpt(c.body, 600)}`;
    }
    default:
      return null;
  }
}

export type DeliverResult = { posted: number; updated: number; failed: number; rateLimited: boolean };

/** `slack.deliver` handler. Throws only to ask the queue for a retry (Slack rate limit). */
export async function deliverSlack(e: DomainEvent, apiOverride?: SlackApi): Promise<DeliverResult> {
  const result: DeliverResult = { posted: 0, updated: 0, failed: 0, rateLimited: false };
  const ws = await workspaceOfOrg(e.orgId);
  if (!ws?.active) return result;
  const api = apiOverride ?? slackApiFor(ws);
  if (!api) {
    await recordSlackError(ws, "The stored bot token can't be read: enter it again");
    return result;
  }

  const built = await buildCard(e.orgId, e.feedbackId);
  if (!built) return result;
  const { projectId } = built;
  const fresh = built.card(headlineOf(e));
  const refreshed = built.card(REFRESHED_HEADLINE);

  const routes = await withOrg(e.orgId, (db) =>
    db
      .select()
      .from(slackRoute)
      .where(and(eq(slackRoute.workspaceId, ws.id), eq(slackRoute.orgId, e.orgId))),
  );
  const channels = new Set<string>();
  for (const r of routes) {
    if (!r.events.includes(e.type) || (r.projectId && r.projectId !== projectId)) continue;
    channels.add(r.channelId);
  }
  if (!channels.size) return result;

  const assigneeNames = e.type === "feedback.assigned" ? await assigneeList(e) : "";
  const note = await noteOf(e, assigneeNames);
  let lastError: string | null = null;

  for (const channel of channels) {
    const key = e.id ? done(e, channel) : null;
    if (key && (await exhausted(key, 1))) continue;
    const [existing] = await withOrg(e.orgId, (db) =>
      db
        .select()
        .from(slackMessage)
        .where(
          and(
            eq(slackMessage.feedbackId, e.feedbackId),
            eq(slackMessage.channelId, channel),
            eq(slackMessage.workspaceId, ws.id),
          ),
        ),
    );

    let ok = true;
    let error: string | undefined;
    if (existing && e.type !== "feedback.created") {
      // Refresh the card in place, then say what happened under it.
      const upd = await api.updateMessage({ channel, ts: existing.ts, ...refreshed });
      if (upd.ok) result.updated++;
      else if (upd.error === "message_not_found" || upd.error === "cant_update_message") {
        await withOrg(e.orgId, (db) => db.delete(slackMessage).where(eq(slackMessage.id, existing.id)));
      } else {
        ok = false;
        error = upd.error;
        if (upd.error === "ratelimited") result.rateLimited = true;
      }
      if (ok && note) {
        const reply = await api.postMessage({
          channel,
          threadTs: existing.ts,
          text: slackEscape(note),
          blocks: [{ type: "section", text: plain(note) }],
        });
        if (reply.ok) result.posted++;
        else {
          ok = false;
          error = reply.error;
          if (reply.error === "ratelimited") result.rateLimited = true;
        }
      }
    } else if (!existing) {
      const post = await api.postMessage({ channel, ...fresh });
      if (post.ok) {
        result.posted++;
        await withOrg(e.orgId, (db) =>
          db
            .insert(slackMessage)
            .values({
              orgId: e.orgId,
              workspaceId: ws.id,
              feedbackId: e.feedbackId,
              channelId: post.data.channel,
              ts: post.data.ts,
            })
            .onConflictDoNothing(),
        );
      } else {
        ok = false;
        error = post.error;
        if (post.error === "ratelimited") result.rateLimited = true;
      }
    }
    if (!ok) {
      result.failed++;
      lastError = error ?? "unknown_error";
      if (error && SLACK_AUTH_ERRORS.has(error)) break;
    } else if (key) {
      await consume(key, 1, DONE_WINDOW_S);
    }
  }

  if (lastError) await recordSlackError(ws, describeError(lastError));
  else if (ws.lastError && result.posted + result.updated > 0) await recordSlackError(ws, null);
  if (result.rateLimited) throw new Error("slack rate limited: retrying");
  return result;
}

async function assigneeList(e: DomainEvent): Promise<string> {
  const ids = e.changes?.assigneeIds?.to;
  if (!Array.isArray(ids) || !ids.length) return "";
  const rows = await withOrg(e.orgId, () =>
    getDb()
      .select({ name: user.name })
      .from(user)
      .where(inArray(user.id, ids as string[])),
  );
  return rows.map((r) => r.name).join(", ");
}

/** What the settings screen shows for a failed call: an actionable sentence, never Slack's raw response. */
export function describeError(code: string): string {
  switch (code) {
    case "not_in_channel":
      return "The app isn't in a routed channel: invite it with /invite @your-app";
    case "channel_not_found":
      return "A routed channel doesn't exist or is private and the app isn't in it";
    case "is_archived":
      return "A routed channel is archived";
    case "invalid_auth":
    case "token_revoked":
    case "account_inactive":
    case "not_authed":
      return "Slack rejected the bot token: reinstall the app and paste the new token";
    case "missing_scope":
      return "The app is missing a permission: add the scopes listed in the setup guide and reinstall";
    case "ratelimited":
      return "Slack is rate limiting the app: retrying";
    default:
      return `Slack error: ${code}`;
  }
}
