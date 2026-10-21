import type { WebhookEvent } from "@pinwren/core";
import { enqueue, QUEUES } from "./jobs/boss";

/** A domain event, fanned out by the `events.dispatch` job to notifications, email and webhooks. */
export type DomainEvent = {
  type: WebhookEvent;
  orgId: string;
  feedbackId: string;
  commentId?: string;
  actor: { kind: "user" | "guest" | "api" | "integration"; id: string | null };
  /** For feedback.updated / status_changed / assigned: field → { from, to }. */
  changes?: Record<string, { from: unknown; to: unknown }>;
  at: string;
};

export type EventInput = Omit<DomainEvent, "at">;

/**
 * Queue events for fan-out. Fire-and-forget: the response never waits on (or fails because of)
 * notifications or integrations.
 */
export function emit(...events: EventInput[]): void {
  const at = new Date().toISOString();
  for (const e of events) void enqueue(QUEUES.dispatch, { ...e, at });
}

/** Events for a dashboard/API feedback update, from the before/after rows. */
export function updateEvents(
  base: Omit<EventInput, "type" | "changes">,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: string[],
): EventInput[] {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const f of fields) {
    if (JSON.stringify(before[f] ?? null) !== JSON.stringify(after[f] ?? null)) {
      changes[f] = { from: before[f] ?? null, to: after[f] ?? null };
    }
  }
  if (!Object.keys(changes).length) return [];
  const out: EventInput[] = [{ ...base, type: "feedback.updated", changes }];
  if (changes.status)
    out.push({ ...base, type: "feedback.status_changed", changes: { status: changes.status } });
  if (changes.assigneeIds) {
    out.push({ ...base, type: "feedback.assigned", changes: { assigneeIds: changes.assigneeIds } });
  }
  return out;
}
