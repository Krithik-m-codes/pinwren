import { type EmailDigestFrequency, kindNoun } from "@pinwren/core";
import { feedback, getDb, notification, notificationPreference, user, userPreference } from "@pinwren/db";
import { and, desc, eq, gt, isNull, ne, or } from "drizzle-orm";
import { renderEmail } from "../email/render";
import { env } from "../env";
import { enqueue, QUEUES } from "./boss";
import { teamRenderOptions } from "./notify";

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
      case "webhook.disabled":
        return `webhook “${str(d.name) ?? "unnamed"}” was disabled`;
      default:
        return "update";
    }
  })();
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
  const db = getDb();
  const people = await db
    .select({
      userId: userPreference.userId,
      freq: userPreference.emailDigest,
      last: userPreference.lastDigestAt,
      email: user.email,
    })
    .from(userPreference)
    .innerJoin(user, eq(user.id, userPreference.userId))
    .where(and(ne(userPreference.emailDigest, "off"), eq(userPreference.emailPaused, false)));
  const base = env().PINWREN_URL.replace(/\/$/, "");

  for (const p of people) {
    if (!digestDue(p.freq, p.last, now)) continue;
    try {
      const since = new Date(Math.max(p.last?.getTime() ?? 0, now.getTime() - MAX_LOOKBACK_MS));
      const [rows, muted] = await Promise.all([
        db
          .select({ orgId: notification.orgId, type: notification.type, data: notification.data })
          .from(notification)
          .leftJoin(feedback, eq(feedback.id, notification.feedbackId))
          .where(
            and(
              eq(notification.userId, p.userId),
              isNull(notification.readAt),
              gt(notification.createdAt, since),
              // Items in the trash drop out, except the notice that they were deleted.
              or(isNull(feedback.deletedAt), eq(notification.type, "feedback.deleted")),
            ),
          )
          .orderBy(desc(notification.createdAt))
          .limit(MAX_ROWS),
        // Projects where this person switched email off: no digest lines for them either.
        db
          .select({ projectId: notificationPreference.projectId })
          .from(notificationPreference)
          .where(and(eq(notificationPreference.userId, p.userId), eq(notificationPreference.email, false))),
      ]);
      const off = new Set(muted.map((m) => m.projectId));
      const byOrg = new Map<string, Row[]>();
      for (const r of rows) {
        const projectId = typeof r.data.projectId === "string" ? r.data.projectId : null;
        if (projectId && off.has(projectId)) continue;
        byOrg.set(r.orgId, [...(byOrg.get(r.orgId) ?? []), r]);
      }
      for (const [orgId, list] of byOrg) {
        const rendered = await renderEmail(
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
        await enqueue(QUEUES.email, { to: p.email, ...rendered });
      }
      await db.update(userPreference).set({ lastDigestAt: now }).where(eq(userPreference.userId, p.userId));
    } catch (err) {
      // One person's broken digest must not hold back everyone else's.
      console.error(`[pinwren] digest failed for user ${p.userId}`, err);
    }
  }
}
