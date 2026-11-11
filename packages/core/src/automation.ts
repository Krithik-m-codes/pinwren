import { z } from "zod";
import { customFieldKey, feedbackKind, feedbackStatus, priority } from "./schemas";
import { urlPatternMatches } from "./url-pattern";

// Automation rules (per project): when [event] and [conditions] then [actions]. The schema is shared by the
// API, the dashboard builder and the engine; the engine never trusts a stored rule more than a posted one.

export const AUTOMATION_EVENTS = [
  "feedback_created",
  "status_changed",
  "label_added",
  "comment_added",
] as const;
export type AutomationEvent = (typeof AUTOMATION_EVENTS)[number];

/** Rule actions trigger further rules at most this many hops deep; a rule never re-fires from its own actions. */
export const AUTOMATION_MAX_DEPTH = 3;
export const MAX_RULES_PER_PROJECT = 50;
export const MAX_RULE_CONDITIONS = 10;
export const MAX_RULE_ACTIONS = 10;

export const automationTrigger = z.object({
  event: z.enum(AUTOMATION_EVENTS),
  /** status_changed: only when the new status is one of these (empty = any change). */
  toStatuses: z.array(feedbackStatus).max(6).default([]),
  /** label_added: only when this label was added (null = any label). */
  labelId: z.uuid().nullable().default(null),
});
export type AutomationTrigger = z.infer<typeof automationTrigger>;

const list = <T extends z.ZodType>(item: T) => z.array(item).min(1).max(20);
const text = z.string().trim().min(1).max(200);

export const CUSTOM_FIELD_OPS = [
  "equals",
  "not_equals",
  "contains",
  "gt",
  "lt",
  "is_set",
  "is_not_set",
] as const;
export type CustomFieldOp = (typeof CUSTOM_FIELD_OPS)[number];

export const automationCondition = z.discriminatedUnion("field", [
  z.object({ field: z.literal("kind"), values: list(feedbackKind) }),
  z.object({ field: z.literal("priority"), values: list(priority) }),
  /** The page path, written like a page-scope pattern: `/pricing`, `/product/:id`, `/docs/*`. */
  z.object({ field: z.literal("pageUrl"), pattern: z.string().trim().min(1).max(500) }),
  /** Browser family from the captured user agent (Chrome, Firefox, Safari, Edge, ...), case-insensitive. */
  z.object({ field: z.literal("browser"), values: list(text) }),
  /** The part after the @ of the reporter's address. */
  z.object({
    field: z.literal("reporterEmailDomain"),
    values: list(
      z
        .string()
        .trim()
        .toLowerCase()
        .min(3)
        .max(100)
        .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, "Use a domain like example.com"),
    ),
  }),
  /** The item carries at least one of these labels. */
  z.object({ field: z.literal("label"), labelIds: list(z.uuid()) }),
  z.object({ field: z.literal("hasAttachment"), value: z.boolean() }),
  z.object({ field: z.literal("hasReplay"), value: z.boolean() }),
  /** An answer to one of the project's custom fields (ADR 0029). `value` is typed as text and read by the answer's type. */
  z
    .object({
      field: z.literal("customField"),
      key: customFieldKey,
      op: z.enum(CUSTOM_FIELD_OPS),
      value: z.string().trim().max(200).optional(),
    })
    .refine((c) => c.op === "is_set" || c.op === "is_not_set" || !!c.value, {
      path: ["value"],
      message: "Enter a value to compare with",
    }),
]);
export type AutomationCondition = z.infer<typeof automationCondition>;

export const automationAction = z.discriminatedUnion("type", [
  /** Specific members (all of them) or a rotation over the pool (one at a time). */
  z.object({
    type: z.literal("assign"),
    userIds: z.array(z.string().min(1).max(100)).min(1).max(50),
    mode: z.enum(["all", "round_robin"]).default("all"),
  }),
  z.object({ type: z.literal("add_label"), labelId: z.uuid() }),
  z.object({ type: z.literal("set_priority"), priority }),
  z.object({ type: z.literal("set_status"), status: feedbackStatus }),
  z.object({ type: z.literal("add_to_round"), roundId: z.uuid() }),
  /** Post the event to one of the organisation's webhook endpoints (Slack, Discord, Teams, generic, ...). */
  z.object({ type: z.literal("notify_webhook"), endpointId: z.uuid() }),
  z
    .object({
      type: z.literal("notify_email"),
      userIds: z.array(z.string().min(1).max(100)).max(20).default([]),
      emails: z.array(z.email().max(254)).max(10).default([]),
    })
    .refine((a) => a.userIds.length + a.emails.length > 0, { message: "Choose at least one recipient" }),
  z.object({ type: z.literal("create_issue"), integrationId: z.uuid() }),
]);
export type AutomationAction = z.infer<typeof automationAction>;
export type AutomationActionType = AutomationAction["type"];

