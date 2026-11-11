import { type FeedbackKind } from "@pinwren/core";
import { activity, feedback, project, withOrg } from "@pinwren/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { ApiError } from "../errors";
import { emit } from "../events";

// Feedback filed from Slack (the message shortcut, `/pinwren new`): written like a team member's manual
// report, attributed to the mapped Pinwren member, with the Slack message's permalink on the item.

export type SlackCaptureInput = {
  projectId: string;
  kind: FeedbackKind;
  title: string | null;
  body: string;
  /** Slack's view id: makes a double submit a no-op (the unique `(project, client_id)` index). */
  viewId: string;
  permalink: string | null;
};

/** A stable uuid from the Slack view id, so one submitted form creates at most one item. */
export function clientIdFor(viewId: string): string {
  const h = createHash("sha256").update(`slack-view:${viewId}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export async function createFeedbackFromSlack(
  orgId: string,
  userId: string,
  input: SlackCaptureInput,
): Promise<{ id: string; number: number; duplicate: boolean }> {
  const clientId = clientIdFor(input.viewId);
  const body = input.permalink ? `${input.body}\n\nSlack message: ${input.permalink}`.trim() : input.body;
  const created = await withOrg(orgId, async (db) => {
    const [p] = await db
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.id, input.projectId), eq(project.orgId, orgId), isNull(project.archivedAt)));
    if (!p) throw new ApiError(404, "NOT_FOUND", "Project not found");
    const [existing] = await db
      .select({ id: feedback.id, number: feedback.number })
      .from(feedback)
      .where(and(eq(feedback.projectId, p.id), eq(feedback.clientId, clientId)));
    if (existing) return { ...existing, duplicate: true };
    const metadata = input.permalink ? JSON.stringify({ slack: input.permalink }) : null;
    // The counter, the item and its timeline row in one statement, like the widget's ingest.
    const rows = await db.execute<{ id: string; number: number }>(sql`
      with counter as (
        update ${project} set feedback_counter = feedback_counter + 1
        where id = ${p.id} and org_id = ${orgId}
        returning feedback_counter as n
      ), f as (
        insert into ${feedback}
          (org_id, project_id, number, kind, title, body, client_id, reporter_id, metadata, source)
        select ${orgId}, ${p.id}, counter.n, ${input.kind}::feedback_kind, ${input.title}, ${body},
          ${clientId}, ${userId}, ${metadata}::jsonb, 'slack'
        from counter
        returning id, number
      ), act as (
        insert into ${activity} (org_id, feedback_id, actor_id, actor_kind, type, data)
        select ${orgId}, f.id, ${userId}, 'user', 'created', '{"source":"slack"}'::jsonb from f
      )
      select id, number from f
    `);
    const row = rows[0];
    if (!row) throw new Error("insert failed");
    return { ...row, duplicate: false };
  });
  if (!created.duplicate) {
    emit({ type: "feedback.created", orgId, feedbackId: created.id, actor: { kind: "user", id: userId } });
  }
  return created;
}
