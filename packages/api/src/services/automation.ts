import {
  type AutomationAction,
  type AutomationCondition,
  type AutomationRuleCreate,
  type AutomationRuleUpdate,
  type AutomationTestRequest,
  evaluateConditions,
  MAX_RULES_PER_PROJECT,
  triggerMatches,
} from "@pinwren/core";
import {
  automationRule,
  automationRun,
  customField,
  feedback,
  getDb,
  issueIntegration,
  label,
  member,
  project,
  reviewRound,
  webhookEndpoint,
} from "@pinwren/db";
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { ApiError, notFound } from "../errors";
import { loadFeedbackContext } from "./feedback-payload";
import { loadAutomationFacts } from "./automation-engine";

type RuleRow = typeof automationRule.$inferSelect;

export const ruleOut = (r: RuleRow) => ({
  id: r.id,
  projectId: r.projectId,
  name: r.name,
  enabled: r.enabled,
  trigger: r.trigger,
  conditions: r.conditions,
  actions: r.actions,
  runCount: r.runCount,
  lastRunAt: r.lastRunAt?.toISOString() ?? null,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

async function assertProject(orgId: string, projectId: string): Promise<void> {
  const [p] = await getDb()
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.orgId, orgId)));
  if (!p) throw notFound("Project");
}

async function ruleOf(orgId: string, id: string): Promise<RuleRow> {
  const [r] = await getDb()
    .select()
    .from(automationRule)
    .where(and(eq(automationRule.id, id), eq(automationRule.orgId, orgId)));
  if (!r) throw notFound("Automation rule");
  return r;
}

const invalid = (message: string) => new ApiError(400, "INVALID_RULE", message);

/**
 * Every id a rule names must exist in this organisation (and, where it has a project, in this one): a rule
 * saved with a foreign or deleted id is refused up front instead of failing on every run.
 */
async function assertReferences(
  orgId: string,
  projectId: string,
  trigger: { labelId: string | null },
  conditions: readonly AutomationCondition[],
  actions: readonly AutomationAction[],
): Promise<void> {
  const db = getDb();
  const labelIds = new Set<string>();
  const userIds = new Set<string>();
  const roundIds = new Set<string>();
  const endpointIds = new Set<string>();
  const integrationIds = new Set<string>();
  if (trigger.labelId) labelIds.add(trigger.labelId);
  for (const c of conditions) if (c.field === "label") c.labelIds.forEach((id) => labelIds.add(id));
  for (const a of actions) {
    if (a.type === "add_label") labelIds.add(a.labelId);
    else if (a.type === "assign" || a.type === "notify_email") a.userIds.forEach((id) => userIds.add(id));
    else if (a.type === "add_to_round") roundIds.add(a.roundId);
    else if (a.type === "notify_webhook") endpointIds.add(a.endpointId);
    else if (a.type === "create_issue") integrationIds.add(a.integrationId);
  }
  const missing = async (ids: Set<string>, found: Promise<{ id: string }[]>, what: string) => {
    if (ids.size && (await found).length !== ids.size) throw invalid(`A ${what} in this rule does not exist`);
  };
  await missing(
    labelIds,
    db
      .select({ id: label.id })
      .from(label)
      .where(and(eq(label.orgId, orgId), eq(label.projectId, projectId), inArray(label.id, [...labelIds]))),
    "label",
  );
  await missing(
    userIds,
    db
      .select({ id: member.userId })
      .from(member)
      .where(and(eq(member.organizationId, orgId), inArray(member.userId, [...userIds]))),
    "member",
  );
  await missing(
    roundIds,
    db
      .select({ id: reviewRound.id })
      .from(reviewRound)
      .where(
        and(
          eq(reviewRound.orgId, orgId),
          eq(reviewRound.projectId, projectId),
          inArray(reviewRound.id, [...roundIds]),
        ),
      ),
    "review round",
  );
  // A webhook endpoint is shared across the organisation or limited to one project.
  if (endpointIds.size) {
    const rows = await db
      .select({ id: webhookEndpoint.id, projectId: webhookEndpoint.projectId })
      .from(webhookEndpoint)
      .where(and(eq(webhookEndpoint.orgId, orgId), inArray(webhookEndpoint.id, [...endpointIds])));
    if (rows.length !== endpointIds.size || rows.some((r) => r.projectId && r.projectId !== projectId)) {
      throw invalid("A webhook endpoint in this rule does not exist for this project");
    }
  }
  await missing(
    integrationIds,
    db
      .select({ id: issueIntegration.id })
      .from(issueIntegration)
      .where(
        and(
          eq(issueIntegration.orgId, orgId),
          eq(issueIntegration.projectId, projectId),
          inArray(issueIntegration.id, [...integrationIds]),
        ),
      ),
    "issue tracker",
  );
  // A condition on a custom field names one of this project's fields (ADR 0032).
  const fieldKeys = new Set<string>();
  for (const c of conditions) if (c.field === "customField") fieldKeys.add(c.key);
  if (fieldKeys.size) {
    const found = await db
      .select({ key: customField.key })
      .from(customField)
      .where(and(eq(customField.orgId, orgId), eq(customField.projectId, projectId)));
    const known = new Set(found.map((r) => r.key));
    const unknown = [...fieldKeys].find((k) => !known.has(k));
    if (unknown) throw invalid(`The custom field "${unknown}" in this rule does not exist for this project`);
  }
}

