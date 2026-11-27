import {
  afterOrgCommit,
  automationRun,
  currentOrgId,
  feedback,
  feedbackAsset,
  getDb,
  notification,
  project,
} from "@pinwren/db";
import { AUDIT_CLOUD_RETENTION_DAYS } from "@pinwren/core";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { organizationIds, pruneSystemRateLimits, pruneSystemEmailDeliveries } from "../db/system";
import { DELIVERY_RETENTION_DAYS, pruneDeliveries as pruneEmailDeliveries } from "../email/deliveries";
import { env } from "../env";
import { pruneAudit } from "../services/audit";
import { storage } from "../storage";
import { pruneDeliveries } from "../webhooks/deliver";

import {
  assertGlobalMaintenance,
  maintenanceBatch,
  MAINTENANCE_BATCH_SIZE as BATCH,
  runMaintenanceBatches,
} from "./maintenance-batches";
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
  assertGlobalMaintenance();
  let total = 0;
  let deliveries = 0;
  let emails = 0;
  for (const orgId of await organizationIds()) {
    total += await runMaintenanceBatches(() =>
      maintenanceBatch(orgId, async (db) => {
        const rows = await db
          .select({ id: feedback.id })
          .from(feedback)
          .innerJoin(project, sql`${project.id} = ${feedback.projectId}`)
          .where(
            and(
              eq(feedback.orgId, orgId),
              eq(project.orgId, orgId),
              isNotNull(project.retentionDays),
              sql`${feedback.createdAt} < now() - make_interval(days => ${project.retentionDays})`,
            ),
          )
          .orderBy(feedback.createdAt, feedback.id)
          .limit(BATCH);
        return purgeFeedback(rows.map((row) => row.id));
      }),
    );
    deliveries += await runMaintenanceBatches(() => maintenanceBatch(orgId, () => pruneDeliveries(orgId)));
    emails += await runMaintenanceBatches(() => maintenanceBatch(orgId, () => pruneEmailDeliveries(orgId)));
    await runMaintenanceBatches(() =>
      maintenanceBatch(orgId, async (db) => {
        const expired = and(
          eq(notification.orgId, orgId),
          sql`${notification.readAt} < now() - interval '90 days'`,
        );
        const ids = db
          .select({ id: notification.id })
          .from(notification)
          .where(expired)
          .orderBy(notification.readAt, notification.id)
          .limit(BATCH);
        return (
          await db
            .delete(notification)
            .where(and(expired, inArray(notification.id, ids)))
            .returning({ id: notification.id })
        ).length;
      }),
    );
    await runMaintenanceBatches(() =>
      maintenanceBatch(orgId, async (db) => {
        const expired = and(
          eq(automationRun.orgId, orgId),
          sql`${automationRun.createdAt} < now() - interval '30 days'`,
        );
        const ids = db
          .select({ id: automationRun.id })
          .from(automationRun)
          .where(expired)
          .orderBy(automationRun.createdAt, automationRun.id)
          .limit(BATCH);
        return (
          await db
            .delete(automationRun)
            .where(and(eq(automationRun.orgId, orgId), inArray(automationRun.id, ids)))
            .returning({ id: automationRun.id })
        ).length;
      }),
    );
    // Cloud keeps 30 days of audit history (ADR 0044); self-hosted Enterprise keeps everything.
    if (env().PINWREN_MODE === "cloud") {
      await runMaintenanceBatches(() =>
        maintenanceBatch(orgId, () => pruneAudit(orgId, AUDIT_CLOUD_RETENTION_DAYS, BATCH)),
      );
    }
  }
  emails += await pruneSystemEmailDeliveries(new Date(Date.now() - DELIVERY_RETENTION_DAYS * 86_400_000));
  await pruneSystemRateLimits();
  if (total || deliveries || emails) {
    console.info(
      `[pinwren] retention: ${total} feedback, ${deliveries} webhook deliveries, ${emails} email log rows removed`,
    );
  }
  return { feedback: total, deliveries, emails };
}

export async function cleanupTrash(): Promise<number> {
  assertGlobalMaintenance();
  let total = 0;
  for (const orgId of await organizationIds()) {
    total += await runMaintenanceBatches(() =>
      maintenanceBatch(orgId, async (db) => {
        const rows = await db
          .select({ id: feedback.id })
          .from(feedback)
          .where(
            and(
              eq(feedback.orgId, orgId),
              sql`${feedback.deletedAt} < now() - make_interval(days => ${TRASH_DAYS})`,
            ),
          )
          .orderBy(feedback.deletedAt, feedback.id)
          .limit(BATCH);
        return purgeFeedback(rows.map((row) => row.id));
      }),
    );
  }
  return total;
}
