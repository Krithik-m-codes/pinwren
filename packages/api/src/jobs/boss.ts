import { PgBoss, type SendOptions } from "pg-boss";
import { env } from "../env";
import { afterOrgCommit, currentOrgId } from "@pinwren/db";

// Background jobs on pg-boss (blueprint 02: Postgres-backed queue, no Redis). Every process (each
// cluster worker, each replica) runs its own PgBoss instance against the same tables; pg-boss's
// SKIP LOCKED fetch hands each job to exactly one of them, and its cron runs each schedule once.

import { QUEUES, QUEUE_OPTIONS } from "./definitions";
export { QUEUES, type QueueName } from "./definitions";
import type { QueueName } from "./definitions";
import { assertQueueSecurity } from "./queue-security";

const g = globalThis as unknown as { __pinwrenBoss?: Promise<PgBoss> | undefined };

/** Self-host installs on first use; Cloud only opens queues provisioned offline through its service role. */
export function getBoss(): Promise<PgBoss> {
  g.__pinwrenBoss ??= (async () => {
    const settings = env();
    const cloud = settings.PINWREN_MODE === "cloud";
    const connectionString = cloud ? settings.PINWREN_SERVICE_DATABASE_URL : settings.DATABASE_URL;
    if (!connectionString) throw new Error("Cloud job queues require PINWREN_SERVICE_DATABASE_URL");
    const boss = new PgBoss({
      connectionString,
      schema: "pgboss",
      max: Number(process.env.PINWREN_JOBS_POOL_MAX ?? 3),
      application_name: "pinwren-jobs",
      ...(cloud ? { migrate: false, reindex: false, persistQueueStats: false, persistWarnings: false } : {}),
    });
    boss.on("error", (err) => console.error("[pinwren] job queue error", err));
    try {
      if (cloud) await assertQueueSecurity(settings.DATABASE_URL, connectionString);
      await boss.start();
      if (cloud) {
        const installed = new Set((await boss.getQueues()).map((queue) => queue.name));
        if (Object.values(QUEUES).some((name) => !installed.has(name))) {
          throw new Error(
            "Cloud job queues are incomplete; run the offline Cloud migration/provisioning command",
          );
        }
      } else {
        await Promise.all(Object.values(QUEUES).map((name) => boss.createQueue(name, QUEUE_OPTIONS[name])));
      }
    } catch (error) {
      await boss.stop({ graceful: false }).catch(() => undefined);
      if (cloud)
        throw new Error("Cloud job queue startup failed; run scripts/cloud-migrate.sh offline", {
          cause: error,
        });
      throw error;
    }
    return boss;
  })().catch((err: unknown) => {
    g.__pinwrenBoss = undefined;
    throw err;
  });
  return g.__pinwrenBoss;
}

/**
 * Queue a job. Never throws: a broken queue must not fail the request that triggered it
 * (CLAUDE.md — integrations and notifications must never block ingest).
 */
export async function enqueue(name: QueueName, data: object, options: SendOptions = {}): Promise<void> {
  if (currentOrgId()) {
    afterOrgCommit(() => enqueue(name, data, options));
    return;
  }
  try {
    const boss = await getBoss();
    await boss.send(name, data, options);
  } catch (err) {
    console.error(`[pinwren] could not enqueue ${name}`, err);
  }
}

export async function enqueueAfter(name: QueueName, data: object, seconds: number): Promise<void> {
  if (currentOrgId()) {
    afterOrgCommit(() => enqueueAfter(name, data, seconds));
    return;
  }
  try {
    const boss = await getBoss();
    await boss.sendAfter(name, data, null, seconds);
  } catch (err) {
    console.error(`[pinwren] could not enqueue ${name}`, err);
  }
}
