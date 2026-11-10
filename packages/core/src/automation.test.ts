import { describe, expect, it } from "vitest";
import {
  type AutomationCondition,
  type AutomationFacts,
  type AutomationTrigger,
  aiLabelBulkRequest,
  automationRuleCreate,
  automationRuleUpdate,
  automationTestRequest,
  browserFamily,
  conditionPasses,
  emailDomain,
  evaluateConditions,
  isRuleActor,
  roundRobinPick,
  ruleActorId,
  triggerMatches,
} from "./automation";

const facts = (over: Partial<AutomationFacts> = {}): AutomationFacts => ({
  event: "feedback_created",
  kind: "bug",
  priority: "high",
  pageUrl: "https://shop.test/pricing/plans?x=1",
  browser: "Chrome",
  reporterEmail: "Jo@Acme.com",
  labelIds: ["l1"],
  hasAttachment: false,
  hasReplay: true,
  ...over,
});

describe("automation rule schema", () => {
  const base = {
    name: "  Route bugs ",
    trigger: { event: "feedback_created" },
    actions: [{ type: "set_priority", priority: "high" }],
  };

  it("fills defaults and trims the name", () => {
    const rule = automationRuleCreate.parse(base);
    expect(rule).toMatchObject({ name: "Route bugs", enabled: true, conditions: [] });
    expect(rule.trigger).toEqual({ event: "feedback_created", toStatuses: [], labelId: null });
  });

  it("requires at least one action and known event, action and condition kinds", () => {
    expect(automationRuleCreate.safeParse({ ...base, actions: [] }).success).toBe(false);
    expect(automationRuleCreate.safeParse({ ...base, trigger: { event: "deleted" } }).success).toBe(false);
    expect(automationRuleCreate.safeParse({ ...base, actions: [{ type: "run_script" }] }).success).toBe(
      false,
    );
    expect(
      automationRuleCreate.safeParse({ ...base, conditions: [{ field: "color", values: ["red"] }] }).success,
    ).toBe(false);
  });

  it("validates domains, emails and ids in conditions and actions", () => {
    const condition = (c: unknown) => automationRuleCreate.safeParse({ ...base, conditions: [c] }).success;
    expect(condition({ field: "reporterEmailDomain", values: ["acme.com"] })).toBe(true);
    expect(condition({ field: "reporterEmailDomain", values: ["not a domain"] })).toBe(false);
    expect(condition({ field: "label", labelIds: ["nope"] })).toBe(false);
    const action = (a: unknown) => automationRuleCreate.safeParse({ ...base, actions: [a] }).success;
    expect(action({ type: "notify_email", emails: ["a@b.co"] })).toBe(true);
    expect(action({ type: "notify_email", emails: ["nope"] })).toBe(false);
    expect(action({ type: "assign", userIds: [] })).toBe(false);
  });

  it("keeps an update to exactly the fields it names (no defaults filled in)", () => {
    expect(automationRuleUpdate.parse({ enabled: false })).toEqual({ enabled: false });
    expect(automationRuleUpdate.parse({})).toEqual({});
    expect(automationRuleUpdate.safeParse({ actions: [] }).success).toBe(false);
  });

  it("caps the number of conditions", () => {
    const many = Array.from({ length: 11 }, () => ({ field: "hasReplay", value: true }));
    expect(automationRuleCreate.safeParse({ ...base, conditions: many }).success).toBe(false);
  });

  it("accepts a sample or an item id for a dry run, nothing else", () => {
    expect(automationTestRequest.safeParse({ sample: {} }).success).toBe(true);
    expect(automationTestRequest.safeParse({ feedbackId: crypto.randomUUID() }).success).toBe(true);
    expect(automationTestRequest.safeParse({}).success).toBe(false);
  });

  it("bounds the bulk label request", () => {
    expect(aiLabelBulkRequest.safeParse({ feedbackIds: [], action: "accept" }).success).toBe(false);
    const ids = Array.from({ length: 101 }, () => crypto.randomUUID());
    expect(aiLabelBulkRequest.safeParse({ feedbackIds: ids, action: "accept" }).success).toBe(false);
    expect(aiLabelBulkRequest.safeParse({ feedbackIds: ids.slice(0, 2), action: "dismiss" }).success).toBe(
      true,
    );
  });
});

