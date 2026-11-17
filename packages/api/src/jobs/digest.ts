import { type EmailDigestFrequency, kindNoun } from "@pinwren/core";
import { feedback, notification, notificationPreference, withOrg } from "@pinwren/db";
import { and, desc, eq, gt, isNull, lte, or } from "drizzle-orm";
import { digestRecipients, markDigestSent, organizationIds } from "../db/system";
import { renderEmail } from "../email/render";
import { env } from "../env";
import { enqueueRequired, QUEUES } from "./boss";
import { teamRenderOptions } from "./notify";
import { assertGlobalMaintenance } from "./maintenance-batches";

// Email digests (wave-5 contract §3.2): people who chose hourly or daily get no instant team emails; the
// `notify.digest` job (hourly cron) sends each of them one email per workspace listing the notifications
// they haven't read since their last digest. The bell is unaffected.

const MAX_ROWS = 200;
const MAX_LINES = 50;
/** Never reach further back than this, e.g. right after switching digests on. */
const MAX_LOOKBACK_MS = 7 * 86_400_000;

/** Pure: is this person's digest due? A little slack so a cron that fires a few seconds early still counts. */
export function digestDue(freq: EmailDigestFrequency, last: Date | null, now: Date): boolean {
  if (freq === "off") return false;
  if (!last) return true;
  const gap = now.getTime() - last.getTime();
  return freq === "hourly" ? gap >= 55 * 60_000 : gap >= 23.5 * 3_600_000;
}

type Row = { type: string; data: Record<string, unknown> };

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Pure: one digest line, e.g. `#42 Checkout broken — new bug report from Dana (Marketing site)`. */
export function digestLine(n: Row): string {
  const d = n.data;
  const who = str(d.actorName);
  const kind = str(d.kind) ?? "feedback";
  const what = (() => {
    switch (n.type) {
      case "feedback.created":
        return `new ${kindNoun(kind)}${who ? ` from ${who}` : ""}`;
      case "feedback.assigned":
        return `${who ?? "someone"} assigned it to you`;
      case "feedback.status_changed":
        return `${who ?? "someone"} marked it ${str(d.status)?.replace(/_/g, " ") ?? "updated"}`;
      case "feedback.priority_changed":
        return `${who ?? "someone"} set priority to ${str(d.priority) ?? "none"}`;
      case "feedback.deleted":
        return `${who ?? "someone"} deleted it`;
      case "comment.created":
        return `${who ?? "a visitor"} replied`;
      case "comment.mentioned":
        return `${who ?? "someone"} mentioned you`;
      case "round.signoff":
        return `${str(d.reviewerName) ?? "a client"} ${d.decision === "approved" ? "approved" : "requested changes on"} the round`;
      case "webhook.disabled":
        return `webhook “${str(d.name) ?? "unnamed"}” was disabled`;
      default:
        return "update";
    }
  })();
  if (n.type === "round.signoff") return `Round ${str(d.roundName) ?? ""}: ${what}`;
  if (n.type === "webhook.disabled") return `Integrations: ${what}`;
  const num = typeof d.number === "number" ? `#${d.number} ` : "";
  const title = str(d.title) ?? "Untitled feedback";
  const project = str(d.projectName);
  return `${num}${title} — ${what}${project ? ` (${project})` : ""}`;
}

/** Pure: the `summary` variable — one line per notification, capped. */
export function digestSummary(rows: Row[]): string {
  const lines = rows.slice(0, MAX_LINES).map((r) => `• ${digestLine(r)}`);
  if (rows.length > MAX_LINES) lines.push(`…and ${rows.length - MAX_LINES} more`);
  return lines.join("\n");
}

/** `notify.digest` handler (hourly). */
export async function runDigest(now = new Date()): Promise<void> {
  assertGlobalMaintenance();
  const base = env().PINWREN_URL.replace(/\/$/, "");
  const snapshots: { orgId: string; recipients: Awaited<ReturnType<typeof digestRecipients>> }[] = [];
  // The cursor is account-wide: every workspace must see it before this run advances it.
  for (const orgId of await organizationIds()) {
    snapshots.push({
      orgId,
      recipients: (await digestRecipients(orgId)).filter((p) => digestDue(p.freq, p.last, now)),
    });
  }
  const completed = new Set<string>();
  const failed = new Set<string>();
  for (const { orgId, recipients } of snapshots) {
    if (!recipients.length) continue;
    // Snapshot collection can take time; honour membership removal and opt-outs before reading content.
    const eligible = new Map((await digestRecipients(orgId)).map((p) => [p.userId, p]));
    for (const snapshot of recipients) {
      const p = eligible.get(snapshot.userId);
      if (!p || !digestDue(p.freq, p.last, now)) continue;
      try {
        const since = new Date(Math.max(p.last?.getTime() ?? 0, now.getTime() - MAX_LOOKBACK_MS));
        const prepared = await withOrg(orgId, async (db) => {
          const [rows, muted] = await Promise.all([
            db
              .select({ type: notification.type, data: notification.data })
              .from(notification)
              .leftJoin(feedback, and(eq(feedback.id, notification.feedbackId), eq(feedback.orgId, orgId)))
              .where(
                and(
                  eq(notification.orgId, orgId),
                  eq(notification.userId, p.userId),
                  isNull(notification.readAt),
                  gt(notification.createdAt, since),
                  lte(notification.createdAt, now),
                  or(isNull(feedback.deletedAt), eq(notification.type, "feedback.deleted")),
                ),
              )
              .orderBy(desc(notification.createdAt))
              .limit(MAX_ROWS),
            db
              .select({ projectId: notificationPreference.projectId })
              .from(notificationPreference)
              .where(
                and(
                  eq(notificationPreference.orgId, orgId),
                  eq(notificationPreference.userId, p.userId),
                  eq(notificationPreference.email, false),
                ),
              ),
          ]);
          const off = new Set(muted.map((m) => m.projectId));
          const list = rows.filter((row) => {
            const projectId = typeof row.data.projectId === "string" ? row.data.projectId : null;
            return !projectId || !off.has(projectId);
          });
          if (!list.length) return null;
          return renderEmail(
            orgId,
            "digest",
            {
              period: p.freq,
              count: String(list.length),
              summary: digestSummary(list),
              link: `${base}/notifications?org=${encodeURIComponent(orgId)}`,
            },
            teamRenderOptions(),
          );
        });
        if (prepared) await enqueueRequired(QUEUES.email, { to: p.email, ...prepared });
        completed.add(p.userId);
      } catch (err) {
        failed.add(p.userId);
        console.error(`[pinwren] digest failed for user ${p.userId} in org ${orgId}`, err);
      }
    }
  }
  for (const userId of completed) {
    if (failed.has(userId)) continue;
    try {
      await markDigestSent(userId, now);
    } catch (err) {
      console.error(`[pinwren] digest cursor update failed for user ${userId}`, err);
    }
  }
}