const ruleShape = {
  name: z.string().trim().min(1, "Name the rule").max(100),
  trigger: automationTrigger,
  conditions: z.array(automationCondition).max(MAX_RULE_CONDITIONS),
  actions: z.array(automationAction).min(1, "Add at least one action").max(MAX_RULE_ACTIONS),
};
export const automationRuleCreate = z.object({
  ...ruleShape,
  enabled: z.boolean().default(true),
  conditions: ruleShape.conditions.default([]),
});
export type AutomationRuleCreate = z.infer<typeof automationRuleCreate>;
/** A patch names only what changes: no defaults here, or an `enabled`-only patch would clear the conditions. */
export const automationRuleUpdate = z.object({ ...ruleShape, enabled: z.boolean() }).partial();
export type AutomationRuleUpdate = z.infer<typeof automationRuleUpdate>;

/** A dry-run request: an existing item of the project, or hand-written sample facts. */
export const automationTestRequest = z.union([
  z.object({ feedbackId: z.uuid() }),
  z.object({
    sample: z.object({
      kind: feedbackKind.default("bug"),
      priority: priority.default("none"),
      pageUrl: z.string().max(2000).nullable().default(null),
      browser: z.string().max(100).nullable().default(null),
      reporterEmail: z.string().max(254).nullable().default(null),
      labelIds: z.array(z.uuid()).max(20).default([]),
      hasAttachment: z.boolean().default(false),
      hasReplay: z.boolean().default(false),
      customFields: z.record(z.string().max(60), z.unknown()).default({}),
      toStatus: feedbackStatus.nullable().default(null),
      addedLabelId: z.uuid().nullable().default(null),
    }),
  }),
]);
export type AutomationTestRequest = z.infer<typeof automationTestRequest>;

export const AUTOMATION_RUN_STATUSES = ["success", "partial", "failed", "skipped"] as const;
export type AutomationRunStatus = (typeof AUTOMATION_RUN_STATUSES)[number];

/** The facts a rule is evaluated against: loaded from a real item by the engine, or typed into a dry run. */
export type AutomationFacts = {
  event: AutomationEvent;
  /** status_changed: the new status. */
  toStatus?: string | null;
  /** label_added: the labels just added. */
  addedLabelIds?: readonly string[];
  kind: string;
  priority: string;
  pageUrl: string | null;
  browser: string | null;
  reporterEmail: string | null;
  labelIds: readonly string[];
  hasAttachment: boolean;
  hasReplay: boolean;
  /** The item's custom field answers by key (ADR 0029). */
  customFields?: Record<string, unknown>;
};

export type ConditionResult = { condition: AutomationCondition; passed: boolean };

/** The email's domain, lower-cased, or null. */
export function emailDomain(email: string | null | undefined): string | null {
  const at = email?.lastIndexOf("@") ?? -1;
  return email && at > 0 ? email.slice(at + 1).toLowerCase() : null;
}

