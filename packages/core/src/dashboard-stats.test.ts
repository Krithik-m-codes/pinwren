import { describe, expect, it } from "vitest";
import { dashboardStatsQuery, fillSeries } from "./dashboard-stats";

describe("dashboardStatsQuery", () => {
  it("defaults to 14 days and accepts the offered ranges only", () => {
    expect(dashboardStatsQuery.parse({}).days).toBe(14);
    expect(dashboardStatsQuery.parse({ days: "90" }).days).toBe(90);
    expect(dashboardStatsQuery.safeParse({ days: "5" }).success).toBe(false);
    expect(dashboardStatsQuery.safeParse({ projectId: "nope" }).success).toBe(false);
  });
});

describe("fillSeries", () => {
  it("returns one zero-filled UTC day per step, oldest first, ending today", () => {
    const now = new Date("2026-11-02T10:00:00Z");
    const s = fillSeries([{ date: "2026-11-01", created: 3, resolved: 1 }], 3, now);
    expect(s).toEqual([
      { date: "2026-10-31", created: 0, resolved: 0 },
      { date: "2026-11-01", created: 3, resolved: 1 },
      { date: "2026-11-02", created: 0, resolved: 0 },
    ]);
  });
});
