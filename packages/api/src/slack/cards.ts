import { feedbackLabel, getDb, label, user, withOrg } from "@pinwren/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import { loadFeedbackContext } from "../services/feedback-payload";
import { feedbackCard } from "./blocks";

/**
 * The current card for an item: its fields, assignee and label names, and the project's labels for the
 * "Add label" menu. Null when the item is gone or belongs to another organisation.
 */
export async function buildCard(orgId: string, feedbackId: string) {
  return withOrg(orgId, async () => {
    const ctx = await loadFeedbackContext(feedbackId);
    if (ctx?.orgId !== orgId) return null;
    const db = getDb();
    const [assignees, labelNames, projectLabels] = await Promise.all([
      ctx.payload.assigneeIds.length
        ? db
            .select({ id: user.id, name: user.name })
            .from(user)
            .where(inArray(user.id, ctx.payload.assigneeIds))
        : Promise.resolve([]),
      db
        .select({ name: label.name })
        .from(feedbackLabel)
        .innerJoin(label, eq(label.id, feedbackLabel.labelId))
        .where(eq(feedbackLabel.feedbackId, feedbackId))
        .orderBy(asc(label.name)),
      db
        .select({ id: label.id, name: label.name })
        .from(label)
        .where(and(eq(label.projectId, ctx.payload.projectId), eq(label.orgId, orgId)))
        .orderBy(asc(label.name))
        .limit(100),
    ]);
    return {
      projectId: ctx.payload.projectId,
      /** The card with its first line: "New feedback" on a first post, "Feedback" when it is refreshed. */
      card: (headline: string) =>
        feedbackCard({
          feedback: ctx.payload,
          headline,
          assigneeNames: assignees.map((a) => a.name),
          labelNames: labelNames.map((l) => l.name),
          projectLabels,
          readOnly: ctx.deletedAt !== null,
        }),
    };
  });
}
