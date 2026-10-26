import { comment, getDb, user, webhookEndpoint } from "@pinwren/db";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { emailImageUrl, teamUnsubscribeUrl } from "../email/links";
import { renderEmail, reporterEmail } from "../email/render";
import { excerpt, type FeedbackSummary, feedbackVars, statusLabel } from "../email/templates";
import { unsubscribeHeaders } from "../email/unsubscribe";
import type { DomainEvent } from "../events";
import { autoCreateIssues, syncIssueState } from "../integrations/issues";
import {
  type FeedbackContext,
  type FeedbackFacts,
  loadCommentPayload,
  loadFeedbackContext,
  loadFeedbackFacts,
} from "../services/feedback-payload";
import { enqueue, QUEUES } from "./boss";
import { addWatchers, watcherIds } from "../services/watchers";
import { queueDelivery } from "../webhooks/deliver";
import { WEBHOOK_API_VERSION, type WebhookPayload } from "../webhooks/format";
import { enqueueOnce, membersWanting, notify, teamRenderOptions } from "./notify";
import { reporterThreadUrl } from "./thread-url";

// Fan-out of one domain event (wave-5 contract §3.2, BugPin dispatch rules): webhooks and issue sync
// first, then the bell, team emails and reporter emails.
//
// - feedback.created → the project's team recipients (Notifications › General: chosen members or all,
//   each filtered by their own preferences) plus its extra addresses; the reporter's acknowledgement.
// - assigned → the newly assigned; status / priority / delete / replies → assignees plus followers.
// - comment @mentions → a `comment.mentioned` notification instead of the plain reply one.
// - Reporter emails go to the reporter's address only while the project's master switch and the matching
//   Notifications › Reporter switch are on, and never for something the reporter did themselves.

type Ctx = FeedbackContext;
type CommentInfo = Awaited<ReturnType<typeof loadCommentPayload>>;

/** The status a `feedback.status_changed` event moved to (the item's current status if the event lacks it). */
function newStatus(e: DomainEvent, ctx: Ctx): string {
  const to = e.changes?.status?.to;
  return typeof to === "string" ? to : ctx.payload.status;
}

const summary = (ctx: Ctx, facts?: FeedbackFacts): FeedbackSummary => ({
  projectName: ctx.payload.projectName,
  number: ctx.payload.number,
  kind: ctx.payload.kind,
  title: ctx.payload.title,
  body: ctx.payload.body,
  pageUrl: ctx.payload.pageUrl,
  reporterName: ctx.payload.reporterName,
  reviewLink: ctx.payload.reviewLink ?? null,
  link: ctx.payload.url,
  priority: ctx.payload.priority,
  ...(facts
    ? {
        browser: facts.browser,
        os: facts.os,
        consoleErrors: facts.consoleErrors,
        failedRequests: facts.failedRequests,
        hasReplay: facts.hasReplay,
        screenshotUrl: facts.screenshotAssetId ? emailImageUrl(facts.screenshotAssetId) : null,
      }
    : {}),
});

async function actorName(e: DomainEvent): Promise<string | null> {
  if (!e.actor.id || e.actor.kind === "guest") return null;
  const [u] = await getDb().select({ name: user.name }).from(user).where(eq(user.id, e.actor.id));
  return u?.name ?? null;
}

async function userNames(ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const rows = await getDb().select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, ids));
  return ids.flatMap((id) => rows.find((r) => r.id === id)?.name ?? []);
}

/** What a bell row shows: project, number, kind, title, plus the event's own fields. */
const rowData = (ctx: Ctx, extra: Record<string, unknown>) => ({
  projectId: ctx.payload.projectId,
  projectName: ctx.payload.projectName,
  number: ctx.payload.number,
  kind: ctx.payload.kind,
  title: ctx.payload.title ?? ctx.payload.body.slice(0, 120),
  ...extra,
});

/** Assignees plus followers: who status, priority, reply and delete notifications are for. */
async function involved(ctx: Ctx): Promise<string[]> {
  return [...new Set([...ctx.payload.assigneeIds, ...(await watcherIds(ctx.payload.id))])];
}

/** The reporter's address, when this kind of reporter email is on for the project. */
function reporterTo(e: DomainEvent, ctx: Ctx, switchOn: boolean): string | null {
  if (!ctx.notifyReporter || !switchOn || !ctx.reporterEmail) return null;
  // Nothing about the reporter's own actions (e.g. resolving their pin from the page).
  if (e.actor.kind === "guest") return null;
  if (ctx.reporterId && e.actor.id === ctx.reporterId) return null;
  return ctx.reporterEmail;
}

