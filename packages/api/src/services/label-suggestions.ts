import { MAX_LABELS_PER_PROJECT } from "@pinwren/core";
import { feedback, feedbackLabel, getDb, label, labelSuggestion } from "@pinwren/db";
import { and, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { ApiError, notFound } from "../errors";
import { type Actor, updateFeedback } from "./feedback";
import { systemUpdateFeedback } from "./system-update";

// AI label suggestions: ghost chips on an item, accepted or dismissed by a person. The job stores them;
// nothing touches the item's labels until someone accepts, unless the project opted into auto-apply (which
// only ever applies labels that already exist).

/** Colours a proposed label gets when accepted, picked by name so the same name always looks the same. */
const SUGGESTED_COLORS = ["#6e56cf", "#0091ff", "#12a594", "#46a758", "#f76b15", "#e5484d", "#d6409f"];
export const colorForLabelName = (name: string): string => {
  let h = 0;
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return SUGGESTED_COLORS[h % SUGGESTED_COLORS.length] ?? "#6e56cf";
};

export type LabelSuggestionOut = {
  id: string;
  feedbackId: string;
  /** null = a new label the AI proposes; it is created when accepted. */
  labelId: string | null;
  name: string;
  /** The existing label's colour, or the colour a proposed one would get. */
  color: string;
  reason: string | null;
};

export async function listPendingSuggestions(
  orgId: string,
  feedbackIds: string[],
): Promise<LabelSuggestionOut[]> {
  if (!feedbackIds.length) return [];
  const rows = await getDb()
    .select({ s: labelSuggestion, color: label.color, labelName: label.name })
    .from(labelSuggestion)
    .leftJoin(label, eq(label.id, labelSuggestion.labelId))
    .where(
      and(
        eq(labelSuggestion.orgId, orgId),
        inArray(labelSuggestion.feedbackId, feedbackIds),
        eq(labelSuggestion.status, "pending"),
      ),
    )
    .orderBy(labelSuggestion.createdAt);
  return rows.map(({ s, color, labelName }) => ({
    id: s.id,
    feedbackId: s.feedbackId,
    labelId: s.labelId,
    name: labelName ?? s.name,
    color: color ?? colorForLabelName(s.name),
    reason: s.reason,
  }));
}

/** Store the model's suggestions (a name already suggested for the item, in any state, is left alone). */
export async function recordSuggestions(
  orgId: string,
  feedbackId: string,
  suggestions: { labelId: string | null; name: string; reason: string }[],
): Promise<{ id: string; labelId: string | null; name: string }[]> {
  if (!suggestions.length) return [];
  return getDb()
    .insert(labelSuggestion)
    .values(
      suggestions.map((s) => ({
        orgId,
        feedbackId,
        labelId: s.labelId,
        name: s.name,
        reason: s.reason || null,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: labelSuggestion.id, labelId: labelSuggestion.labelId, name: labelSuggestion.name });
}

/** Apply stored suggestions of existing labels without asking (project opt-in), attributed to the AI. */
export async function autoApplySuggestions(
  orgId: string,
  feedbackId: string,
  suggestions: { id: string; labelId: string | null }[],
): Promise<void> {
  const existing = suggestions.filter((s): s is { id: string; labelId: string } => s.labelId !== null);
  if (!existing.length) return;
  await systemUpdateFeedback(
    orgId,
    feedbackId,
    { kind: "ai", id: "ai", name: "AI" },
    { addLabelIds: existing.map((s) => s.labelId) },
  );
  await getDb()
    .update(labelSuggestion)
    .set({ status: "accepted", decidedAt: new Date() })
    .where(
      and(
        eq(labelSuggestion.orgId, orgId),
        inArray(
          labelSuggestion.id,
          existing.map((s) => s.id),
        ),
      ),
    );
}

const isUniqueViolation = (err: unknown) => {
  const e = err as { code?: string; cause?: { code?: string } };
  return (e.cause?.code ?? e.code) === "23505";
};

/** The id of the project's label called `name` (any case), creating it when it does not exist yet. */
async function labelIdFor(orgId: string, projectId: string, name: string): Promise<string> {
  const find = async () => {
    const [l] = await getDb()
      .select({ id: label.id })
      .from(label)
      .where(
        and(
          eq(label.projectId, projectId),
          eq(label.orgId, orgId),
          sql`lower(${label.name}) = lower(${name})`,
        ),
      );
    return l?.id;
  };
  const existing = await find();
  if (existing) return existing;
  const [{ n } = { n: 0 }] = await getDb()
    .select({ n: count() })
    .from(label)
    .where(eq(label.projectId, projectId));
  if (n >= MAX_LABELS_PER_PROJECT) {
    throw new ApiError(400, "TOO_MANY_LABELS", `A project can have up to ${MAX_LABELS_PER_PROJECT} labels`);
  }
  try {
    // Savepoint, so a lost race on the unique name does not abort the surrounding transaction.
    const [created] = await getDb().transaction((tx) =>
      tx
        .insert(label)
        .values({ orgId, projectId, name, color: colorForLabelName(name) })
        .returning({ id: label.id }),
    );
    if (created) return created.id;
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
  }
  const raced = await find();
  if (!raced) throw new Error("label insert failed");
  return raced;
}

type Decision = "accept" | "dismiss";

/**
 * Accept or dismiss the pending suggestions with these ids (all must belong to the item). Accepting goes
 * through the normal update path, so the change is the person's: timeline, webhooks, undo-able like any edit.
 */
export async function decideSuggestions(
  orgId: string,
  actor: Actor,
  feedbackId: string,
  suggestionIds: string[] | "all",
  decision: Decision,
): Promise<{ accepted: number; dismissed: number }> {
  const db = getDb();
  const [item] = await db
    .select({ id: feedback.id, projectId: feedback.projectId })
    .from(feedback)
    .where(and(eq(feedback.id, feedbackId), eq(feedback.orgId, orgId), isNull(feedback.deletedAt)));
  if (!item) throw notFound("Feedback");
  const pending = await db
    .select()
    .from(labelSuggestion)
    .where(
      and(
        eq(labelSuggestion.orgId, orgId),
        eq(labelSuggestion.feedbackId, feedbackId),
        eq(labelSuggestion.status, "pending"),
        suggestionIds === "all" ? undefined : inArray(labelSuggestion.id, suggestionIds),
      ),
    );
  if (suggestionIds !== "all" && pending.length !== new Set(suggestionIds).size) {
    throw notFound("Suggestion");
  }
  if (!pending.length) return { accepted: 0, dismissed: 0 };
  const now = new Date();
  const mark = (status: "accepted" | "dismissed", ids: string[]) =>
    db
      .update(labelSuggestion)
      .set({ status, decidedBy: actor.userId, decidedAt: now })
      .where(and(eq(labelSuggestion.orgId, orgId), inArray(labelSuggestion.id, ids)));
  const ids = pending.map((s) => s.id);
  if (decision === "dismiss") {
    await mark("dismissed", ids);
    return { accepted: 0, dismissed: ids.length };
  }
  // Resolve each chip to a label (creating proposed ones), then one update for the whole item.
  const labelIds: string[] = [];
  for (const s of pending) {
    let id: string | null = null;
    if (s.labelId) {
      const [l] = await db.select({ id: label.id }).from(label).where(eq(label.id, s.labelId));
      id = l?.id ?? null;
    }
    id ??= await labelIdFor(orgId, item.projectId, s.name);
    labelIds.push(id);
  }
  const current = (
    await db
      .select({ id: feedbackLabel.labelId })
      .from(feedbackLabel)
      .where(eq(feedbackLabel.feedbackId, feedbackId))
  ).map((r) => r.id);
  await updateFeedback(orgId, actor, feedbackId, { labelIds: [...new Set([...current, ...labelIds])] });
  await mark("accepted", ids);
  return { accepted: ids.length, dismissed: 0 };
}