describe("conditions", () => {
  it("matches kind, priority and labels", () => {
    expect(conditionPasses({ field: "kind", values: ["bug", "idea"] }, facts())).toBe(true);
    expect(conditionPasses({ field: "kind", values: ["idea"] }, facts())).toBe(false);
    expect(conditionPasses({ field: "priority", values: ["urgent"] }, facts())).toBe(false);
    expect(conditionPasses({ field: "label", labelIds: ["x", "l1"] }, facts())).toBe(true);
    expect(conditionPasses({ field: "label", labelIds: ["x"] }, facts())).toBe(false);
  });

  it("matches the page by path pattern and treats a missing page as no match", () => {
    expect(conditionPasses({ field: "pageUrl", pattern: "/pricing/*" }, facts())).toBe(true);
    expect(conditionPasses({ field: "pageUrl", pattern: "/product/:id" }, facts())).toBe(false);
    expect(conditionPasses({ field: "pageUrl", pattern: "/pricing/*" }, facts({ pageUrl: null }))).toBe(
      false,
    );
  });

  it("matches browser and reporter domain case-insensitively and exactly", () => {
    expect(conditionPasses({ field: "browser", values: ["chrome"] }, facts())).toBe(true);
    expect(conditionPasses({ field: "browser", values: ["Safari"] }, facts())).toBe(false);
    expect(conditionPasses({ field: "browser", values: ["Chrome"] }, facts({ browser: null }))).toBe(false);
    const domain: AutomationCondition = { field: "reporterEmailDomain", values: ["acme.com"] };
    expect(conditionPasses(domain, facts())).toBe(true);
    expect(conditionPasses(domain, facts({ reporterEmail: null }))).toBe(false);
    expect(conditionPasses(domain, facts({ reporterEmail: "a@evil.acme.com.io" }))).toBe(false);
  });

  it("matches attachment and replay presence either way", () => {
    expect(conditionPasses({ field: "hasReplay", value: true }, facts())).toBe(true);
    expect(conditionPasses({ field: "hasReplay", value: false }, facts())).toBe(false);
    expect(conditionPasses({ field: "hasAttachment", value: false }, facts())).toBe(true);
  });

  it("evaluates every condition (AND) and passes with none", () => {
    const results = evaluateConditions(
      [
        { field: "kind", values: ["bug"] },
        { field: "priority", values: ["low"] },
      ],
      facts(),
    );
    expect(results.map((r) => r.passed)).toEqual([true, false]);
    expect(evaluateConditions([], facts())).toEqual([]);
  });
});

describe("triggers", () => {
  const trigger = (t: Partial<AutomationTrigger>): AutomationTrigger => ({
    event: "feedback_created",
    toStatuses: [],
    labelId: null,
    ...t,
  });

  it("matches only its own event", () => {
    expect(triggerMatches(trigger({}), facts())).toBe(true);
    expect(triggerMatches(trigger({ event: "comment_added" }), facts())).toBe(false);
  });

  it("filters status changes by the new status", () => {
    const t = trigger({ event: "status_changed", toStatuses: ["resolved"] });
    expect(triggerMatches(t, facts({ event: "status_changed", toStatus: "resolved" }))).toBe(true);
    expect(triggerMatches(t, facts({ event: "status_changed", toStatus: "open" }))).toBe(false);
    const any = trigger({ event: "status_changed" });
    expect(triggerMatches(any, facts({ event: "status_changed", toStatus: "open" }))).toBe(true);
  });

  it("filters label additions by label", () => {
    const t = trigger({ event: "label_added", labelId: "l1" });
    expect(triggerMatches(t, facts({ event: "label_added", addedLabelIds: ["l1"] }))).toBe(true);
    expect(triggerMatches(t, facts({ event: "label_added", addedLabelIds: ["l2"] }))).toBe(false);
    const any = trigger({ event: "label_added" });
    expect(triggerMatches(any, facts({ event: "label_added", addedLabelIds: ["l2"] }))).toBe(true);
  });
});

describe("helpers", () => {
  it("reads the domain of an address", () => {
    expect(emailDomain("Jo@Acme.com")).toBe("acme.com");
    expect(emailDomain("nope")).toBeNull();
    expect(emailDomain(null)).toBeNull();
  });

  it("names the browser family, Edge and Opera before Chrome", () => {
    expect(browserFamily("Mozilla/5.0 Chrome/120.0 Safari/537.36 Edg/120.0")).toBe("Edge");
    expect(browserFamily("Mozilla/5.0 Chrome/120.0 Safari/537.36 OPR/105")).toBe("Opera");
    expect(browserFamily("Mozilla/5.0 Chrome/120.0 Safari/537.36")).toBe("Chrome");
    expect(browserFamily("Mozilla/5.0 Firefox/121.0")).toBe("Firefox");
    expect(browserFamily("Mozilla/5.0 Version/17 Safari/605.1.15")).toBe("Safari");
    expect(browserFamily("curl/8")).toBeNull();
  });

  it("rotates a sorted pool and survives a negative cursor", () => {
    const pool = ["c", "a", "b"];
    expect([0, 1, 2, 3, 4].map((i) => roundRobinPick(pool, i))).toEqual(["a", "b", "c", "a", "b"]);
    expect(roundRobinPick([], 3)).toBeNull();
    expect(roundRobinPick(pool, -1)).toBe("c");
  });

  it("marks rule actors", () => {
    expect(isRuleActor(ruleActorId("r1"))).toBe(true);
    expect(isRuleActor("ai")).toBe(false);
    expect(isRuleActor(null)).toBe(false);
  });
});
