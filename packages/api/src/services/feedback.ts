import {
  type FeedbackListQuery,
  type FeedbackUpdate,
  isClosedStatus,
  parseWidgetConfig,
  panelActionsFor,
} from "@pinwren/core";
import {
  activity,
  comment,
  diagnostics,
  feedback,
  feedbackAsset,
  getDb,
  issueIntegration,
  issueLink,
  member,
  page,
  project,
  user,
} from "@pinwren/db";
import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { ApiError, notFound } from "../errors";
import { emit, updateEvents } from "../events";
import { assertRoundFor } from "./rounds";

export const ACTIVE_STATUSES = ["open", "in_progress", "in_review"] as const;

export type Actor = { kind: "user" | "api"; userId: string };

export async function listFeedback(orgId: string, q: FeedbackListQuery) {
  const where = [eq(feedback.orgId, orgId), isNull(feedback.deletedAt)];
  if (q.projectId) where.push(eq(feedback.projectId, q.projectId));
  if (q.status === "active") where.push(inArray(feedback.status, [...ACTIVE_STATUSES]));
  else if (q.status !== "all") where.push(eq(feedback.status, q.status));
  if (q.kind) where.push(eq(feedback.kind, q.kind));
  if (q.priority) where.push(eq(feedback.priority, q.priority));
  if (q.roundId) where.push(eq(feedback.roundId, q.roundId));
  if (q.assigneeId) where.push(sql`${q.assigneeId} = any(${feedback.assigneeIds})`);
  if (q.since) where.push(gte(feedback.createdAt, new Date(q.since)));
  if (q.page) where.push(sql`strpos(${page.url}, ${q.page}) > 0`);
  if (q.q) where.push(sql`${feedback.search} @@ plainto_tsquery('simple', ${q.q})`);
  if (q.cursor) {
    const at = new Date(q.cursor);
    if (Number.isNaN(at.getTime())) throw new ApiError(400, "INVALID_CURSOR", "Invalid cursor");
    where.push(lt(feedback.createdAt, at));
  }

  const rows = await getDb()
    .select({
      id: feedback.id,
      number: feedback.number,
      kind: feedback.kind,
      status: feedback.status,
      priority: feedback.priority,
      title: feedback.title,
      body: feedback.body,
      assigneeIds: feedback.assigneeIds,
      reporterGuest: feedback.reporterGuest,
      createdAt: feedback.createdAt,
      projectId: feedback.projectId,
      projectName: project.name,
      pageUrl: page.url,
      roundId: feedback.roundId,
      hasReplay: sql<boolean>`exists(select 1 from ${feedbackAsset} a where a.feedback_id = ${feedback.id} and a.kind = 'replay')`,
      hasScreenshot: sql<boolean>`exists(select 1 from ${feedbackAsset} a where a.feedback_id = ${feedback.id} and a.kind in ('screenshot', 'screenshot_annotated'))`,
      attachmentCount: sql<number>`(select count(*)::int from ${feedbackAsset} a where a.feedback_id = ${feedback.id} and a.kind = 'attachment')`,
      commentCount: sql<number>`(select count(*)::int from ${comment} cm where cm.feedback_id = ${feedback.id})`,
    })
    .from(feedback)
    .innerJoin(project, eq(project.id, feedback.projectId))
    .leftJoin(page, eq(page.id, feedback.pageId))
    .where(and(...where))
    .orderBy(desc(feedback.createdAt))
    .limit(q.limit + 1);

  const hasMore = rows.length > q.limit;
  const items = hasMore ? rows.slice(0, q.limit) : rows;
  const last = items.at(-1);
  return { items, nextCursor: hasMore && last ? last.createdAt.toISOString() : null };
}

