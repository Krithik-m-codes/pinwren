import { feedback, feedbackAsset, getDb, notification, project, rateLimit } from "@pinwren/db";
import { and, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { storage } from "../storage";
import { pruneDeliveries } from "../webhooks/deliver";

const BATCH = 500;
/** Soft-deleted feedback stays restorable this long, then it and its files are purged. */
export const TRASH_DAYS = 30;

/** Hard-delete feedback rows (cascades to comments, assets, activity…) and then their files. */
export async function purgeFeedback(ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const db = getDb();
  const assets = await db
    .select({ key: feedbackAsset.storageKey })
    .from(feedbackAsset)
    .where(inArray(feedbackAsset.feedbackId, ids));
  const deleted = await db.delete(feedback).where(inArray(feedback.id, ids)).returning({ id: feedback.id });
  // Files go after the rows: a crash in between leaves an orphan file, never a row pointing at nothing.
  for (const a of assets) {
    if (!a.key) continue;
    await storage()
      .remove(a.key)
      .catch((err: unknown) => console.warn(`[pinwren] could not remove asset ${a.key}`, err));
  }
  return deleted.length;
}

/** `retention.apply`: per-project retention, plus pruning of delivery logs and stale rows. */
export async function applyRetention(): Promise<{ feedback: number; deliveries: number }> {
  const db = getDb();
  let total = 0;
  for (;;) {
    const rows = await db
      .select({ id: feedback.id })
      .from(feedback)
      .innerJoin(project, sql`${project.id} = ${feedback.projectId}`)
      .where(
        and(
          isNotNull(project.retentionDays),
          sql`${feedback.createdAt} < now() - make_interval(days => ${project.retentionDays})`,
        ),
      )
      .limit(BATCH);
    if (!rows.length) break;
    total += await purgeFeedback(rows.map((r) => r.id));
    if (rows.length < BATCH) break;
  }
  const deliveries = await pruneDeliveries();
  await db.delete(notification).where(sql`${notification.readAt} < now() - interval '90 days'`);
  await db.delete(rateLimit).where(lt(rateLimit.resetAt, sql`now() - interval '1 hour'`));
  if (total || deliveries)
    console.info(`[pinwren] retention: ${total} feedback, ${deliveries} deliveries removed`);
  return { feedback: total, deliveries };
}

/** `assets.cleanup`: purge feedback that has sat in the trash longer than TRASH_DAYS. */
export async function cleanupTrash(): Promise<number> {
  const db = getDb();
  let total = 0;
  for (;;) {
    const rows = await db
      .select({ id: feedback.id })
      .from(feedback)
      .where(sql`${feedback.deletedAt} < now() - make_interval(days => ${TRASH_DAYS})`)
      .limit(BATCH);
    if (!rows.length) break;
    total += await purgeFeedback(rows.map((r) => r.id));
    if (rows.length < BATCH) break;
  }
  return total;
}