async function sendReporter(
  e: DomainEvent,
  ctx: Ctx,
  to: string,
  key: Parameters<typeof reporterEmail>[2],
  vars: Record<string, string>,
) {
  const base = {
    projectName: ctx.payload.projectName,
    title: ctx.payload.title?.trim() || excerpt(ctx.payload.body, 80),
    pageUrl: feedbackVars(summary(ctx)).pageUrl ?? "",
    threadUrl: reporterThreadUrl(ctx.payload.id, ctx.payload.pageUrl),
  };
  await enqueueOnce(
    e.id ? `${e.id}:reporter:${key}` : null,
    await reporterEmail(e.orgId, to, key, { ...base, ...vars }),
  );
}

async function onCreated(e: DomainEvent, ctx: Ctx) {
  // The reporter follows their own report when they are a member (signed-in widget, dashboard).
  if (ctx.reporterId) await addWatchers(e.orgId, ctx.payload.id, [ctx.reporterId]);
  const vars = feedbackVars(summary(ctx, await loadFeedbackFacts(ctx.payload.id)));
  const recipients = await membersWanting(
    e.orgId,
    ctx.payload.projectId,
    "newFeedback",
    ctx.notify.memberIds ?? undefined,
  );
  await notify({
    orgId: e.orgId,
    eventId: e.id ?? null,
    type: "feedback.created",
    feedbackId: ctx.payload.id,
    actorId: e.actor.id,
    projectId: ctx.payload.projectId,
    recipients,
    data: rowData(ctx, { actorName: ctx.payload.reporterName }),
    render: () => renderEmail(e.orgId, "feedback_created", vars, teamRenderOptions()),
  });

  // Extra addresses (Notifications › General): no account, no preferences; each email carries its own
  // one-click unsubscribe that removes the address from the project.
  const memberEmails = new Set(recipients.map((r) => r.email.toLowerCase()));
  for (const address of ctx.notify.emails) {
    if (memberEmails.has(address.toLowerCase())) continue;
    const unsub = teamUnsubscribeUrl({ kind: "address", email: address, projectId: ctx.payload.projectId });
    const rendered = await renderEmail(e.orgId, "feedback_created", vars, { unsubscribeUrl: unsub });
    await enqueueOnce(e.id ? `${e.id}:extra:${address.toLowerCase()}` : null, {
      to: address,
      ...rendered,
      headers: unsubscribeHeaders(unsub),
    });
  }

  // "We received your report": for reports sent from the widget, not ones the team filed.
  const ack =
    e.actor.kind === "guest" && !ctx.reporterId && ctx.notifyReporter && ctx.notify.reporterReceived;
  if (ack && ctx.reporterEmail) await sendReporter(e, ctx, ctx.reporterEmail, "reporter_received", {});
}

async function onAssigned(e: DomainEvent, ctx: Ctx, by: string | null) {
  const ch = e.changes?.assigneeIds;
  const before = new Set(Array.isArray(ch?.from) ? (ch.from as string[]) : []);
  const after = Array.isArray(ch?.to) ? (ch.to as string[]) : ctx.payload.assigneeIds;
  const added = after.filter((id) => !before.has(id));
  if (!added.length) return;
  await addWatchers(e.orgId, ctx.payload.id, added);
  const vars = feedbackVars(summary(ctx, await loadFeedbackFacts(ctx.payload.id)));
  await notify({
    orgId: e.orgId,
    eventId: e.id ?? null,
    type: "feedback.assigned",
    feedbackId: ctx.payload.id,
    actorId: e.actor.id,
    projectId: ctx.payload.projectId,
    recipients: await membersWanting(e.orgId, ctx.payload.projectId, "assigned", added),
    data: rowData(ctx, { actorName: by }),
    render: () =>
      renderEmail(
        e.orgId,
        "feedback_assigned",
        { ...vars, assignerName: by ?? "Someone" },
        teamRenderOptions(),
      ),
  });
  const to = reporterTo(e, ctx, ctx.notify.reporterAssigned);
  if (to) {
    const names = await userNames(added);
    await sendReporter(e, ctx, to, "reporter_assigned", {
      assigneeName: names.join(", ") || "Someone on the team",
    });
  }
}