export async function getFeedbackDetail(
  orgId: string,
  id: string,
  audience: "admin" | "member" | "viewer" = "member",
) {
  const db = getDb();
  const [row] = await db
    .select({
      f: feedback,
      projectName: project.name,
      projectSlug: project.slug,
      widgetConfig: project.widgetConfig,
      pageUrl: page.url,
      pageTitle: page.title,
    })
    .from(feedback)
    .innerJoin(project, eq(project.id, feedback.projectId))
    .leftJoin(page, eq(page.id, feedback.pageId))
    .where(and(eq(feedback.id, id), eq(feedback.orgId, orgId), isNull(feedback.deletedAt)));
  if (!row) throw notFound("Feedback");

  const [assets, comments, events, diag, assignees, issues, trackers] = await Promise.all([
    db
      .select({
        id: feedbackAsset.id,
        kind: feedbackAsset.kind,
        contentType: feedbackAsset.contentType,
        bytes: feedbackAsset.bytes,
        name: feedbackAsset.name,
        meta: feedbackAsset.meta,
      })
      .from(feedbackAsset)
      .where(eq(feedbackAsset.feedbackId, id))
      .orderBy(asc(feedbackAsset.createdAt)),
    db
      .select({
        id: comment.id,
        body: comment.body,
        visibility: comment.visibility,
        createdAt: comment.createdAt,
        editedAt: comment.editedAt,
        authorGuest: comment.authorGuest,
        author: { id: user.id, name: user.name, image: user.image },
      })
      .from(comment)
      .leftJoin(user, eq(user.id, comment.authorId))
      .where(eq(comment.feedbackId, id))
      .orderBy(asc(comment.createdAt)),
    db
      .select({
        id: activity.id,
        type: activity.type,
        data: activity.data,
        createdAt: activity.createdAt,
        actorKind: activity.actorKind,
        actorName: user.name,
      })
      .from(activity)
      .leftJoin(user, eq(user.id, activity.actorId))
      .where(eq(activity.feedbackId, id))
      .orderBy(asc(activity.createdAt)),
    db.select().from(diagnostics).where(eq(diagnostics.feedbackId, id)),
    userNames(row.f.assigneeIds),
    db
      .select({
        id: issueLink.id,
        integrationId: issueLink.integrationId,
        provider: issueLink.provider,
        number: issueLink.number,
        url: issueLink.url,
        state: issueLink.state,
      })
      .from(issueLink)
      .where(eq(issueLink.feedbackId, id))
      .orderBy(asc(issueLink.createdAt)),
    // Trackers the item can be sent to ("Send to GitHub/GitLab"); never the token.
    db
      .select({ id: issueIntegration.id, provider: issueIntegration.provider, repo: issueIntegration.repo })
      .from(issueIntegration)
      .where(and(eq(issueIntegration.projectId, row.f.projectId), eq(issueIntegration.active, true)))
      .orderBy(asc(issueIntegration.provider)),
  ]);

  // Activity rows store user ids for assignee changes; resolve names so the timeline can read them.
  const ids = new Set<string>();
  for (const e of events) {
    if (e.type !== "assigneeIds_changed") continue;
    for (const k of ["from", "to"] as const) {
      const v = e.data[k];
      if (Array.isArray(v)) for (const x of v) if (typeof x === "string") ids.add(x);
    }
  }
  const names = new Map((await userNames([...ids])).map((u) => [u.id, u.name]));
  const activityOut = events.map((e) => {
    if (e.type !== "assigneeIds_changed") return e;
    const named = (v: unknown) =>
      Array.isArray(v) ? v.map((x) => ({ id: String(x), name: names.get(String(x)) ?? null })) : [];
    return { ...e, data: { ...e.data, fromUsers: named(e.data.from), toUsers: named(e.data.to) } };
  });

  const { reporterTokenHash: _hidden, ...f } = row.f;
  return {
    feedback: {
      ...f,
      projectName: row.projectName,
      projectSlug: row.projectSlug,
      pageUrl: row.pageUrl,
      pageTitle: row.pageTitle,
    },
    // Team-only actions included (wave-3 contract §1), but no webhook URL, and nothing team-only for
    // viewers (ADR 0021).
    panelActions: panelActionsFor(parseWidgetConfig(row.widgetConfig).panelActions, audience, "detail"),
    issues,
    integrations: trackers,
    assignees,
    assets,
    comments,
    activity: activityOut,
    diagnostics: diag[0] ?? null,
  };
}

async function userNames(ids: string[]) {
  if (!ids.length) return [];
  return getDb()
    .select({ id: user.id, name: user.name, email: user.email, image: user.image })
    .from(user)
    .where(inArray(user.id, ids));
}

export async function updateFeedback(orgId: string, actor: Actor, id: string, patch: FeedbackUpdate) {
  const db = getDb();
  if (patch.assigneeIds?.length) {
    const unique = [...new Set(patch.assigneeIds)];
    const found = await db
      .select({ id: member.userId })
      .from(member)
      .where(and(eq(member.organizationId, orgId), inArray(member.userId, unique)));
    if (found.length !== unique.length) {
      throw new ApiError(400, "INVALID_ASSIGNEE", "Assignees must be members of this organisation");
    }
    patch = { ...patch, assigneeIds: unique };
  }
  const { before, after } = await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(feedback)
      .where(and(eq(feedback.id, id), eq(feedback.orgId, orgId), isNull(feedback.deletedAt)))
      .for("update");
    if (!before) throw notFound("Feedback");
    if (patch.roundId) await assertRoundFor(orgId, before.projectId, patch.roundId);

    const set: Partial<typeof feedback.$inferInsert> = { ...patch };
    if (patch.status && patch.status !== before.status) {
      set.resolvedAt = isClosedStatus(patch.status) ? new Date() : null;
    }
    const [after] = await tx.update(feedback).set(set).where(eq(feedback.id, id)).returning();

    const changes = Object.entries(patch).filter(
      ([k, v]) => JSON.stringify(before[k as keyof typeof before]) !== JSON.stringify(v),
    );
    if (changes.length) {
      await tx.insert(activity).values(
        changes.map(([field, to]) => ({
          orgId,
          feedbackId: id,
          actorId: actor.userId,
          // A token acts as its owner; the timeline shows the person either way.
          actorKind: "user",
          type: `${field}_changed`,
          data: {
            from: before[field as keyof typeof before] ?? null,
            to,
            ...(actor.kind === "api" ? { via: "api" } : {}),
          },
        })),
      );
    }
    return { before, after };
  });
  if (!after) throw notFound("Feedback");
  emit(
    ...updateEvents(
      { orgId, feedbackId: id, actor: { kind: actor.kind, id: actor.userId } },
      before,
      after,
      Object.keys(patch),
    ),
  );
  const { reporterTokenHash: _hidden, ...out } = after;
  return out;
}

export async function addTeamComment(
  orgId: string,
  actor: Actor,
  feedbackId: string,
  body: { body: string; visibility: "public" | "internal" },
) {
  const db = getDb();
  const [f] = await db
    .select({ id: feedback.id })
    .from(feedback)
    .where(and(eq(feedback.id, feedbackId), eq(feedback.orgId, orgId), isNull(feedback.deletedAt)));
  if (!f) throw notFound("Feedback");
  const [created] = await db
    .insert(comment)
    .values({ orgId, feedbackId, authorId: actor.userId, ...body })
    .returning();
  if (!created) throw new Error("comment insert failed");
  emit({
    type: "comment.created",
    orgId,
    feedbackId,
    commentId: created.id,
    actor: { kind: actor.kind, id: actor.userId },
  });
  return created;
}
