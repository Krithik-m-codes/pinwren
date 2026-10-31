import { describe, expect, it } from "vitest";
import {
  BILLING_PLANS,
  DUNNING_GRACE_DAYS,
  effectivePlan,
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
