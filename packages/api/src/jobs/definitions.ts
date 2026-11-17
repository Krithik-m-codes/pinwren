import type { PgBoss } from "pg-boss";

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
  /** AI enrichment: auto-summary, severity, duplicates, repro steps. */
  aiEnrich: "ai.enrich",
  /** Automation rules: evaluate a project's rules for one committed domain event. */
  automation: "automation.run",
  /** Interactive Slack: post or refresh the cards for one domain event. */
  slack: "slack.deliver",
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/** Shared by self-host startup and offline Cloud provisioning. */
export const QUEUE_OPTIONS = {
  [QUEUES.dispatch]: { retryLimit: 3, retryDelay: 30, retryBackoff: true },
  [QUEUES.email]: { retryLimit: 4, retryDelay: 60, retryBackoff: true },
  [QUEUES.digest]: { retryLimit: 1, retryDelay: 300 },
  [QUEUES.webhook]: { retryLimit: 0, expireInSeconds: 120 },
  [QUEUES.retention]: { retryLimit: 2, retryDelay: 600 },
  [QUEUES.cleanup]: { retryLimit: 2, retryDelay: 600 },
  [QUEUES.issues]: { retryLimit: 6, retryDelay: 30, retryBackoff: true },
  [QUEUES.update]: { retryLimit: 0 },
  [QUEUES.projectExport]: { retryLimit: 0, expireInSeconds: 3600 },
  [QUEUES.aiEnrich]: { retryLimit: 2, retryDelay: 60, retryBackoff: true },
  [QUEUES.automation]: { retryLimit: 2, retryDelay: 30, retryBackoff: true },
  [QUEUES.slack]: { retryLimit: 4, retryDelay: 30, retryBackoff: true },
} satisfies Record<QueueName, NonNullable<Parameters<PgBoss["createQueue"]>[1]>>;
