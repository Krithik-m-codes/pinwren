import type { FeedbackRow } from "@/lib/api";
import type { FeedbackPatch, ItemChange } from "@/lib/store/api/feedback";

/**
 * What puts each item back after `patch` (bulk undo): every item's own previous value of the fields the
 * patch changes, read from the rows before the change. Items not in `rows` can't be undone and are left out.
 */
export function undoChanges(rows: readonly FeedbackRow[], ids: readonly string[], patch: FeedbackPatch) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: ItemChange[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) continue;
    const prev: FeedbackPatch = {};
    const change: ItemChange = { id, patch: prev };
    if (patch.status !== undefined) prev.status = row.status;
    if (patch.priority !== undefined) prev.priority = row.priority;
    if (patch.assigneeIds !== undefined) prev.assigneeIds = row.assigneeIds;
    if (patch.roundId !== undefined) prev.roundId = row.roundId;
    if (patch.title !== undefined) prev.title = row.title;
    if (patch.dueAt !== undefined) prev.dueAt = row.dueAt;
    if (patch.kind !== undefined) prev.kind = row.kind;
    if (patch.labelIds !== undefined) {
      prev.labelIds = row.labels.map((l) => l.id);
      change.optimistic = { labels: row.labels };
    }
    out.push(change);
  }
  return out;
}
