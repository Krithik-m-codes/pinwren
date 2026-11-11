import {
  AUTOMATION_MAX_DEPTH,
  type AutomationAction,
  type AutomationEvent,
  type AutomationFacts,
  evaluateConditions,
  roundRobinPick,
  ruleActorId,
  triggerMatches,
  type WebhookEvent,
} from "@pinwren/core";
import {
  activity,
  afterOrgCommit,
  automationRule,
  automationRun,
  type AutomationActionResult,
  feedback,
  feedbackAsset,
  feedbackLabel,
  getDb,
  issueIntegration,
  member,
  reviewRound,
  user,
  webhookEndpoint,
  withOrg,
} from "@pinwren/db";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { esc } from "../email/markdown";
import type { EmailMessage } from "../email/send";
import type { DomainEvent } from "../events";
import { providerLicensed, type IssueJob } from "../integrations/issues";
import { enqueue, QUEUES } from "../jobs/boss";
import { isReadOnlyRole } from "../permissions";
import { queueDelivery } from "../webhooks/deliver";
import { WEBHOOK_API_VERSION, type WebhookPayload } from "../webhooks/format";
import {
  loadCommentPayload,
  loadFeedbackContext,
  loadFeedbackFacts,
  type FeedbackContext,
} from "./feedback-payload";
import { type SystemActor, type SystemPatch, systemUpdateFeedback } from "./system-update";

// The automation engine: runs after the domain event's transaction committed (the `automation.run` job is
// queued by the dispatcher), in one organisation scope. Loop protection has three layers:
//   1. an event made by a rule's action carries the chain of rules that led to it (`ruleChain`);
//   2. a rule never runs for an event whose chain already contains it;
//   3. chains stop at AUTOMATION_MAX_DEPTH hops.
// Each rule run is claimed with a unique (rule, event) row first, so a retried job never applies twice.

const EVENT_OF: Partial<Record<WebhookEvent, AutomationEvent>> = {
  "feedback.created": "feedback_created",
  "feedback.status_changed": "status_changed",
  "feedback.labels_changed": "label_added",
  "comment.created": "comment_added",
  "feedback.regression_detected": "regression_detected",
};

export const automationEventOf = (type: WebhookEvent): AutomationEvent | undefined => EVENT_OF[type];

/** Whether the dispatcher should queue this event for the engine at all. */
export const wantsAutomation = (e: Pick<DomainEvent, "type" | "ruleChain">): boolean =>
  e.type in EVENT_OF && (e.ruleChain?.length ?? 0) < AUTOMATION_MAX_DEPTH;

const firstWord = (s: string) => s.trim().split(/[\s/]/)[0] ?? "";

/** The facts rules are evaluated against, read from the database as the item is now. */
export async function loadAutomationFacts(
  ctx: FeedbackContext,
  event: AutomationEvent,
  extra: { toStatus?: string | null; addedLabelIds?: string[] } = {},
): Promise<AutomationFacts> {
  const db = getDb();
  const id = ctx.payload.id;
  const [facts, labels, attachment, [answers]] = await Promise.all([
    loadFeedbackFacts(id),
    db.select({ id: feedbackLabel.labelId }).from(feedbackLabel).where(eq(feedbackLabel.feedbackId, id)),
    db
      .select({ id: feedbackAsset.id })
      .from(feedbackAsset)
      .where(and(eq(feedbackAsset.feedbackId, id), eq(feedbackAsset.kind, "attachment")))
      .limit(1),
    // The stored answers, unmasked: a rule on a custom field decides on the real value (it sends nothing out).
    db.select({ answers: feedback.customFields }).from(feedback).where(eq(feedback.id, id)),
  ]);
  return {
    event,
    toStatus: extra.toStatus ?? null,
    addedLabelIds: extra.addedLabelIds ?? [],
    kind: ctx.payload.kind,
    priority: ctx.payload.priority,
    pageUrl: ctx.payload.pageUrl,
    browser: facts.browser ? firstWord(facts.browser) : null,
    reporterEmail: ctx.reporterEmail,
    labelIds: labels.map((l) => l.id),
    hasAttachment: attachment.length > 0,
    hasReplay: facts.hasReplay,
    customFields: answers?.answers ?? {},
  };
}

