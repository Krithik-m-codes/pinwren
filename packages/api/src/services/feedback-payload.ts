import { comment, feedback, getDb, page, project, type ReporterGuest, user } from "@annota/db";
import { eq } from "drizzle-orm";
import { env } from "../env";
import type { CommentPayload, FeedbackPayload } from "../webhooks/format";

export const feedbackLink = (id: string) =>
  `${env().ANNOTA_URL.replace(/\/$/, "")}/inbox?status=all&item=${encodeURIComponent(id)}`;

export type FeedbackContext = {
  payload: FeedbackPayload;
  orgId: string;
  reporterEmail: string | null;
  notifyReporter: boolean;
};

/** Load one feedback item as the shape used by webhooks, notifications and emails. */
export async function loadFeedbackContext(feedbackId: string): Promise<FeedbackContext | null> {
  const [row] = await getDb()
    .select({
      f: feedback,
      projectName: project.name,
      notifyReporter: project.notifyReporter,
      pageUrl: page.url,
    })
    .from(feedback)
    .innerJoin(project, eq(project.id, feedback.projectId))
    .leftJoin(page, eq(page.id, feedback.pageId))
    .where(eq(feedback.id, feedbackId));
  if (!row) return null;
  const f = row.f;
  const guest = (f.reporterGuest ?? null) as ReporterGuest | null;
  let reporterName = guest?.name ?? null;
  let reporterEmail = guest?.email ?? null;
  if (f.reporterId) {
    const [u] = await getDb()
      .select({ name: user.name, email: user.email })
      .from(user)
      .where(eq(user.id, f.reporterId));
    reporterName ??= u?.name ?? null;
    reporterEmail ??= u?.email ?? null;
  }
  return {
    orgId: f.orgId,
    reporterEmail,
    notifyReporter: row.notifyReporter,
    payload: {
      id: f.id,
      number: f.number,
      projectId: f.projectId,
      projectName: row.projectName,
      kind: f.kind,
      status: f.status,
      priority: f.priority,
      title: f.title,
      body: f.body.length > 4000 ? `${f.body.slice(0, 3999)}…` : f.body,
      pageUrl: row.pageUrl,
      reporterName,
      assigneeIds: f.assigneeIds,
      createdAt: f.createdAt.toISOString(),
      updatedAt: f.updatedAt.toISOString(),
      url: feedbackLink(f.id),
    },
  };
}

export async function loadCommentPayload(
  commentId: string,
): Promise<(CommentPayload & { authorId: string | null }) | null> {
  const [row] = await getDb()
    .select({ c: comment, authorName: user.name })
    .from(comment)
    .leftJoin(user, eq(user.id, comment.authorId))
    .where(eq(comment.id, commentId));
  if (!row) return null;
  const c = row.c;
  return {
    id: c.id,
    body: c.body,
    visibility: c.visibility,
    authorName: row.authorName ?? (c.authorGuest as ReporterGuest | null)?.name ?? null,
    team: c.authorId !== null,
    createdAt: c.createdAt.toISOString(),
    authorId: c.authorId,
  };
}
