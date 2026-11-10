import { SLACK_ROUTE_EVENTS } from "@pinwren/core";
import type { DomainEvent } from "../events";
import { enqueue, QUEUES } from "../jobs/boss";
import { slackConnected } from "./workspace";

/**
 * Called by the dispatcher inside the event's organisation scope. Queues the Slack job only for events a route can
 * carry and only while an active Slack app is connected, so workspaces without Slack add nothing to the queue.
 */
export async function queueSlack(e: DomainEvent): Promise<void> {
  if (!(SLACK_ROUTE_EVENTS as readonly string[]).includes(e.type)) return;
  if (!(await slackConnected(e.orgId))) return;
  await enqueue(QUEUES.slack, e, e.id ? { singletonKey: `slack:${e.id}`, singletonSeconds: 3600 } : {});
}