type Rule = typeof automationRule.$inferSelect;
type Run = { ok: boolean; detail: string };
const ok = (detail: string): Run => ({ ok: true, detail });

type Env = {
  orgId: string;
  rule: Rule;
  event: DomainEvent;
  chain: string[];
  actor: SystemActor;
};

async function logAction(env: Env, action: string, target: string) {
  await getDb()
    .insert(activity)
    .values({
      orgId: env.orgId,
      feedbackId: env.event.feedbackId,
      actorId: null,
      actorKind: "rule",
      type: "rule_action",
      data: { ruleId: env.rule.id, ruleName: env.rule.name, action, target },
    });
}

const changed = (changes: Record<string, unknown>) => Object.keys(changes).length > 0;

async function assignees(feedbackId: string): Promise<string[]> {
  const [row] = await getDb()
    .select({ ids: feedback.assigneeIds })
    .from(feedback)
    .where(eq(feedback.id, feedbackId));
  return row?.ids ?? [];
}

async function update(env: Env, patch: SystemPatch, okText: string, noopText: string): Promise<Run> {
  const { changes } = await systemUpdateFeedback(env.orgId, env.event.feedbackId, env.actor, patch);
  return ok(changed(changes) ? okText : noopText);
}

async function assign(env: Env, a: Extract<AutomationAction, { type: "assign" }>): Promise<Run> {
  const rows = await getDb()
    .select({ id: member.userId, role: member.role, name: user.name })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, env.orgId), inArray(member.userId, a.userIds)));
  // A viewer can't work an item, so a rotation never lands on one.
  const pool = rows.filter((r) => !isReadOnlyRole(r.role));
  if (!pool.length) return { ok: false, detail: "None of the chosen members can be assigned any more" };
  const current = await assignees(env.event.feedbackId);
  if (a.mode === "all") {
    const next = [...new Set([...current, ...pool.map((r) => r.id)])];
    return update(
      env,
      { assigneeIds: next },
      `Assigned to ${pool.map((r) => r.name).join(", ")}`,
      "Already assigned",
    );
  }
  // Round robin hands out unassigned items only; a person's own assignment is never taken away.
  if (current.length) return ok("Already assigned, left as is");
  const [bumped] = await getDb()
    .update(automationRule)
    .set({ rotation: sql`${automationRule.rotation} + 1` })
    .where(eq(automationRule.id, env.rule.id))
    .returning({ rotation: automationRule.rotation });
  const picked = roundRobinPick(
    pool.map((r) => r.id),
    (bumped?.rotation ?? 1) - 1,
  );
  const who = pool.find((r) => r.id === picked);
  if (!who) return { ok: false, detail: "No one to assign" };
  return update(env, { assigneeIds: [who.id] }, `Assigned to ${who.name} (round robin)`, "Already assigned");
}

async function notifyWebhook(
  env: Env,
  a: Extract<AutomationAction, { type: "notify_webhook" }>,
): Promise<Run> {
  const [ep] = await getDb()
    .select()
    .from(webhookEndpoint)
    .where(and(eq(webhookEndpoint.id, a.endpointId), eq(webhookEndpoint.orgId, env.orgId)));
  const ctx = await loadFeedbackContext(env.event.feedbackId);
  if (!ep?.active || !ctx) return { ok: false, detail: "That webhook endpoint is gone or switched off" };
  if (ep.projectId && ep.projectId !== ctx.payload.projectId) {
    return { ok: false, detail: "That webhook endpoint belongs to another project" };
  }
  const commentInfo = env.event.commentId ? await loadCommentPayload(env.event.commentId) : null;
  const { authorId: _author, feedbackId: _item, ...comment } = commentInfo ?? {};
  const payload: WebhookPayload = {
    id: crypto.randomUUID(),
    event: env.event.type,
    apiVersion: WEBHOOK_API_VERSION,
    createdAt: new Date().toISOString(),
    data: {
      feedback: ctx.payload,
      ...(commentInfo ? { comment: comment as NonNullable<WebhookPayload["data"]["comment"]> } : {}),
      ...(env.event.changes ? { changes: env.event.changes } : {}),
      actor: { kind: "integration", id: ruleActorId(env.rule.id) },
      rule: { id: env.rule.id, name: env.rule.name },
    },
  };
  const key = env.event.id ? `${env.event.id}:rule:${env.rule.id}:${ep.id}` : undefined;
  const queued = await queueDelivery(ep, payload, key);
  if (queued === null) return ok("Already sent");
  await logAction(env, "notify_webhook", ep.name ?? ep.kind);
  return ok(`Queued a message to ${ep.name ?? ep.kind}`);
}

