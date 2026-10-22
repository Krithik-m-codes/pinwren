import { type EmailMessage, sendEmail } from "../email/send";
import { env } from "../env";
import type { DomainEvent } from "../events";
import { type IssueJob, runIssueJob } from "../integrations/issues";
import { runUpdateCheck } from "../settings/instance";
import { runDelivery } from "../webhooks/deliver";
import { getBoss, QUEUES } from "./boss";
import { dispatchEvent } from "./dispatch";
import { applyRetention, cleanupTrash } from "./maintenance";

export { enqueue, getBoss, QUEUES } from "./boss";

const g = globalThis as unknown as { __pinwrenWorkers?: Promise<void> | undefined };

/**
 * Start the job workers in this process (called from the Next.js Node instrumentation hook).
 * Safe to call more than once. `PINWREN_ROLE=web` processes only enqueue.
 */
export function startJobs(): Promise<void> {
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
    await boss.work<EmailMessage>(
      QUEUES.email,
      { pollingIntervalSeconds: 1, localConcurrency: 4 },
      each(sendEmail),
    );
    await boss.work<{ deliveryId: string }>(
      QUEUES.webhook,
      { batchSize: 5, pollingIntervalSeconds: 1 },
      each((d) => runDelivery(d.deliveryId)),
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
    // Cron schedules are stored in Postgres; pg-boss creates each occurrence once across processes.
    await boss.schedule(QUEUES.retention, "15 3 * * *");
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
