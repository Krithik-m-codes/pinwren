import type { WebhookEvent } from "@pinwren/core";
import { afterOrgCommit } from "@pinwren/db";
import { enqueue, QUEUES } from "./jobs/boss";
import { publishDomainEvent } from "./realtime/publish";

/** A domain event, fanned out by the `events.dispatch` job to notifications, email and webhooks. */
export type DomainEvent = {
  /**
   * Stable id, set once by `emit()` (wave-5 contract §5). The dispatch job uses it to stay idempotent across
   * retries (`notification.event_id`, `webhook_delivery.domain_event_id`) and as the webhook payload `id`.
   * Jobs queued before wave 5 lack it, so consumers handle `undefined`.
   */
  id?: string;
  type: WebhookEvent;
  orgId: string;
  feedbackId: string;
  commentId?: string;
  actor: { kind: "user" | "guest" | "api" | "integration"; id: string | null };
  /** For feedback.updated / status_changed / assigned: field → { from, to }. */
  changes?: Record<string, { from: unknown; to: unknown }>;
  at: string;
};

export type EventInput = Omit<DomainEvent, "at" | "id">;

/**
 * Queue events for fan-out. Fire-and-forget: the response never waits on (or fails because of)
 * notifications or integrations.
 */
export function emit(...events: EventInput[]): void {
  const at = new Date().toISOString();
  for (const input of events) {
    const e = { ...input, id: crypto.randomUUID() };
    afterOrgCommit(() => {
      void enqueue(QUEUES.dispatch, { ...e, at });
      publishDomainEvent(e).catch((err: unknown) => console.warn("[pinwren] realtime publish failed", err));
    });
  }
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
  if (changes.priority) {
    out.push({ ...base, type: "feedback.priority_changed", changes: { priority: changes.priority } });
  }
  if (changes.labelIds) {
    out.push({ ...base, type: "feedback.labels_changed", changes: { labelIds: changes.labelIds } });
  }
  return out;
}
