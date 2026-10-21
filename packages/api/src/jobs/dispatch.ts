import {
  comment,
  getDb,
  member,
  notification,
  notificationPreference,
  user,
  webhookEndpoint,
} from "@annota/db";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { renderEmail } from "../email/render";
import { excerpt, type FeedbackSummary, feedbackVars, type Rendered, statusLabel } from "../email/templates";
import type { DomainEvent } from "../events";
import { autoCreateIssues, syncIssueState } from "../integrations/issues";
import { type FeedbackContext, loadCommentPayload, loadFeedbackContext } from "../services/feedback-payload";
import { queueDelivery } from "../webhooks/deliver";
import { WEBHOOK_API_VERSION, type WebhookPayload } from "../webhooks/format";
import { enqueue, QUEUES } from "./boss";

type Pref = "newFeedback" | "assigned" | "replies" | "statusChanges";
type Recipient = { userId: string; name: string; email: string; wantsEmail: boolean };

/** Org members who have `pref` switched on for the project (no preference row = on). */
async function membersWanting(
  orgId: string,
  projectId: string,
  pref: Pref,
  only?: string[],
): Promise<Recipient[]> {
  if (only && only.length === 0) return [];
  const col = notificationPreference[pref];
  const rows = await getDb()
    .select({
      userId: user.id,
      name: user.name,
      email: user.email,
      wantsEmail: sql<boolean>`coalesce(${notificationPreference.email}, true)`,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .leftJoin(
      notificationPreference,
      and(eq(notificationPreference.userId, member.userId), eq(notificationPreference.projectId, projectId)),
    )
    .where(
      and(
        eq(member.organizationId, orgId),
        or(isNull(notificationPreference.id), eq(col, true)),
        only ? inArray(member.userId, only) : undefined,
      ),
    );
  return rows;
}

const summary = (ctx: FeedbackContext): FeedbackSummary => ({
  projectName: ctx.payload.projectName,
  number: ctx.payload.number,
  kind: ctx.payload.kind,
  title: ctx.payload.title,
  body: ctx.payload.body,
  pageUrl: ctx.payload.pageUrl,
  reporterName: ctx.payload.reporterName,
  link: ctx.payload.url,
});

async function actorName(e: DomainEvent): Promise<string | null> {
  if (!e.actor.id || e.actor.kind === "guest") return null;
  const [u] = await getDb().select({ name: user.name }).from(user).where(eq(user.id, e.actor.id));
  return u?.name ?? null;
}

async function notify(
  e: DomainEvent,
  ctx: FeedbackContext,
  recipients: Recipient[],
  data: Record<string, unknown>,
  render: () => Promise<Rendered>,
) {
  const list = recipients.filter((r) => r.userId !== e.actor.id);
  if (!list.length) return;
  await getDb()
    .insert(notification)
    .values(
      list.map((r) => ({
        orgId: e.orgId,
        userId: r.userId,
        feedbackId: e.feedbackId,
        type: e.type,
        data: {
          projectId: ctx.payload.projectId,
          projectName: ctx.payload.projectName,
          number: ctx.payload.number,
          title: ctx.payload.title ?? ctx.payload.body.slice(0, 120),
          ...data,
        },
      })),
    );
  if (!list.some((r) => r.wantsEmail)) return;
  const rendered = await render();
  for (const r of list) if (r.wantsEmail) await enqueue(QUEUES.email, { to: r.email, ...rendered });
}

async function notifications(
  e: DomainEvent,
  ctx: FeedbackContext,
  commentInfo: Awaited<ReturnType<typeof loadCommentPayload>>,
) {
  const projectId = ctx.payload.projectId;
  const s = summary(ctx);
  const vars = feedbackVars(s);
  const by = await actorName(e);
  const reporterVars = {
    projectName: s.projectName,
    title: s.title?.trim() || excerpt(s.body, 80),
    pageUrl: vars.pageUrl ?? "",
  };

  if (e.type === "feedback.created") {
    const r = await membersWanting(e.orgId, projectId, "newFeedback");
    await notify(e, ctx, r, { actorName: ctx.payload.reporterName }, () =>
      renderEmail(e.orgId, "feedback_created", vars),
    );
    return;
  }

  if (e.type === "feedback.assigned") {
    const ch = e.changes?.assigneeIds;
    const before = new Set(Array.isArray(ch?.from) ? (ch.from as string[]) : []);
    const added = (Array.isArray(ch?.to) ? (ch.to as string[]) : []).filter((id) => !before.has(id));
    const r = await membersWanting(e.orgId, projectId, "assigned", added);
    await notify(e, ctx, r, { actorName: by }, () =>
      renderEmail(e.orgId, "feedback_assigned", { ...vars, assignerName: by ?? "Someone" }),
    );
    return;
  }

  if (e.type === "feedback.status_changed") {
    const to = String(e.changes?.status?.to ?? ctx.payload.status);
    const r = await membersWanting(e.orgId, projectId, "statusChanges", ctx.payload.assigneeIds);
    const actor = by ?? (e.actor.kind === "integration" ? "An issue tracker" : "Someone");
    await notify(e, ctx, r, { actorName: by, status: to }, () =>
      renderEmail(e.orgId, "status_changed", { ...vars, status: statusLabel(to), actorName: actor }),
    );
    // The reporter hears about team decisions only, not about their own resolve from the page.
    if (e.actor.kind !== "guest" && ctx.notifyReporter && ctx.reporterEmail) {
      await enqueue(QUEUES.email, {
        to: ctx.reporterEmail,
        ...(await renderEmail(e.orgId, "reporter_status", { ...reporterVars, status: statusLabel(to) })),
      });
    }
    return;
  }

  if (e.type === "comment.created" && commentInfo) {
    // Involved team: assignees plus team members who already commented.
    const commenters = await getDb()
      .selectDistinct({ id: comment.authorId })
      .from(comment)
      .where(and(eq(comment.feedbackId, e.feedbackId), sql`${comment.authorId} is not null`));
    const involved = [...new Set([...ctx.payload.assigneeIds, ...commenters.map((c) => c.id as string)])];
    // A visitor reply with nobody involved yet goes to everyone who wants replies.
    const scope = !commentInfo.team && involved.length === 0 ? undefined : involved;
    const r = await membersWanting(e.orgId, projectId, "replies", scope);
    await notify(e, ctx, r, { actorName: commentInfo.authorName, commentId: commentInfo.id }, () =>
      renderEmail(e.orgId, "comment_created", {
        ...vars,
        authorName: commentInfo.authorName ?? "A visitor",
        reply: excerpt(commentInfo.body),
      }),
    );
    if (commentInfo.team && commentInfo.visibility === "public" && ctx.notifyReporter && ctx.reporterEmail) {
      await enqueue(QUEUES.email, {
        to: ctx.reporterEmail,
        ...(await renderEmail(e.orgId, "reporter_reply", {
          ...reporterVars,
          authorName: commentInfo.authorName ?? "The team",
          reply: excerpt(commentInfo.body),
        })),
      });
    }
  }
}

async function webhooks(
  e: DomainEvent,
  ctx: FeedbackContext,
  commentInfo: Awaited<ReturnType<typeof loadCommentPayload>>,
) {
  const endpoints = await getDb()
    .select()
    .from(webhookEndpoint)
    .where(
      and(
        eq(webhookEndpoint.orgId, e.orgId),
        eq(webhookEndpoint.active, true),
        sql`${e.type} = any(${webhookEndpoint.events})`,
        or(isNull(webhookEndpoint.projectId), eq(webhookEndpoint.projectId, ctx.payload.projectId)),
      ),
    );
  if (!endpoints.length) return;
  const payload: WebhookPayload = {
    id: crypto.randomUUID(),
    event: e.type,
    apiVersion: WEBHOOK_API_VERSION,
    createdAt: e.at,
    data: {
      feedback: ctx.payload,
      ...(commentInfo ? { comment: withoutAuthorId(commentInfo) } : {}),
      ...(e.changes ? { changes: e.changes } : {}),
      actor: e.actor,
    },
  };
  for (const ep of endpoints) await queueDelivery(ep, { ...payload, id: crypto.randomUUID() });
}

function withoutAuthorId<T extends { authorId: unknown }>(c: T): Omit<T, "authorId"> {
  const { authorId: _drop, ...rest } = c;
  return rest;
}

/** `events.dispatch` handler. */
export async function dispatchEvent(e: DomainEvent): Promise<void> {
  const ctx = await loadFeedbackContext(e.feedbackId);
  if (!ctx || ctx.orgId !== e.orgId) return; // deleted since
  const commentInfo = e.commentId ? await loadCommentPayload(e.commentId) : null;
  if (e.type === "comment.created" && !commentInfo) return;
  // Integrations first: a broken mail setup must not hold back webhooks or issue sync. Issue sync
  // only queues jobs, which retry on their own.
  await webhooks(e, ctx, commentInfo);
  if (e.type === "feedback.created") await autoCreateIssues(ctx);
  if (e.type === "feedback.status_changed" && e.actor.kind !== "integration") {
    await syncIssueState(e.feedbackId, String(e.changes?.status?.to ?? ctx.payload.status));
  }
  await notifications(e, ctx, commentInfo);
}
