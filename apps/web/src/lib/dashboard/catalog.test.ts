import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/en";
import {
  addWidget,
  defaultLayout,
  moveWidget,
  normaliseLayout,
  nudgeWidget,
  removeWidget,
  resizeWidget,
  SCOPES,
  startsCollapsed,
  WIDGET_IDS,
  WIDGETS,
  widgetsFor,
} from "./catalog";
import { parseStored } from "./storage";

describe("catalogue", () => {
  it("has a translated title and description for every widget", () => {
    for (const id of WIDGET_IDS) {
      expect(en).toHaveProperty([WIDGETS[id].title]);
      expect(en).toHaveProperty([WIDGETS[id].description]);
    }
  });

  it("offers each widget's own default width", () => {
    for (const id of WIDGET_IDS) expect(WIDGETS[id].spans).toContain(WIDGETS[id].w);
  });

  it("starts every screen from widgets that fit it, without repeats", () => {
    for (const scope of SCOPES) {
      for (const role of [undefined, "admin", "editor", "viewer"] as const) {
        const ids = defaultLayout(scope, role).slots.map((s) => s.id);
        expect(new Set(ids).size).toBe(ids.length);
        const allowed = widgetsFor(scope).map((w) => w.id);
        for (const id of ids) expect(allowed).toContain(id);
      }
    }
  });

  it("gives Admins the workspace view and members their own work", () => {
    expect(defaultLayout("home", "admin").slots.map((s) => s.id)).toContain("list.projects");
    expect(defaultLayout("home", "editor").slots.map((s) => s.id)).toContain("kpi.mine");
    expect(defaultLayout("project").slots.map((s) => s.id)).not.toContain("list.projects");
    expect(startsCollapsed("inbox")).toBe(true);
    expect(startsCollapsed("home")).toBe(false);
  });
});

describe("normaliseLayout", () => {
  it("falls back to the default for anything unreadable", () => {
    const d = defaultLayout("home", "admin");
    expect(normaliseLayout(null, "home", "admin")).toEqual(d);
    expect(normaliseLayout({ v: 2, slots: [] }, "home", "admin")).toEqual(d);
    expect(normaliseLayout({ v: 1, slots: "nope" }, "home", "admin")).toEqual(d);
  });

  it("drops unknown, duplicate and misplaced widgets and snaps bad sizes", () => {
    const l = normaliseLayout(
      {
        v: 1,
        days: 30,
        slots: [
          { id: "kpi.active", w: 4, h: 1 },
          { id: "kpi.active", w: 6, h: 1 },
          { id: "nope", w: 3, h: 1 },
          { id: "list.projects", w: 6, h: 3 },
          { id: "chart.trend", w: 5, h: 9 },
        ],
      },
      "project",
    );
    expect(l.slots).toEqual([
      { id: "kpi.active", w: 4, h: 1 },
      { id: "chart.trend", w: 8, h: 2 },
    ]);
    expect(l.days).toBe(30);
  });

  it("keeps an emptied dashboard empty (it is a choice, not damage)", () => {
    expect(normaliseLayout({ v: 1, days: 14, slots: [] }, "home").slots).toEqual([]);
  });
});

describe("edits", () => {
  const base = defaultLayout("inbox");
  const ids = (l: typeof base) => l.slots.map((s) => s.id);

  it("adds a widget once and removes it", () => {
    const added = addWidget(base, "chart.status");
    expect(ids(added).at(-1)).toBe("chart.status");
    expect(addWidget(added, "chart.status")).toBe(added);
    expect(ids(removeWidget(added, "chart.status"))).toEqual(ids(base));
  });

  it("moves a widget to another's place and nudges by one", () => {
    expect(ids(moveWidget(base, "kpi.overdue", "kpi.active"))[0]).toBe("kpi.overdue");
    expect(ids(nudgeWidget(base, "kpi.active", 1))).toEqual([
      "kpi.mine",
      "kpi.active",
      "kpi.unassigned",
      "kpi.overdue",
    ]);
    expect(nudgeWidget(base, "kpi.active", -1)).toBe(base);
  });

  it("resizes only to sizes the widget offers", () => {
    const wide = resizeWidget(base, "kpi.active", { w: 6 });
    expect(wide.slots[0]?.w).toBe(6);
    expect(resizeWidget(base, "kpi.active", { w: 12 }).slots[0]?.w).toBe(3);
  });
});

describe("parseStored", () => {
  it("reads a saved layout and survives corrupt JSON", () => {
    const saved = JSON.stringify({ ...defaultLayout("home"), days: 90 });
    expect(parseStored(saved, "home").days).toBe(90);
    expect(parseStored("{oops", "home")).toEqual(defaultLayout("home"));
    expect(parseStored(null, "home", "admin")).toEqual(defaultLayout("home", "admin"));
  });
});
