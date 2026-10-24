import type { AnchorBundle } from "@pinwren/core";
import { activity, feedback, getDb } from "@pinwren/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { notFound } from "../errors";

/** Who moved the pin: a signed-in team member, or the widget holding a team-issued re-pin link. */
export type AnchorActor = { kind: "user"; id: string } | { kind: "guest"; id: null };

/**
 * Re-pin (F-031, wave-5 contract §3.3): replace an item's anchor bundle. The old bundle is kept in the
 * `anchor_changed` activity row, so a wrong correction can be undone from history.
 */
export async function updateAnchor(
  orgId: string,
  feedbackId: string,
  anchor: AnchorBundle,
  actor: AnchorActor,
  via: "dashboard" | "widget",
): Promise<{ id: string; anchor: AnchorBundle }> {
  const db = getDb();
  const [f] = await db
    .select({ id: feedback.id, anchor: feedback.anchor })
    .from(feedback)
    .where(and(eq(feedback.id, feedbackId), eq(feedback.orgId, orgId), isNull(feedback.deletedAt)));
  if (!f) throw notFound("Feedback");
  // Update and timeline entry in one statement.
  const rows = await db.execute<{ id: string }>(sql`
    with u as (
      update ${feedback} set anchor = ${JSON.stringify(anchor)}::jsonb, updated_at = now()
      where id = ${f.id}
      returning id
    ), act as (
      insert into ${activity} (org_id, feedback_id, actor_id, actor_kind, type, data)
      select ${orgId}, u.id, ${actor.id}, ${actor.kind}, 'anchor_changed',
        ${JSON.stringify({ from: f.anchor ?? null, via })}::jsonb
      from u
    )
    select id from u
  `);
  if (!rows[0]) throw notFound("Feedback");
  return { id: f.id, anchor };
}
