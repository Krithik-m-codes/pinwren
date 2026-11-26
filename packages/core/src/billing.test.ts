import { describe, expect, it } from "vitest";
import {
  BILLING_PLANS,
  DUNNING_GRACE_DAYS,
  effectivePlan,
  overLimitProjectIds,
  reportQuota,
  type SubscriptionState,
} from "./billing";

const now = new Date("2026-11-01T12:00:00Z");
const base: SubscriptionState = {
  plan: "pro",
  interval: "monthly",
  status: "active",
  currentPeriodEnd: null,
  pastDueSince: null,
};
const days = (n: number) => new Date(now.getTime() - n * 86_400_000);

describe("effectivePlan", () => {
  it("is free without a subscription", () => {
    expect(effectivePlan(null, now)).toEqual({ plan: "free", dunning: null });
  });

  it("is pro while active", () => {
    expect(effectivePlan(base, now).plan).toBe("pro");
  });

  it("keeps pro during the dunning grace and reports the deadline", () => {
    const r = effectivePlan({ ...base, status: "past_due", pastDueSince: days(3) }, now);
    expect(r.plan).toBe("pro");
    expect(r.dunning?.daysLeft).toBe(DUNNING_GRACE_DAYS - 3);
  });

  it("downgrades to free once the grace has passed", () => {
    const r = effectivePlan({ ...base, status: "on_hold", pastDueSince: days(DUNNING_GRACE_DAYS + 1) }, now);
    expect(r.plan).toBe("free");
    expect(r.dunning?.daysLeft).toBe(0);
  });

  it("keeps pro after cancellation until the paid period ends", () => {
    const future = new Date(now.getTime() + 5 * 86_400_000);
    expect(effectivePlan({ ...base, status: "cancelled", currentPeriodEnd: future }, now).plan).toBe("pro");
    expect(effectivePlan({ ...base, status: "cancelled", currentPeriodEnd: days(1) }, now).plan).toBe("free");
    expect(effectivePlan({ ...base, status: "cancelled" }, now).plan).toBe("free");
  });

  it("is free for expired, failed and not-yet-paid subscriptions", () => {
    for (const status of ["expired", "failed", "pending", "none"] as const)
      expect(effectivePlan({ ...base, status }, now).plan).toBe("free");
  });
});

describe("reportQuota", () => {
  const limit = BILLING_PLANS.free.limits.reportsPerMonth ?? 100;
  it("allows below the limit, warns at 100% and blocks at 120%", () => {
    expect(reportQuota(limit - 1, limit)).toBe("ok");
    expect(reportQuota(limit, limit)).toBe("soft");
    expect(reportQuota(Math.floor(limit * 1.2) - 1, limit)).toBe("soft");
    expect(reportQuota(Math.floor(limit * 1.2), limit)).toBe("blocked");
  });
  it("never limits when there is no limit", () => {
    expect(reportQuota(10 ** 9, null)).toBe("ok");
  });
});

describe("overLimitProjectIds", () => {
  const at = (n: number) => new Date(Date.UTC(2026, 0, n));
  const projects = [
    { id: "c", createdAt: at(3) },
    { id: "a", createdAt: at(1) },
    { id: "b", createdAt: at(2) },
  ];

  it("keeps the oldest projects writable and marks the rest read-only", () => {
    expect([...overLimitProjectIds(projects, 1)].sort()).toEqual(["b", "c"]);
    expect([...overLimitProjectIds(projects, 2)]).toEqual(["c"]);
  });

  it("marks nothing at or under the limit, or without one", () => {
    expect(overLimitProjectIds(projects, 3).size).toBe(0);
    expect(overLimitProjectIds(projects, 10).size).toBe(0);
    expect(overLimitProjectIds(projects, null).size).toBe(0);
  });

  it("breaks creation-time ties by id so the answer is stable", () => {
    const tied = [
      { id: "z", createdAt: at(1) },
      { id: "m", createdAt: at(1) },
    ];
    expect([...overLimitProjectIds(tied, 1)]).toEqual(["z"]);
    expect([...overLimitProjectIds([...tied].reverse(), 1)]).toEqual(["z"]);
  });

  it("a limit of zero makes every project read-only", () => {
    expect(overLimitProjectIds(projects, 0).size).toBe(3);
  });
});

describe("plan table", () => {
  it("Business sits above Pro on every limit and price", () => {
    const { pro, business } = BILLING_PLANS;
    expect(business.limits.seats).toBeGreaterThan(pro.limits.seats ?? 0);
    expect(business.limits.projects).toBeNull(); // unlimited
    expect(business.limits.reportsPerMonth).toBeGreaterThan(pro.limits.reportsPerMonth ?? 0);
    expect(business.price?.monthly).toBeGreaterThan(pro.price?.monthly ?? 0);
    // Annual billing is always the cheaper per-month rate.
    for (const p of [pro, business]) expect(p.price?.annualPerMonth).toBeLessThan(p.price?.monthly ?? 0);
  });

  it("a paid plan in force keeps its own plan through the grace and drops to free after it", () => {
    const biz: SubscriptionState = { ...base, plan: "business", status: "past_due", pastDueSince: days(2) };
    expect(effectivePlan(biz, now).plan).toBe("business");
    expect(effectivePlan({ ...biz, pastDueSince: days(DUNNING_GRACE_DAYS + 1) }, now).plan).toBe("free");
  });
});