export async function listRules(orgId: string, projectId: string) {
  await assertProject(orgId, projectId);
  const rows = await getDb()
    .select()
    .from(automationRule)
    .where(and(eq(automationRule.orgId, orgId), eq(automationRule.projectId, projectId)))
    .orderBy(automationRule.createdAt);
  return rows.map(ruleOut);
}

export async function getRule(orgId: string, id: string) {
  return ruleOut(await ruleOf(orgId, id));
}

export async function createRule(
  orgId: string,
  userId: string,
  projectId: string,
  input: AutomationRuleCreate,
) {
  await assertProject(orgId, projectId);
  const db = getDb();
  const [{ n } = { n: 0 }] = await db
    .select({ n: count() })
    .from(automationRule)
    .where(eq(automationRule.projectId, projectId));
  if (n >= MAX_RULES_PER_PROJECT) {
    throw new ApiError(400, "TOO_MANY_RULES", `A project can have up to ${MAX_RULES_PER_PROJECT} rules`);
  }
  await assertReferences(orgId, projectId, input.trigger, input.conditions, input.actions);
  const [row] = await db
    .insert(automationRule)
    .values({
      orgId,
      projectId,
      name: input.name,
      enabled: input.enabled,
      trigger: input.trigger,
      conditions: input.conditions,
      actions: input.actions,
      createdBy: userId,
    })
    .returning();
  if (!row) throw new Error("rule insert failed");
  return ruleOut(row);
}

export async function updateRule(orgId: string, id: string, patch: AutomationRuleUpdate) {
  const current = await ruleOf(orgId, id);
  const next = {
    trigger: patch.trigger ?? current.trigger,
    conditions: patch.conditions ?? current.conditions,
    actions: patch.actions ?? current.actions,
  };
  // Switching a rule off must always work, even when something it names has been deleted since.
  if (patch.trigger || patch.conditions || patch.actions) {
    await assertReferences(orgId, current.projectId, next.trigger, next.conditions, next.actions);
  }
  const [row] = await getDb()
    .update(automationRule)
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...next,
    })
    .where(eq(automationRule.id, id))
    .returning();
  if (!row) throw notFound("Automation rule");
  return ruleOut(row);
}

export async function deleteRule(orgId: string, id: string): Promise<void> {
  await ruleOf(orgId, id);
  await getDb().delete(automationRule).where(eq(automationRule.id, id));
}

export async function listRuns(orgId: string, projectId: string, ruleId: string | undefined, limit = 50) {
  await assertProject(orgId, projectId);
  const rows = await getDb()
    .select({ run: automationRun, ruleName: automationRule.name, number: feedback.number })
    .from(automationRun)
    .innerJoin(automationRule, eq(automationRule.id, automationRun.ruleId))
    .leftJoin(feedback, eq(feedback.id, automationRun.feedbackId))
    .where(
      and(
        eq(automationRun.orgId, orgId),
        eq(automationRun.projectId, projectId),
        ruleId ? eq(automationRun.ruleId, ruleId) : undefined,
      ),
    )
    .orderBy(desc(automationRun.createdAt))
    .limit(Math.min(Math.max(limit, 1), 100));
  return rows.map(({ run, ruleName, number }) => ({
    id: run.id,
    ruleId: run.ruleId,
    ruleName,
    feedbackId: run.feedbackId,
    feedbackNumber: number,
    event: run.event,
    depth: run.depth,
    status: run.status,
    results: run.results,
    error: run.error,
    createdAt: run.createdAt.toISOString(),
  }));
}

/**
 * Dry run: would this rule fire for that item (or hand-written sample)? Nothing is changed, queued or sent.
 * An existing item is evaluated as the rule's own trigger would see it (its current status as the new
 * status, its labels as the added ones).
 */
export async function testRule(orgId: string, id: string, request: AutomationTestRequest) {
  const rule = await ruleOf(orgId, id);
  let facts;
  if ("feedbackId" in request) {
    const [item] = await getDb()
      .select({ id: feedback.id, status: feedback.status })
      .from(feedback)
      .where(
        and(
          eq(feedback.id, request.feedbackId),
          eq(feedback.orgId, orgId),
          eq(feedback.projectId, rule.projectId),
          isNull(feedback.deletedAt),
        ),
      );
    const ctx = item ? await loadFeedbackContext(item.id) : null;
    if (!item || !ctx) throw notFound("Feedback");
    facts = await loadAutomationFacts(ctx, rule.trigger.event, { toStatus: item.status });
    facts = { ...facts, addedLabelIds: facts.labelIds };
  } else {
    const s = request.sample;
    facts = {
      event: rule.trigger.event,
      toStatus: s.toStatus,
      addedLabelIds: s.addedLabelId ? [s.addedLabelId] : s.labelIds,
      kind: s.kind,
      priority: s.priority,
      pageUrl: s.pageUrl,
      browser: s.browser,
      reporterEmail: s.reporterEmail,
      labelIds: s.labelIds,
      hasAttachment: s.hasAttachment,
      hasReplay: s.hasReplay,
      customFields: s.customFields,
    };
  }
  const triggered = triggerMatches(rule.trigger, facts);
  const conditions = evaluateConditions(rule.conditions, facts).map((c) => c.passed);
  return {
    triggered,
    conditions,
    matched: triggered && conditions.every(Boolean),
    actions: rule.actions.map((a) => a.type),
  };
}
