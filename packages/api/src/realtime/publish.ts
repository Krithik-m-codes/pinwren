import { comment, feedback, getDb, user } from "@pinwren/db";
import { eq } from "drizzle-orm";
import type { DomainEvent } from "../events";
import { publish } from "./bus";

// Domain events → stream events. Runs after the write, fire-and-forget (like the job queue), so a slow
// or failing broadcast never delays or fails the request.

export async function publishDomainEvent(e: Omit<DomainEvent, "at">): Promise<void> {
  if (e.type !== "feedback.created" && e.type !== "feedback.updated" && e.type !== "comment.created") return;
  const db = getDb();
  const [f] = await db
    .select({
      id: feedback.id,
      projectId: feedback.projectId,
      number: feedback.number,
      kind: feedback.kind,
      status: feedback.status,
      priority: feedback.priority,
      title: feedback.title,
      createdAt: feedback.createdAt,
    })
    .from(feedback)
    .where(eq(feedback.id, e.feedbackId));
  if (!f) return;
  const base = { t: "e" as const, orgId: e.orgId, projectId: f.projectId };

  if (e.type === "feedback.created") {
    await publish({
      ...base,
      event: "feedback.created",
      data: { ...f, createdAt: f.createdAt.toISOString() },
    });
    return;
  }
  if (e.type === "feedback.updated") {
    await publish({
      ...base,
      event: "feedback.updated",
      data: { id: f.id, projectId: f.projectId, changes: e.changes ?? {} },
    });
    return;
  }
  if (!e.commentId) return;
  const [cm] = await db
    .select({
      id: comment.id,
      visibility: comment.visibility,
      authorName: user.name,
      guest: comment.authorGuest,
    })
    .from(comment)
    .leftJoin(user, eq(user.id, comment.authorId))
    .where(eq(comment.id, e.commentId));
  if (!cm) return;
  await publish({
    ...base,
    event: "comment.created",
    data: {
      id: cm.id,
      feedbackId: f.id,
      projectId: f.projectId,
      visibility: cm.visibility,
      authorName: cm.authorName ?? cm.guest?.name ?? null,
    },
  });
}

/** `feedback.deleted` has no domain event (nothing is notified), so routes call this directly. */
export function publishDeleted(orgId: string, projectId: string, id: string): void {
  void publish({ t: "e", orgId, projectId, event: "feedback.deleted", data: { id, projectId } });
}
