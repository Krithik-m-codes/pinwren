import { getDb, member, notification, user, userPreference, type webhookEndpoint } from "@pinwren/db";
import { and, eq, sql } from "drizzle-orm";
import { renderEmail } from "../email/render";
import { env } from "../env";
import { enqueue, QUEUES } from "../jobs/boss";
import { publish } from "../realtime/bus";

type Endpoint = typeof webhookEndpoint.$inferSelect;

const KIND_NAMES: Record<Endpoint["kind"], string> = {
  generic: "Webhook",
  slack: "Slack",
  discord: "Discord",
  teams: "Microsoft Teams",
  telegram: "Telegram",
  ntfy: "ntfy",
};

export const webhookDisplayName = (e: Pick<Endpoint, "name" | "kind">) => e.name ?? KIND_NAMES[e.kind];

/**
 * An endpoint was switched off after 3 days of failures (wave-5 contract §3.6): every workspace Admin gets a
 * `webhook.disabled` bell entry and the `webhook_disabled` email (unless they paused email). The bell row's
 * event id is the endpoint and the failing streak, so running this twice for one streak notifies once.
 */
export async function notifyWebhookDisabled(e: Endpoint, lastError: string | null): Promise<number> {
  const db = getDb();
  const admins = await db
    .select({
      userId: user.id,
      email: user.email,
      paused: sql<boolean>`coalesce(${userPreference.emailPaused}, false)`,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .leftJoin(userPreference, eq(userPreference.userId, member.userId))
    .where(
      and(
        eq(member.organizationId, e.orgId),
        // Better Auth stores several roles comma-separated.
        sql`${member.role} ~ '(^|,)\\s*(owner|admin)\\s*(,|$)'`,
      ),
    );
  if (!admins.length) return 0;
  const name = webhookDisplayName(e);
  const eventId = `webhook.disabled:${e.id}:${e.failingSince?.toISOString() ?? "unknown"}`;
  const inserted = await db
    .insert(notification)
    .values(
      admins.map((a) => ({
        orgId: e.orgId,
        userId: a.userId,
        feedbackId: null,
        type: "webhook.disabled",
        eventId,
        data: { webhookId: e.id, name, lastError },
      })),
    )
    .onConflictDoNothing()
    .returning({ id: notification.id, userId: notification.userId, createdAt: notification.createdAt });
  const data = { webhookId: e.id, name, lastError };
  // Push each new row to its admin's open dashboards, so the bell updates now rather than on its poll.
  for (const row of inserted) {
    void publish({
      t: "n",
      orgId: e.orgId,
      userId: row.userId,
      data: {
        id: row.id,
        type: "webhook.disabled",
        feedbackId: null,
        orgId: e.orgId,
        data,
        createdAt: row.createdAt.toISOString(),
      },
    });
  }
  const fresh = new Set(inserted.map((n) => n.userId));
  const recipients = admins.filter((a) => fresh.has(a.userId) && !a.paused);
  if (!recipients.length) return inserted.length;
  const rendered = await renderEmail(e.orgId, "webhook_disabled", {
    webhookName: name,
    lastError: lastError ?? "no response",
    settingsUrl: `${env().PINWREN_URL.replace(/\/$/, "")}/settings/integrations?webhook=${e.id}`,
  });
  for (const r of recipients) {
    await enqueue(QUEUES.email, {
      to: r.email,
      ...rendered,
      templateKey: "webhook_disabled",
      orgId: e.orgId,
    });
  }
  return inserted.length;
}