async function notifyEmail(env: Env, a: Extract<AutomationAction, { type: "notify_email" }>): Promise<Run> {
  const ctx = await loadFeedbackContext(env.event.feedbackId);
  if (!ctx) return { ok: false, detail: "The item is gone" };
  const members = a.userIds.length
    ? await getDb()
        .select({ email: user.email })
        .from(member)
        .innerJoin(user, eq(user.id, member.userId))
        .where(and(eq(member.organizationId, env.orgId), inArray(member.userId, a.userIds)))
    : [];
  const to = [...new Set([...members.map((m) => m.email), ...a.emails].map((e) => e.toLowerCase()))];
  if (!to.length) return { ok: false, detail: "No recipients left" };
  const p = ctx.payload;
  const title = p.title?.trim() || p.body.slice(0, 80);
  const subject = `[${p.projectName}] #${p.number} ${title}`.slice(0, 200);
  const lines = [
    `Rule "${env.rule.name}" ran for #${p.number} in ${p.projectName}.`,
    title,
    `Kind: ${p.kind} · Priority: ${p.priority} · Status: ${p.status}`,
    p.url,
  ];
  const html = `<p>${esc(lines[0])}</p><p><strong>${esc(title)}</strong></p><p>${esc(lines[2])}</p><p><a href="${esc(p.url)}">${esc(p.url)}</a></p>`;
  const messages: EmailMessage[] = to.map((address) => ({
    to: address,
    subject,
    html,
    text: lines.join("\n\n"),
    templateKey: "automation",
    orgId: env.orgId,
  }));
  afterOrgCommit(async () => {
    for (const m of messages) {
      await enqueue(
        QUEUES.email,
        m,
        env.event.id
          ? { singletonKey: `${env.event.id}:rule:${env.rule.id}:${m.to}`, singletonSeconds: 3600 }
          : {},
      );
    }
  });
  await logAction(env, "notify_email", to.length === 1 ? (to[0] ?? "") : String(to.length));
  return ok(`Queued an email to ${to.length} ${to.length === 1 ? "person" : "people"}`);
}

async function createIssue(env: Env, a: Extract<AutomationAction, { type: "create_issue" }>): Promise<Run> {
  const [i] = await getDb()
    .select()
    .from(issueIntegration)
    .where(and(eq(issueIntegration.id, a.integrationId), eq(issueIntegration.orgId, env.orgId)));
  const ctx = await loadFeedbackContext(env.event.feedbackId);
  if (!i?.active || ctx?.payload.projectId !== i.projectId) {
    return { ok: false, detail: "That tracker is gone, switched off or in another project" };
  }
  if (!(await providerLicensed(i.provider))) return { ok: false, detail: "That tracker needs a licence" };
  const job = {
    type: "create",
    feedbackId: env.event.feedbackId,
    integrationId: i.id,
    orgId: env.orgId,
  } satisfies IssueJob;
  afterOrgCommit(() => enqueue(QUEUES.issues, job));
  await logAction(env, "create_issue", `${i.provider}:${i.repo}`);
  return ok(`Queued an issue in ${i.repo}`);
}

async function addToRound(env: Env, a: Extract<AutomationAction, { type: "add_to_round" }>): Promise<Run> {
  const [round] = await getDb()
    .select({ name: reviewRound.name })
    .from(reviewRound)
    .where(and(eq(reviewRound.id, a.roundId), eq(reviewRound.orgId, env.orgId)));
  if (!round) return { ok: false, detail: "That review round is gone" };
  const run = await update(
    env,
    { roundId: a.roundId },
    `Added to round ${round.name}`,
    "Already in that round",
  );
  if (run.ok) await logAction(env, "add_to_round", round.name);
  return run;
}

