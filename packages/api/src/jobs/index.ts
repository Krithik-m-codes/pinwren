import { deliverEmail } from "../email/deliveries";
import type { EmailMessage } from "../email/send";
import { env } from "../env";
import type { DomainEvent } from "../events";
import { type IssueJob, runIssueJob } from "../integrations/issues";
import { type ProjectExportJob, runProjectExport } from "../services/project-export";
import { runUpdateCheck } from "../settings/instance";
import { runDelivery } from "../webhooks/deliver";
import { getBoss, QUEUES } from "./boss";
import { dispatchEvent } from "./dispatch";
import { runDigest } from "./digest";
import { applyRetention, cleanupTrash } from "./maintenance";
import { type AiEnrichJob, runAiEnrichmentJob } from "./ai";
import { ensureCloudDatabaseSecurity } from "../cloud-startup";

export { enqueue, getBoss, QUEUES } from "./boss";

const g = globalThis as unknown as { __pinwrenWorkers?: Promise<void> | undefined };

/**
 * Start the job workers in this process (called from the Next.js Node instrumentation hook).
 * Safe to call more than once. `PINWREN_ROLE=web` processes only enqueue.
 */
export async function startJobs(): Promise<void> {
  // Security failures must propagate instead of entering the queue's catch-and-continue handler.
  await ensureCloudDatabaseSecurity();
  g.__pinwrenWorkers ??= (async () => {
    if (env().PINWREN_ROLE === "web") return;
    const boss = await getBoss();
    const each =
      <T>(fn: (data: T) => Promise<unknown>) =>
      async (jobs: { data: T }[]) => {
        for (const job of jobs) await fn(job.data);
      };
    await boss.work<DomainEvent>(
      QUEUES.dispatch,
      { batchSize: 5, pollingIntervalSeconds: 1 },
      each(dispatchEvent),
    );
    // Several local workers: a burst of reports fans out to many emails, and one SMTP round trip at a
    // time let replies to reporters wait behind minutes of team notifications.
    // Each email records its outcome in the delivery log; `retryCount` tells the last attempt apart.
    await boss.work<EmailMessage>(
      QUEUES.email,
      { pollingIntervalSeconds: 1, localConcurrency: 4 },
      async (jobs) => {
        for (const job of jobs) await deliverEmail(job.data, job.retryCount);
      },
    );
    await boss.work(
      QUEUES.digest,
      each(() => runDigest()),
    );
    await boss.work<{ deliveryId: string; orgId?: string }>(
      QUEUES.webhook,
      // Several at once: a receiver that times out holds its slot for up to the request timeout.
      { batchSize: 5, pollingIntervalSeconds: 1, localConcurrency: 4 },
      each((d) => runDelivery(d.deliveryId, { retry: true, ...(d.orgId ? { orgId: d.orgId } : {}) })),
    );
    await boss.work(QUEUES.retention, each(applyRetention));
    await boss.work(QUEUES.cleanup, each(cleanupTrash));
    // One job per fetch: a failing issue must only retry itself.
    await boss.work<IssueJob>(QUEUES.issues, { pollingIntervalSeconds: 1 }, each(runIssueJob));
    // Never throws (offline instances record the error); retries would only repeat the same miss.
    await boss.work(
      QUEUES.update,
      each(() => runUpdateCheck()),
    );
    // One export at a time per process: each one holds its archive in memory.
    await boss.work<ProjectExportJob>(
      QUEUES.projectExport,
      { pollingIntervalSeconds: 2 },
      each(runProjectExport),
    );
    await boss.work<AiEnrichJob>(
      QUEUES.aiEnrich,
      { batchSize: 3, pollingIntervalSeconds: 1, localConcurrency: 2 },
      each(runAiEnrichmentJob),
    );
    // Cron schedules are stored in Postgres; pg-boss creates each occurrence once across processes.
    await boss.schedule(QUEUES.retention, "15 3 * * *");
    await boss.schedule(QUEUES.digest, "5 * * * *");
    await boss.schedule(QUEUES.cleanup, "45 3 * * *");
    await boss.schedule(QUEUES.update, "30 4 * * *");
    console.log("[pinwren] job workers started");
  })().catch((err: unknown) => {
    g.__pinwrenWorkers = undefined;
    console.error("[pinwren] job workers failed to start", err);
  });
  return g.__pinwrenWorkers;
}

/** Stop workers and close the queue's pool (graceful shutdown, tests). */
export async function stopJobs(): Promise<void> {
  const g2 = globalThis as unknown as {
    __pinwrenBoss?: Promise<{ stop: (o?: object) => Promise<void> }> | undefined;
  };
  const boss = await g2.__pinwrenBoss?.catch(() => undefined);
  await boss?.stop({ graceful: true, timeout: 10_000 });
  g2.__pinwrenBoss = undefined;
  g.__pinwrenWorkers = undefined;
}