/** The browser family named in a user agent, ordered so Edge/Opera win over the Chrome token they also carry. */
export function browserFamily(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null;
  const rules: [RegExp, string][] = [
    [/Edg(?:e|A|iOS)?\//, "Edge"],
    [/OPR\/|Opera/, "Opera"],
    [/Firefox\/|FxiOS\//, "Firefox"],
    [/SamsungBrowser\//, "Samsung Internet"],
    [/Chrome\/|CriOS\//, "Chrome"],
    [/Safari\//, "Safari"],
  ];
  return rules.find(([re]) => re.test(userAgent))?.[1] ?? null;
}

export function triggerMatches(t: AutomationTrigger, f: AutomationFacts): boolean {
  if (t.event !== f.event) return false;
  if (t.event === "status_changed" && t.toStatuses.length) {
    return f.toStatus != null && (t.toStatuses as string[]).includes(f.toStatus);
  }
  if (t.event === "label_added" && t.labelId) return f.addedLabelIds?.includes(t.labelId) ?? false;
  return true;
}

const textOf = (v: unknown): string =>
  typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : "";

/** Compare one stored answer with the rule's text value, by the answer's own type. Unset never matches a comparison. */
export function customFieldMatches(
  op: CustomFieldOp,
  answer: unknown,
  expected: string | undefined,
): boolean {
  const set =
    answer !== undefined && answer !== null && answer !== "" && !(Array.isArray(answer) && !answer.length);
  if (op === "is_set") return set;
  if (op === "is_not_set") return !set;
  const want = (expected ?? "").trim().toLowerCase();
  if (!set) return op === "not_equals";
  const same = (a: unknown) => textOf(a).trim().toLowerCase() === want;
  switch (op) {
    case "equals":
      return Array.isArray(answer) ? answer.some(same) : same(answer);
    case "not_equals":
      return Array.isArray(answer) ? !answer.some(same) : !same(answer);
    case "contains":
      return Array.isArray(answer)
        ? answer.some((a) => textOf(a).toLowerCase().includes(want))
        : textOf(answer).toLowerCase().includes(want);
    case "gt":
    case "lt": {
      // Numbers compare as numbers, dates (YYYY-MM-DD) as text: both orders agree with the calendar.
      const a = typeof answer === "number" ? answer : Number(answer);
      const b = Number(want);
      const cmp =
        typeof answer === "number" && Number.isFinite(b)
          ? a - b
          : typeof answer === "string"
            ? answer.localeCompare(expected ?? "")
            : Number.NaN;
      return op === "gt" ? cmp > 0 : cmp < 0;
    }
    default:
      return false;
  }
}

export function conditionPasses(c: AutomationCondition, f: AutomationFacts): boolean {
  switch (c.field) {
    case "kind":
      return (c.values as string[]).includes(f.kind);
    case "priority":
      return (c.values as string[]).includes(f.priority);
    case "pageUrl":
      return f.pageUrl !== null && urlPatternMatches(c.pattern, f.pageUrl);
    case "browser":
      return f.browser !== null && c.values.some((v) => v.toLowerCase() === f.browser?.toLowerCase());
    case "reporterEmailDomain": {
      const d = emailDomain(f.reporterEmail);
      return d !== null && c.values.some((v) => v.toLowerCase() === d);
    }
    case "label":
      return c.labelIds.some((id) => f.labelIds.includes(id));
    case "hasAttachment":
      return f.hasAttachment === c.value;
    case "hasReplay":
      return f.hasReplay === c.value;
    case "customField":
      return customFieldMatches(c.op, f.customFields?.[c.key], c.value);
  }
}

/** All conditions must hold (AND). An empty list always passes. */
export function evaluateConditions(
  conditions: readonly AutomationCondition[],
  f: AutomationFacts,
): ConditionResult[] {
  return conditions.map((condition) => ({ condition, passed: conditionPasses(condition, f) }));
}

/**
 * Round-robin pick. The pool is sorted so the rotation is stable when members come and go; the cursor is a
 * counter that only grows (the caller increments it atomically per rule run).
 */
export function roundRobinPick(pool: readonly string[], cursor: number): string | null {
  if (!pool.length) return null;
  const sorted = [...pool].sort();
  return sorted[((cursor % sorted.length) + sorted.length) % sorted.length] ?? null;
}

/** An actor id on events made by a rule: `rule:<ruleId>`. */
export const ruleActorId = (ruleId: string) => `rule:${ruleId}`;
export const isRuleActor = (id: string | null | undefined): id is string => !!id && id.startsWith("rule:");

// --- AI label suggestions: bulk accept / dismiss from the inbox -------------------------------------------

export const MAX_BULK_LABEL_ITEMS = 100;
export const aiLabelBulkRequest = z.object({
  feedbackIds: z.array(z.uuid()).min(1).max(MAX_BULK_LABEL_ITEMS),
  action: z.enum(["accept", "dismiss"]),
});
export type AiLabelBulkRequest = z.infer<typeof aiLabelBulkRequest>;