async function onStatus(e: DomainEvent, ctx: Ctx, by: string | null) {
  const to = newStatus(e, ctx);
  const people = await involved(ctx);
  // A visitor resolving or reopening an item nobody is involved in still reaches the team.
  const scope = people.length === 0 && e.actor.kind === "guest" ? undefined : people;
  const guest = e.actor.kind === "guest";
  const actor = by ?? (e.actor.kind === "integration" ? "An issue tracker" : guest ? "A visitor" : "Someone");
  const vars = feedbackVars(summary(ctx));
  await notify({
    orgId: e.orgId,
    eventId: e.id ?? null,
    type: "feedback.status_changed",
    feedbackId: ctx.payload.id,
    actorId: e.actor.id,
    projectId: ctx.payload.projectId,
    recipients: await membersWanting(e.orgId, ctx.payload.projectId, "statusChanges", scope),
    data: rowData(ctx, { actorName: by ?? (guest ? ctx.payload.reporterName : null), status: to }),
    render: () =>
      renderEmail(
        e.orgId,
        "status_changed",
        { ...vars, status: statusLabel(to), actorName: actor },
        teamRenderOptions(),
      ),
  });
  const reporter = reporterTo(e, ctx, ctx.notify.reporterStatus);
  if (reporter) await sendReporter(e, ctx, reporter, "reporter_status", { status: statusLabel(to) });
}

async function onPriority(e: DomainEvent, ctx: Ctx, by: string | null) {
  const ch = e.changes?.priority;
  const to = typeof ch?.to === "string" ? ch.to : ctx.payload.priority;
  const from = typeof ch?.from === "string" ? ch.from : "none";
  const label = (p: string) => (p === "none" ? "no priority" : p);
  const vars = feedbackVars(summary(ctx));
  await notify({
    orgId: e.orgId,
    eventId: e.id ?? null,
    type: "feedback.priority_changed",
    feedbackId: ctx.payload.id,
    actorId: e.actor.id,
    projectId: ctx.payload.projectId,
    recipients: await membersWanting(e.orgId, ctx.payload.projectId, "priorityChanges", await involved(ctx)),
    data: rowData(ctx, { actorName: by, priority: to, previousPriority: from }),
    render: () =>
      renderEmail(
        e.orgId,
        "priority_changed",
        { ...vars, priority: label(to), previousPriority: label(from), actorName: by ?? "Someone" },
        teamRenderOptions(),
      ),
  });
  const reporter = reporterTo(e, ctx, ctx.notify.reporterPriority);
  if (reporter && to !== "none") await sendReporter(e, ctx, reporter, "reporter_priority", { priority: to });
}

async function onDeleted(e: DomainEvent, ctx: Ctx, by: string | null) {
  const vars = feedbackVars(summary(ctx));
  await notify({
    orgId: e.orgId,
    eventId: e.id ?? null,
    type: "feedback.deleted",
    feedbackId: ctx.payload.id,
    actorId: e.actor.id,
    projectId: ctx.payload.projectId,
    // Deleting changes an item's state like a status change: the same switch governs it.
    recipients: await membersWanting(e.orgId, ctx.payload.projectId, "statusChanges", await involved(ctx)),
    data: rowData(ctx, { actorName: by }),
    render: () =>
      renderEmail(e.orgId, "feedback_deleted", { ...vars, actorName: by ?? "Someone" }, teamRenderOptions()),
  });
}

