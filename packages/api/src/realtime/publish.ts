import { afterOrgCommit, comment, feedback, user, withOrg } from "@pinwren/db";
import { eq } from "drizzle-orm";
import type { DomainEvent } from "../events";
import { publish, type BusEvent } from "./bus";

// Domain events → stream events. Runs after the write, fire-and-forget (like the job queue), so a slow
// or failing broadcast never delays or fails the request.

export async function publishDomainEvent(e: Omit<DomainEvent, "at">): Promise<void> {
  if (
    e.type !== "feedback.created" &&
    e.type !== "feedback.updated" &&
    e.type !== "comment.created" &&
    e.type !== "comment.updated" &&
    e.type !== "comment.deleted"
  ) {
    return;
  }
  const message = await withOrg(e.orgId, async (db): Promise<BusEvent | undefined> => {
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
      return {
        ...base,
        event: "feedback.created",
        data: { ...f, createdAt: f.createdAt.toISOString() },
      };
    }
    if (e.type === "feedback.updated") {
      return {
        ...base,
        event: "feedback.updated",
        data: { id: f.id, projectId: f.projectId, changes: e.changes ?? {} },
      };
    }
    if (!e.commentId) return;
    if (e.type === "comment.updated" || e.type === "comment.deleted") {
      // Open details refetch the thread; a deleted comment's row is gone, so only ids travel.
      return {
        ...base,
        event: e.type,
        data: { id: e.commentId, feedbackId: f.id, projectId: f.projectId },
      };
    }
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
    return {
      ...base,
      event: "comment.created",
      data: {
        id: cm.id,
        feedbackId: f.id,
        projectId: f.projectId,
        visibility: cm.visibility,
        authorName: cm.authorName ?? cm.guest?.name ?? null,
      },
    };
  });
  if (message) await publish(message);
}

/**
 * The stream half of a delete. The `feedback.deleted` domain event fans out to notifications and webhooks
 * through the queue; the stream event goes out here at once.
 */
export function publishDeleted(orgId: string, projectId: string, id: string): void {
  afterOrgCommit(() =>
    publish({ t: "e", orgId, projectId, event: "feedback.deleted", data: { id, projectId } }),
  );
}

/** A restored item arrives in open inboxes as if it were new. */
export function publishRestored(
  orgId: string,
  f: Pick<
    typeof feedback.$inferSelect,
    "id" | "projectId" | "number" | "kind" | "status" | "priority" | "title" | "createdAt"
  >,
): void {
  afterOrgCommit(() =>
    publish({
      t: "e",
      orgId,
      projectId: f.projectId,
      event: "feedback.created",
      data: {
        id: f.id,
        projectId: f.projectId,
        number: f.number,
        kind: f.kind,
        status: f.status,
        priority: f.priority,
        title: f.title,
        createdAt: f.createdAt.toISOString(),
      },
    }),
  );
}