async function perform(env: Env, a: AutomationAction): Promise<Run> {
  switch (a.type) {
    case "assign":
      return assign(env, a);
    case "add_label":
      return update(env, { addLabelIds: [a.labelId] }, "Added a label", "Label already on the item");
    case "set_priority":
      return update(env, { priority: a.priority }, `Priority set to ${a.priority}`, "Priority unchanged");
    case "set_status":
      return update(env, { status: a.status }, `Status set to ${a.status}`, "Status unchanged");
    case "add_to_round":
      return addToRound(env, a);
    case "notify_webhook":
      return notifyWebhook(env, a);
    case "notify_email":
      return notifyEmail(env, a);
    case "create_issue":
      return createIssue(env, a);
  }
}

/** Run one rule's actions in order; one failing action does not stop the next, and never poisons the scope. */
async function execute(
  env: Env,
): Promise<{ results: AutomationActionResult[]; status: "success" | "partial" | "failed" }> {
  const results: AutomationActionResult[] = [];
  for (const action of env.rule.actions) {
    try {
      // A savepoint: a failed statement rolls back this action alone.
      const run = await getDb().transaction(() => perform(env, action));
      results.push({ type: action.type, ...run });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed";
      results.push({ type: action.type, ok: false, detail: message.slice(0, 300) });
    }
  }
  const good = results.filter((r) => r.ok).length;
  return { results, status: good === results.length ? "success" : good ? "partial" : "failed" };
}

/** `automation.run` handler: evaluate the project's rules for one domain event. */
export async function runAutomations(e: DomainEvent): Promise<number> {
  const event = automationEventOf(e.type);
  const chain = e.ruleChain ?? [];
  if (!event || chain.length >= AUTOMATION_MAX_DEPTH) return 0;
  return withOrg(e.orgId, async () => {
    const ctx = await loadFeedbackContext(e.feedbackId);
    if (ctx?.orgId !== e.orgId || ctx.deletedAt) return 0;
    const rules = await getDb()
      .select()
      .from(automationRule)
      .where(
        and(
          eq(automationRule.orgId, e.orgId),
          eq(automationRule.projectId, ctx.payload.projectId),
          eq(automationRule.enabled, true),
        ),
      )
      .orderBy(asc(automationRule.createdAt));
    const candidates = rules.filter((r) => r.trigger.event === event);
    if (!candidates.length) return 0;

    const from = e.changes?.labelIds?.from;
    const to = e.changes?.labelIds?.to;
    const addedLabelIds =
      Array.isArray(to) && Array.isArray(from)
        ? (to as string[]).filter((id) => !(from as string[]).includes(id))
        : [];
    // label_added fires only when something was actually added.
    if (event === "label_added" && !addedLabelIds.length) return 0;
    const toStatus = typeof e.changes?.status?.to === "string" ? e.changes.status.to : null;
    const facts = await loadAutomationFacts(ctx, event, { toStatus, addedLabelIds });

    let ran = 0;
    for (const rule of candidates) {
      if (!triggerMatches(rule.trigger, facts)) continue;
      if (!evaluateConditions(rule.conditions, facts).every((c) => c.passed)) continue;
      const looped = chain.includes(rule.id);
      // Claim the (rule, event) pair first: a retried job finds the row and skips.
      const [claimed] = await getDb()
        .insert(automationRun)
        .values({
          orgId: e.orgId,
          ruleId: rule.id,
          projectId: rule.projectId,
          feedbackId: e.feedbackId,
          eventId: e.id ?? null,
          event,
          depth: chain.length,
          status: looped ? "skipped" : "failed",
          error: looped
            ? "Skipped: this rule's own action caused the event"
            : "Interrupted before it finished",
        })
        .onConflictDoNothing()
        .returning({ id: automationRun.id });
      if (!claimed || looped) continue;
      const env: Env = {
        orgId: e.orgId,
        rule,
        event: e,
        chain,
        actor: { kind: "rule", id: rule.id, name: rule.name, chain },
      };
      const { results, status } = await execute(env);
      await getDb()
        .update(automationRun)
        .set({
          status,
          results,
          error: status === "success" ? null : (results.find((r) => !r.ok)?.detail ?? null),
        })
        .where(eq(automationRun.id, claimed.id));
      await getDb()
        .update(automationRule)
        // updatedAt stays: it dates the last edit of the rule, not its last run.
        .set({
          runCount: sql`${automationRule.runCount} + 1`,
          lastRunAt: new Date(),
          updatedAt: automationRule.updatedAt,
        })
        .where(eq(automationRule.id, rule.id));
      ran += 1;
    }
    return ran;
  });
}
