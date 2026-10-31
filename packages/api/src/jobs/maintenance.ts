import {
  afterOrgCommit,
  currentOrgId,
  feedback,
  feedbackAsset,
  getDb,
  notification,
  project,
  withOrg,
} from "@pinwren/db";
import { and, inArray, isNotNull, sql } from "drizzle-orm";
import { organizationIds, pruneSystemRateLimits } from "../db/system";
import { pruneDeliveries as pruneEmailDeliveries } from "../email/deliveries";
import { storage } from "../storage";
import { pruneDeliveries } from "../webhooks/deliver";

const BATCH = 500;
export const TRASH_DAYS = 30;

export async function purgeFeedback(ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const db = getDb();
  const assets = await db
    .select({ key: feedbackAsset.storageKey })
    .from(feedbackAsset)
    .where(inArray(feedbackAsset.feedbackId, ids));
  const deleted = await db.delete(feedback).where(inArray(feedback.id, ids)).returning({ id: feedback.id });
  const removeFiles = async () => {
    for (const a of assets) {
      if (!a.key) continue;
      await storage()
        .remove(a.key)
        .catch((err: unknown) => console.warn(`[pinwren] could not remove asset ${a.key}`, err));
    }
  };
  if (currentOrgId()) afterOrgCommit(removeFiles);
  else await removeFiles();
  return deleted.length;
}

export async function applyRetention(): Promise<{ feedback: number; deliveries: number; emails: number }> {
  let total = 0;
  let deliveries = 0;
  let emails = 0;
  for (const orgId of await organizationIds()) {
    const result = await withOrg(orgId, async (db) => {
      let removed = 0;
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
        removed += await purgeFeedback(rows.map((row) => row.id));
        if (rows.length < BATCH) break;
      }
      const webhookRows = await pruneDeliveries();
      const emailRows = await pruneEmailDeliveries();
      await db.delete(notification).where(sql`${notification.readAt} < now() - interval '90 days'`);
      return { removed, webhookRows, emailRows };
    });
    total += result.removed;
    deliveries += result.webhookRows;
    emails += result.emailRows;
  }
  await pruneSystemRateLimits();
  if (total || deliveries || emails) {
    console.info(
      `[pinwren] retention: ${total} feedback, ${deliveries} webhook deliveries, ${emails} email log rows removed`,
    );
  }
  return { feedback: total, deliveries, emails };
}

export async function cleanupTrash(): Promise<number> {
  let total = 0;
  for (const orgId of await organizationIds()) {
    total += await withOrg(orgId, async (db) => {
      let removed = 0;
      for (;;) {
        const rows = await db
          .select({ id: feedback.id })
          .from(feedback)
          .where(sql`${feedback.deletedAt} < now() - make_interval(days => ${TRASH_DAYS})`)
          .limit(BATCH);
        if (!rows.length) break;
        removed += await purgeFeedback(rows.map((row) => row.id));
        if (rows.length < BATCH) break;
      }
      return removed;
    });
  }
  return total;
}
