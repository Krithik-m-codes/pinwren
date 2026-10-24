import { kindNoun } from "@pinwren/core";
import type { NotificationItem } from "@/lib/api";

// What a notification says, in one line: the bell, the notifications page and desktop notifications all
// use it, so the wording matches everywhere (wave-5 contract §3.2: kind + actor, e.g. "New bug report from
// Maria").

const STATUS: Record<string, string> = {
  open: "open",
  in_progress: "in progress",
  in_review: "in review",
  resolved: "resolved",
  wont_fix: "won't fix",
  duplicate: "a duplicate",
};

type Notice = Pick<NotificationItem, "type" | "data">;

/** "New bug report from Maria", "Avery marked it resolved", "Webhook “Slack” was disabled"… */
export function notificationText(n: Notice): string {
  const who = n.data.actorName?.trim() || null;
  switch (n.type) {
    case "feedback.created": {
      const kind = kindNoun(n.data.kind ?? "");
      return `New ${kind}${who ? ` from ${who}` : ""}`;
    }
    case "feedback.assigned":
      return `${who ?? "Someone"} assigned you`;
    case "feedback.status_changed":
      return `${who ?? "Someone"} marked it ${n.data.status ? (STATUS[n.data.status] ?? n.data.status) : "updated"}`;
    case "feedback.priority_changed":
      return !n.data.priority || n.data.priority === "none"
        ? `${who ?? "Someone"} removed the priority`
        : `${who ?? "Someone"} set priority to ${n.data.priority}`;
    case "feedback.deleted":
      return `${who ?? "Someone"} deleted it`;
    case "comment.created":
      return `${who ?? "A visitor"} replied`;
    case "comment.mentioned":
      return `${who ?? "Someone"} mentioned you`;
    case "webhook.disabled":
      return `Webhook “${n.data.name ?? "unnamed"}” was disabled`;
    default:
      return "Update";
  }
}

/** The item line under it: "#42 Checkout broken", or the webhook's last error. */
export function notificationSubject(n: Notice): string {
  if (n.type === "webhook.disabled") return n.data.lastError || "Deliveries kept failing for 3 days";
  const num = n.data.number !== undefined ? `#${n.data.number} ` : "";
  return `${num}${n.data.title || "Untitled feedback"}`;
}

/** Where clicking it goes: the item (switching workspace when needed), or the integrations settings. */
export function notificationHref(
  n: Pick<NotificationItem, "type" | "feedbackId" | "data">,
  orgId?: string,
): string {
  if (n.type === "webhook.disabled") {
    return n.data.webhookId ? `/settings/integrations?webhook=${n.data.webhookId}` : "/settings/integrations";
  }
  if (!n.feedbackId) return "/notifications";
  const org = orgId ? `&org=${encodeURIComponent(orgId)}` : "";
  return `/inbox?status=all${org}&item=${n.feedbackId}`;
}
