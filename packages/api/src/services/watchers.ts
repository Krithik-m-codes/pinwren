import { feedbackWatcher, getDb, member } from "@pinwren/db";
import { and, eq, inArray } from "drizzle-orm";

// Followers of an item (F-054, wave-5 contract §3.2): status, priority, reply and delete notifications go
// to its assignees plus these people. Added automatically (the reporter when a member, assignees,
// commenters, the @mentioned) or with "Follow" in the detail header.

/** Follow an item for every id that is a member of the organisation; others are ignored. */
export async function addWatchers(
  orgId: string,
  feedbackId: string,
  userIds: readonly string[],
): Promise<void> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return;
  const db = getDb();
  const members = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, orgId), inArray(member.userId, ids)));
  if (!members.length) return;
  await db
    .insert(feedbackWatcher)
    .values(members.map((m) => ({ feedbackId, userId: m.userId })))
    .onConflictDoNothing();
}

export async function removeWatcher(feedbackId: string, userId: string): Promise<void> {
  await getDb()
    .delete(feedbackWatcher)
    .where(and(eq(feedbackWatcher.feedbackId, feedbackId), eq(feedbackWatcher.userId, userId)));
}

/** For the detail payload's `watching` (consumer: triage). */
export async function isWatching(feedbackId: string, userId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ userId: feedbackWatcher.userId })
    .from(feedbackWatcher)
    .where(and(eq(feedbackWatcher.feedbackId, feedbackId), eq(feedbackWatcher.userId, userId)));
  return !!row;
}

export async function watcherIds(feedbackId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ userId: feedbackWatcher.userId })
    .from(feedbackWatcher)
    .where(eq(feedbackWatcher.feedbackId, feedbackId));
  return rows.map((r) => r.userId);
}
