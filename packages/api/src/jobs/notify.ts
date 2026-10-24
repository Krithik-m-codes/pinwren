import type { EmailDigestFrequency } from "@pinwren/core";
import { getDb, member, notification, notificationPreference, user, userPreference } from "@pinwren/db";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { RenderedEmail } from "../email/render";
import type { EmailMessage } from "../email/send";
import { unsubscribeHeaders } from "../email/unsubscribe";
import { manageNotificationsUrl, teamUnsubscribeUrl } from "../email/links";
import { publish } from "../realtime/bus";
import { enqueue, QUEUES } from "./boss";

// In-app notifications and team emails for the dispatch job (wave-5 contract §3.2, §5). One row per person
// per event (idempotent on `event_id`); the bell hears about it through a per-user `notification.created`
// stream event published after the insert; an instant email
// goes only to people whose row is new, who want email for the project and who neither paused email nor
// chose a digest (the `notify.digest` job covers those).

export type NotifyPref =
  "newFeedback" | "assigned" | "replies" | "statusChanges" | "mentioned" | "priorityChanges";

export type Recipient = {
  userId: string;
  name: string;
  email: string;
  /** The project's Email switch. */
  wantsEmail: boolean;
  paused: boolean;
  digest: EmailDigestFrequency;
};

/** Pure: does this person get the email now (rather than in a digest, or not at all)? */
export const instantEmail = (r: Pick<Recipient, "wantsEmail" | "paused" | "digest">) =>
  r.wantsEmail && !r.paused && r.digest === "off";

/** Org members who have `pref` on for the project (no preference row = on), optionally only `only`. */
export async function membersWanting(
  orgId: string,
  projectId: string,
  pref: NotifyPref,
  only?: readonly string[],
): Promise<Recipient[]> {
  if (only?.length === 0) return [];
  const col = notificationPreference[pref];
  return getDb()
    .select({
      userId: user.id,
      name: user.name,
      email: user.email,
      wantsEmail: sql<boolean>`coalesce(${notificationPreference.email}, true)`,
      paused: sql<boolean>`coalesce(${userPreference.emailPaused}, false)`,
      digest: sql<EmailDigestFrequency>`coalesce(${userPreference.emailDigest}, 'off')`,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .leftJoin(
      notificationPreference,
      and(eq(notificationPreference.userId, member.userId), eq(notificationPreference.projectId, projectId)),
    )
    .leftJoin(userPreference, eq(userPreference.userId, member.userId))
    .where(
      and(
        eq(member.organizationId, orgId),
        or(isNull(notificationPreference.id), eq(col, true)),
        only ? inArray(member.userId, [...only]) : undefined,
      ),
    );
}

export type NotifyInput = {
  orgId: string;
  /** The domain event id; null for jobs queued before wave 5 (no idempotency then). */
  eventId: string | null;
  type: string;
  feedbackId: string | null;
  /** The person who caused it never hears about it. */
  actorId: string | null;
  /** For team-email unsubscribe links; null when the notification isn't about a project. */
  projectId: string | null;
  recipients: Recipient[];
  data: Record<string, unknown>;
  /** Rendered once, only if someone gets an instant email. */
  render: () => Promise<RenderedEmail>;
};

/**
 * The team email for one person: the shared rendering plus their own one-click List-Unsubscribe (turns
 * off email for that project) and a "Manage notifications" footer.
 */
export function teamMessage(rendered: RenderedEmail, r: Recipient, projectId: string | null): EmailMessage {
  return {
    to: r.email,
    ...rendered,
    ...(projectId
      ? { headers: unsubscribeHeaders(teamUnsubscribeUrl({ kind: "member", userId: r.userId, projectId })) }
      : {}),
  };
}

/** Render options every team email gets. */
export const teamRenderOptions = () => ({ manageUrl: manageNotificationsUrl() });

/** Write bell rows, push them to the recipients' streams, queue instant emails. Returns who was new. */
export async function notify(n: NotifyInput): Promise<Recipient[]> {
  const byId = new Map(n.recipients.filter((r) => r.userId !== n.actorId).map((r) => [r.userId, r]));
  if (!byId.size) return [];
  const inserted = await getDb()
    .insert(notification)
    .values(
      [...byId.values()].map((r) => ({
        orgId: n.orgId,
        userId: r.userId,
        feedbackId: n.feedbackId,
        type: n.type,
        eventId: n.eventId,
        data: n.data,
      })),
    )
    .onConflictDoNothing()
    .returning({
      id: notification.id,
      userId: notification.userId,
      createdAt: notification.createdAt,
    });
  for (const row of inserted) {
    void publish({
      t: "n",
      orgId: n.orgId,
      userId: row.userId,
      data: {
        id: row.id,
        type: n.type,
        feedbackId: n.feedbackId,
        orgId: n.orgId,
        data: n.data,
        createdAt: row.createdAt.toISOString(),
      },
    });
  }
  const fresh = inserted.flatMap((row) => {
    const r = byId.get(row.userId);
    return r ? [r] : [];
  });
  const emailNow = fresh.filter(instantEmail);
  if (emailNow.length) {
    const rendered = await n.render();
    for (const r of emailNow) await enqueue(QUEUES.email, teamMessage(rendered, r, n.projectId));
  }
  return fresh;
}

/**
 * An email that has no bell row to make it idempotent (extra addresses, reporters): pg-boss drops a second
 * job with the same key for an hour, which covers a retried dispatch job.
 */
export async function enqueueOnce(key: string | null, msg: EmailMessage): Promise<void> {
  await enqueue(QUEUES.email, msg, key ? { singletonKey: key, singletonSeconds: 3600 } : {});
}
