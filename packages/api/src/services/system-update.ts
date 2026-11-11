import { isClosedStatus, ruleActorId, type FeedbackStatus, type Priority } from "@pinwren/core";
import { activity, feedback, feedbackLabel, getDb, label, member } from "@pinwren/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { ApiError, notFound } from "../errors";
import { emit, updateEvents } from "../events";
import { assertRoundFor } from "./rounds";

/**
 * Changes made by the system on its own (an automation rule, or AI label auto-apply) rather than by a
 * signed-in person. They are written like a person's edit (timeline rows, events for webhooks and
 * notifications, realtime) but attributed to the rule / the AI, never to a user, and the events carry the
 * rule chain so automations cannot trigger themselves (see `services/automation-engine.ts`).
 */
export type SystemActor =
  { kind: "rule"; id: string; name: string; chain: string[] } | { kind: "ai"; id: "ai"; name: "AI" };

export type SystemPatch = {
  status?: FeedbackStatus | undefined;
  priority?: Priority | undefined;
  /** The complete new assignee list. */
  assigneeIds?: string[] | undefined;
  roundId?: string | undefined;
  /** Labels to add (never removes). Ids must belong to the item's project. */
  addLabelIds?: string[] | undefined;
};

export type SystemChanges = Record<string, { from: unknown; to: unknown }>;

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

/** Apply `patch` to an item (in the current organisation transaction when there is one). */
export async function systemUpdateFeedback(
  orgId: string,
  feedbackId: string,
  actor: SystemActor,
  patch: SystemPatch,
): Promise<{ changes: SystemChanges; projectId: string }> {
  const attribution =
    actor.kind === "rule" ? { ruleId: actor.id, ruleName: actor.name } : { via: "ai" as const };
  const result = await getDb().transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(feedback)
      .where(and(eq(feedback.id, feedbackId), eq(feedback.orgId, orgId), isNull(feedback.deletedAt)))
      .for("update");
    if (!before) throw notFound("Feedback");

    const set: Partial<typeof feedback.$inferInsert> = {};
    if (patch.status && patch.status !== before.status) {
      set.status = patch.status;
      set.resolvedAt = isClosedStatus(patch.status) ? new Date() : null;
      // A fix belongs to the resolution: reopening (or closing as won't fix) drops it.
      if (patch.status !== "resolved") {
        set.fixedInReleaseId = null;
        set.fixedInNextRelease = false;
      }
    }
    if (patch.priority && patch.priority !== before.priority) set.priority = patch.priority;
    if (patch.assigneeIds) {
      const unique = [...new Set(patch.assigneeIds)];
      if (unique.length) {
        const found = await tx
          .select({ id: member.userId })
          .from(member)
          .where(and(eq(member.organizationId, orgId), inArray(member.userId, unique)));
        if (found.length !== unique.length) {
          throw new ApiError(400, "INVALID_ASSIGNEE", "Assignees must be members of this organisation");
        }
      }
      if (!sameSet(unique, before.assigneeIds)) set.assigneeIds = unique;
    }
    if (patch.roundId && patch.roundId !== before.roundId) {
      await assertRoundFor(orgId, before.projectId, patch.roundId);
      set.roundId = patch.roundId;
    }

    let labelChange: { from: string[]; to: string[] } | null = null;
    if (patch.addLabelIds?.length) {
      const wanted = [...new Set(patch.addLabelIds)];
      const found = await tx
        .select({ id: label.id })
        .from(label)
        .where(and(eq(label.projectId, before.projectId), eq(label.orgId, orgId), inArray(label.id, wanted)));
      if (found.length !== wanted.length) {
        throw new ApiError(400, "INVALID_LABEL", "Labels must belong to this item's project");
      }
      const current = (
        await tx
          .select({ id: feedbackLabel.labelId })
          .from(feedbackLabel)
          .where(eq(feedbackLabel.feedbackId, feedbackId))
      ).map((r) => r.id);
      const missing = wanted.filter((id) => !current.includes(id));
      if (missing.length) {
        await tx
          .insert(feedbackLabel)
          .values(missing.map((labelId) => ({ feedbackId, labelId })))
          .onConflictDoNothing();
        labelChange = { from: current, to: [...current, ...missing] };
      }
    }

    const changes: SystemChanges = {};
    let after = before;
    if (Object.keys(set).length || labelChange) {
      // A labels-only change touches no column; bump updatedAt so lists re-sort, as a person's edit does.
      const [row] = await tx
        .update(feedback)
        .set(Object.keys(set).length ? set : { updatedAt: new Date() })
        .where(eq(feedback.id, feedbackId))
        .returning();
      if (!row) throw notFound("Feedback");
      after = row;
    }
    for (const field of ["status", "priority", "assigneeIds", "roundId"] as const) {
      if (field in set) changes[field] = { from: before[field] ?? null, to: after[field] ?? null };
    }
    if (labelChange) changes.labelIds = { from: labelChange.from, to: labelChange.to };

    const entries = Object.entries(changes);
    if (entries.length) {
      await tx.insert(activity).values(
        entries.map(([field, c]) => ({
          orgId,
          feedbackId,
          actorId: null,
          actorKind: actor.kind,
          type: `${field}_changed`,
          data: { from: c.from, to: c.to, ...attribution },
        })),
      );
    }
    return { before, after, changes, labelChange };
  });

  if (Object.keys(result.changes).length) {
    const eventActor = {
      kind: "integration" as const,
      id: actor.kind === "rule" ? ruleActorId(actor.id) : "ai",
    };
    const chain = actor.kind === "rule" ? [...actor.chain, actor.id] : undefined;
    const events = updateEvents(
      { orgId, feedbackId, actor: eventActor },
      { ...result.before, labelIds: result.labelChange?.from },
      { ...result.after, labelIds: result.labelChange?.to },
      Object.keys(result.changes),
    );
    emit(...events.map((e) => (chain ? { ...e, ruleChain: chain } : e)));
  }
  return { changes: result.changes, projectId: result.before.projectId };
}
