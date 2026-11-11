import { describe, expect, it } from "vitest";
import { dashboardStatsQuery, statsWindow } from "./dashboard-stats";
import {
  dashboardCreate,
  dashboardLayout,
  mergeUiState,
  readUiState,
  uiStateUpdate,
  workspacePreferenceUpdate,
} from "./dashboards";

describe("dashboard layouts", () => {
  const parse = (raw: unknown) => dashboardLayout.safeParse(raw);

  it("keeps well-formed slots in order and drops malformed, repeated and oversized ones", () => {
    const ok = parse({
      v: 1,
      days: 14,
      slots: [
        { id: "kpi.active", w: 3, h: 1 },
        { id: "kpi.active", w: 4, h: 1 },
        { id: "nonsense", w: 3, h: 1 },
        { id: "chart.trend", w: 5, h: 2 },
        { id: "chart.status", w: 4, h: 4 },
        { id: "list.recent", w: 6, h: 3 },
        7,
      ],
    });
    expect(ok.success && ok.data.slots).toEqual([
      { id: "kpi.active", w: 3, h: 1 },
      { id: "list.recent", w: 6, h: 3 },
    ]);
    const many = Array.from({ length: 80 }, (_, i) => ({ id: `kpi.w${i}`, w: 3, h: 1 }));
    const capped = parse({ v: 1, days: 7, slots: many });
    expect(capped.success && capped.data.slots).toHaveLength(40);
  });

  it("rejects anything that is not a v1 layout with a known range", () => {
    expect(parse(null).success).toBe(false);
    expect(parse({ v: 2, days: 7, slots: [] }).success).toBe(false);
    expect(parse({ v: 1, days: 5, slots: [] }).success).toBe(false);
    expect(parse({ v: 1, days: 7 }).success).toBe(false);
    expect(parse({ v: 1, days: 90, slots: [] }).success).toBe(true);
  });

  it("validates a create request", () => {
    const layout = { v: 1, days: 14, slots: [] };
    expect(dashboardCreate.safeParse({ scope: "home", name: "  Triage ", layout }).data?.name).toBe("Triage");
    expect(dashboardCreate.safeParse({ scope: "nowhere", name: "x", layout }).success).toBe(false);
    expect(dashboardCreate.safeParse({ scope: "home", name: "", layout }).success).toBe(false);
    expect(
      dashboardCreate.safeParse({
        scope: "home",
        name: "x",
        layout,
        shared: true,
        defaultRoles: ["admin", "root"],
      }).success,
    ).toBe(false);
  });
});

describe("workspace and account state", () => {
  it("accepts a partial map of defaults and caps the pinned projects", () => {
    const id = "b3c1b2c0-5d1e-4c3a-9a77-0f6b1f0d9a11";
    expect(workspacePreferenceUpdate.safeParse({ dashboardDefaults: { home: id } }).success).toBe(true);
    expect(workspacePreferenceUpdate.safeParse({ dashboardDefaults: { home: null } }).success).toBe(true);
    expect(workspacePreferenceUpdate.safeParse({ dashboardDefaults: { home: "x" } }).success).toBe(false);
    expect(workspacePreferenceUpdate.safeParse({ pinnedProjectIds: Array(13).fill(id) }).success).toBe(false);
  });

  it("reads a stored ui_state defensively and merges patches without losing other keys", () => {
    expect(readUiState(null).startPage).toBeNull();
    expect(readUiState({ startPage: "elsewhere", nudges: "x" }).nudges.supportOptOut).toBe(false);
    const current = readUiState({
      startPage: "dashboard",
      nudges: { dismissedUpdate: "v1", supportOptOut: true },
    });
    const next = mergeUiState(current, { nudges: { supportSnoozedUntil: "2026-12-01T00:00:00.000Z" } });
    expect(next).toEqual({
      startPage: "dashboard",
      nudges: {
        firstSeen: null,
        dismissedUpdate: "v1",
        supportSnoozedUntil: "2026-12-01T00:00:00.000Z",
        supportOptOut: true,
      },
    });
    expect(mergeUiState(next, { nudges: { dismissedUpdate: null } }).nudges.dismissedUpdate).toBeNull();
    expect(uiStateUpdate.safeParse({ startPage: "inbox" }).success).toBe(true);
    expect(uiStateUpdate.safeParse({ startPage: "nope" }).success).toBe(false);
  });
});

describe("stats query", () => {
  const q = (o: Record<string, unknown>) => dashboardStatsQuery.safeParse(o);

  it("keeps the old shape working and adds label, assignee and an explicit range", () => {
    expect(q({}).data?.days).toBe(14);
    expect(q({ days: "30" }).data?.days).toBe(30);
    expect(q({ labelId: "b3c1b2c0-5d1e-4c3a-9a77-0f6b1f0d9a11", assigneeId: "me" }).success).toBe(true);
    expect(q({ labelId: "nope" }).success).toBe(false);
    expect(q({ from: "2026-03-01", to: "2026-03-31" }).success).toBe(true);
  });

  it("refuses a range that is reversed, open-ended at the start, malformed or too long", () => {
    expect(q({ to: "2026-03-01" }).success).toBe(false);
    expect(q({ from: "2026-03-02", to: "2026-03-01" }).success).toBe(false);
    expect(q({ from: "2026-3-1" }).success).toBe(false);
    expect(q({ from: "2026-13-40" }).success).toBe(false);
    expect(q({ from: "2024-01-01", to: "2026-01-01" }).success).toBe(false);
  });

  it("derives the window: last N days, or whole UTC days from..to", () => {
    const now = new Date("2026-06-10T12:00:00Z");
    expect(statsWindow({ days: 7 }, now)).toEqual({
      since: new Date("2026-06-03T12:00:00Z"),
      until: null,
      days: 7,
    });
    expect(statsWindow({ days: 14, from: "2026-06-01", to: "2026-06-03" }, now)).toEqual({
      since: new Date("2026-06-01T00:00:00Z"),
      until: new Date("2026-06-04T00:00:00Z"),
      days: 3,
    });
    expect(statsWindow({ days: 14, from: "2026-06-08" }, now)).toMatchObject({ until: null, days: 3 });
  });
});
