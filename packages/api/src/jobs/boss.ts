import { PgBoss, type SendOptions } from "pg-boss";
import { env } from "../env";

// Background jobs on pg-boss (blueprint 02: Postgres-backed queue, no Redis). Every process (each
// cluster worker, each replica) runs its own PgBoss instance against the same tables; pg-boss's
// SKIP LOCKED fetch hands each job to exactly one of them, and its cron runs each schedule once.

export const QUEUES = {
  /** Fan-out of a domain event: in-app notifications, emails, webhook deliveries. */
  dispatch: "events.dispatch",
  /** Send one email (and record it in the delivery log). */
  email: "notify.email",
  /** Hourly: one digest email per person who chose hourly or daily digests. */
  digest: "notify.digest",
  /** One webhook delivery attempt; failed attempts schedule the next one themselves. */
  webhook: "webhook.deliver",
  /** Daily: delete feedback past each project's retention, prune delivery logs. */
  retention: "retention.apply",
  /** Daily: purge soft-deleted feedback (and its files) after the trash window. */
  cleanup: "assets.cleanup",
  /** GitHub/GitLab: create an issue, or push a close/reopen (retried with backoff). */
  issues: "issues.sync",
  /** Daily: look for a newer Pinwren release (skipped in privacy mode). */
  update: "update.check",
  /** Build one project's data export (zip of JSON + files) on request (Project › Privacy & data). */
  projectExport: "project.export",
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

const g = globalThis as unknown as { __pinwrenBoss?: Promise<PgBoss> | undefined };

/** The process-wide PgBoss instance, started (and its schema installed) on first use. */
export function getBoss(): Promise<PgBoss> {
  g.__pinwrenBoss ??= (async () => {
    const boss = new PgBoss({
      connectionString: env().DATABASE_URL,
      schema: "pgboss",
      max: Number(process.env.PINWREN_JOBS_POOL_MAX ?? 3),
      application_name: "pinwren-jobs",
    });
    boss.on("error", (err) => console.error("[pinwren] job queue error", err));
    await boss.start();
    // Queue definitions are idempotent; retries are per-queue defaults (webhooks retry themselves).
    await Promise.all([
      boss.createQueue(QUEUES.dispatch, { retryLimit: 3, retryDelay: 30, retryBackoff: true }),
      boss.createQueue(QUEUES.email, { retryLimit: 4, retryDelay: 60, retryBackoff: true }),
      boss.createQueue(QUEUES.digest, { retryLimit: 1, retryDelay: 300 }),
      boss.createQueue(QUEUES.webhook, { retryLimit: 0, expireInSeconds: 120 }),
      boss.createQueue(QUEUES.retention, { retryLimit: 2, retryDelay: 600 }),
      boss.createQueue(QUEUES.cleanup, { retryLimit: 2, retryDelay: 600 }),
      boss.createQueue(QUEUES.issues, { retryLimit: 6, retryDelay: 30, retryBackoff: true }),
      boss.createQueue(QUEUES.update, { retryLimit: 0 }),
      // The job records its own failure on the export; a retry would only repeat it.
      boss.createQueue(QUEUES.projectExport, { retryLimit: 0, expireInSeconds: 3600 }),
    ]);
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
  try {
    const boss = await getBoss();
    await boss.send(name, data, options);
  } catch (err) {
    console.error(`[pinwren] could not enqueue ${name}`, err);
  }
}

export async function enqueueAfter(name: QueueName, data: object, seconds: number): Promise<void> {
  try {
    const boss = await getBoss();
    await boss.sendAfter(name, data, null, seconds);
  } catch (err) {
    console.error(`[pinwren] could not enqueue ${name}`, err);
  }
}