async function onComment(e: DomainEvent, ctx: Ctx, c: NonNullable<CommentInfo>) {
  const [row] = await getDb()
    .select({ mentions: comment.mentions })
    .from(comment)
    .where(eq(comment.id, c.id));
  const mentioned = c.team ? [...new Set(row?.mentions ?? [])].filter((id) => id !== c.authorId) : [];
  await addWatchers(e.orgId, ctx.payload.id, [...(c.authorId ? [c.authorId] : []), ...mentioned]);
  const vars = feedbackVars(summary(ctx));
  const data = rowData(ctx, { actorName: c.authorName, commentId: c.id });
  const reply = excerpt(c.body);

  if (mentioned.length) {
    await notify({
      orgId: e.orgId,
      eventId: e.id ?? null,
      type: "comment.mentioned",
      feedbackId: ctx.payload.id,
      actorId: e.actor.id,
      projectId: ctx.payload.projectId,
      recipients: await membersWanting(e.orgId, ctx.payload.projectId, "mentioned", mentioned),
      data,
      render: () =>
        renderEmail(
          e.orgId,
          "mentioned",
          { ...vars, authorName: c.authorName ?? "Someone", comment: reply },
          teamRenderOptions(),
        ),
    });
  }

  // Involved: assignees, followers and team members who already commented — minus the @mentioned, who
  // got their own notification (or switched mentions off, which also covers this reply).
  const commenters = await getDb()
    .selectDistinct({ id: comment.authorId })
    .from(comment)
    .where(and(eq(comment.feedbackId, ctx.payload.id), sql`${comment.authorId} is not null`));
  const skip = new Set(mentioned);
  const people = [
    ...new Set([...(await involved(ctx)), ...commenters.flatMap((x) => (x.id ? [x.id] : []))]),
  ].filter((id) => !skip.has(id));
  // A visitor reply with nobody involved yet goes to everyone who wants replies.
  const scope = !c.team && people.length === 0 ? undefined : people;
  if (scope === undefined || scope.length) {
    const recipients = await membersWanting(e.orgId, ctx.payload.projectId, "replies", scope);
    await notify({
      orgId: e.orgId,
      eventId: e.id ?? null,
      type: "comment.created",
      feedbackId: ctx.payload.id,
      actorId: e.actor.id,
      projectId: ctx.payload.projectId,
      recipients: recipients.filter((r) => !skip.has(r.userId)),
      data,
      render: () =>
        renderEmail(
          e.orgId,
          "comment_created",
          { ...vars, authorName: c.authorName ?? "A visitor", reply },
          teamRenderOptions(),
        ),
    });
  }

  // Public team replies always reach the reporter while the project's reporter emails are on.
  const reporter = c.team && c.visibility === "public" ? reporterTo(e, ctx, true) : null;
  if (reporter) {
    await sendReporter(e, ctx, reporter, "reporter_reply", {
      authorName: c.authorName ?? "The team",
      reply,
    });
  }
}

async function notifications(e: DomainEvent, ctx: Ctx, commentInfo: CommentInfo) {
  // Something that happens to an item in the trash interests nobody, except the deletion itself.
  if (ctx.deletedAt && e.type !== "feedback.deleted") return;
  const by = await actorName(e);
  switch (e.type) {
    case "feedback.created":
      return onCreated(e, ctx);
    case "feedback.assigned":
      return onAssigned(e, ctx, by);
    case "feedback.status_changed":
      return onStatus(e, ctx, by);
    case "feedback.priority_changed":
      return onPriority(e, ctx, by);
    case "feedback.deleted":
      return onDeleted(e, ctx, by);
    case "comment.created":
      if (commentInfo) await onComment(e, ctx, commentInfo);
      return;
    default:
  }
}

async function webhooks(e: DomainEvent, ctx: Ctx, commentInfo: CommentInfo) {
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
    // The domain event id: receivers can dedupe on it (one id per event, shared by every endpoint).
    id: e.id ?? crypto.randomUUID(),
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
  for (const ep of endpoints) await queueDelivery(ep, payload, e.id);
}

function withoutAuthorId<T extends { authorId: unknown }>(c: T): Omit<T, "authorId"> {
  const { authorId: _drop, ...rest } = c;
  return rest;
}

/** `events.dispatch` handler. */
export async function dispatchEvent(e: DomainEvent): Promise<void> {
  // Loads items in the trash too: `feedback.deleted` is about one.
  const ctx = await loadFeedbackContext(e.feedbackId);
  if (ctx?.orgId !== e.orgId) return; // purged since
  const commentInfo = e.commentId ? await loadCommentPayload(e.commentId) : null;
  if (e.type === "comment.created" && !commentInfo) return;
  // Integrations first: a broken mail setup must not hold back webhooks or issue sync. Issue sync
  // only queues jobs, which retry on their own.
  await webhooks(e, ctx, commentInfo);
  if (e.type === "feedback.created") await autoCreateIssues(ctx);
  if (e.type === "feedback.status_changed" && e.actor.kind !== "integration") {
    await syncIssueState(e.feedbackId, newStatus(e, ctx));
  }
  await notifications(e, ctx, commentInfo);
  // Last, so enrichment can never hold back the bell or the emails; once per item if this event is retried.
  if (e.type === "feedback.created") {
    await enqueue(
      QUEUES.aiEnrich,
      { feedbackId: e.feedbackId, orgId: e.orgId, projectId: ctx.payload.projectId },
      { singletonKey: `ai:${e.feedbackId}`, singletonSeconds: 3600 },
    );
  }
}
