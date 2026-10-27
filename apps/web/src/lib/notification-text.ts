import { kindNoun } from "@pinwren/core";
import type { NotificationItem } from "@/lib/api";
import type { Key } from "@/lib/i18n/en";
import { type TFn, tEn } from "@/lib/i18n/english";

// What a notification says, in one line: the bell, the notifications page and desktop notifications all
// use it, so the wording matches everywhere (wave-5 contract §3.2: kind + actor, e.g. "New bug report from
// Maria").

const STATUS: Record<string, Key> = {
  open: "other1.statusOpen",
  in_progress: "other1.statusInProgress",
  in_review: "other1.statusInReview",
  resolved: "other1.statusResolved",
  wont_fix: "other1.statusWontFix",
  duplicate: "other1.statusDuplicate",
};

type Notice = Pick<NotificationItem, "type" | "data">;

/**
 * "New bug report from Maria", "Avery marked it resolved", "Webhook “Slack” was disabled"… `t` defaults to
 * English for callers that run outside the component tree.
 */
export function notificationText(n: Notice, t: TFn = tEn): string {
  const who = n.data.actorName?.trim() || null;
  const someone = who ?? t("other1.someone");
  switch (n.type) {
    case "feedback.created": {
      const kind = kindNoun(n.data.kind ?? "");
      return who ? t("other1.notifNewFrom", { kind, who }) : t("other1.notifNew", { kind });
    }
    case "feedback.assigned":
      return t("other1.notifAssigned", { who: someone });
    case "feedback.status_changed": {
      const known = n.data.status ? STATUS[n.data.status] : undefined;
      const status = n.data.status ? (known ? t(known) : n.data.status) : t("other1.statusUpdated");
      return t("other1.notifStatusChanged", { who: someone, status });
    }
    case "feedback.priority_changed":
      return !n.data.priority || n.data.priority === "none"
        ? t("other1.notifPriorityRemoved", { who: someone })
        : t("other1.notifPrioritySet", { who: someone, priority: n.data.priority });
    case "feedback.deleted":
      return t("other1.notifDeleted", { who: someone });
    case "comment.created":
      return t("other1.notifReplied", { who: who ?? t("other1.aVisitor") });
    case "comment.mentioned":
      return t("other1.notifMentioned", { who: someone });
    case "webhook.disabled":
      return t("other1.notifWebhookDisabled", { name: n.data.name ?? t("other1.unnamed") });
    default:
      return t("other1.notifUpdate");
  }
}

/** The item line under it: "#42 Checkout broken", or the webhook's last error. */
export function notificationSubject(n: Notice, t: TFn = tEn): string {
  if (n.type === "webhook.disabled") return n.data.lastError || t("other1.deliveriesKeptFailing");
  const num = n.data.number !== undefined ? `#${n.data.number} ` : "";
  return `${num}${n.data.title || t("other1.untitledFeedback")}`;
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
