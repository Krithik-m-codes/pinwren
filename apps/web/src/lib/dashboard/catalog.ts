import type { AppRole } from "@pinwren/core";
import type { Key } from "@/lib/i18n/en";

// The widget catalogue behind every dashboard: what exists, how wide it may be, and which screens it fits.
// Pure data (no React) so layouts can be normalised and unit-tested; the components live in
// components/dashboard/widgets.tsx and are looked up by the same id.

/** A dashboard surface. `home` is the full page; the others are the compact overview strip of a screen. */
export const SCOPES = ["home", "inbox", "projects", "project", "notifications"] as const;
export type Scope = (typeof SCOPES)[number];

export const WIDGET_IDS = [
  "kpi.active",
  "kpi.created",
  "kpi.resolved",
  "kpi.unassigned",
  "kpi.overdue",
  "kpi.mine",
  "kpi.urgent",
  "kpi.resolution",
  "chart.trend",
  "chart.status",
  "chart.kind",
  "chart.priority",
  "chart.projects",
  "list.recent",
  "list.projects",
  "list.attention",
] as const;
export type WidgetId = (typeof WIDGET_IDS)[number];

/** Column spans on the 12-column grid. */
export const SPANS = [3, 4, 6, 8, 12] as const;
export type Span = (typeof SPANS)[number];
/** Height in grid rows (a tile is 1, a chart 2, a list 3). */
export const HEIGHTS = [1, 2, 3] as const;
export type Height = (typeof HEIGHTS)[number];

export type WidgetKind = "kpi" | "chart" | "list";

export type WidgetDef = {
  id: WidgetId;
  kind: WidgetKind;
  title: Key;
  description: Key;
  w: Span;
  h: Height;
  /** Sizes the picker offers. */
  spans: readonly Span[];
  /** Screens it fits. */
  scopes: readonly Scope[];
};

const ALL: readonly Scope[] = SCOPES;
const NOT_PROJECT: readonly Scope[] = ["home", "inbox", "projects", "notifications"];
const TILE: readonly Span[] = [3, 4, 6];

function def(
  id: WidgetId,
  kind: WidgetKind,
  name: string,
  w: Span,
  h: Height,
  spans: readonly Span[],
  scopes: readonly Scope[],
): WidgetDef {
  return {
    id,
    kind,
    title: `dash.w.${name}` as Key,
    description: `dash.w.${name}Hint` as Key,
    w,
    h,
    spans,
    scopes,
  };
}

export const WIDGETS: Record<WidgetId, WidgetDef> = {
  "kpi.active": def("kpi.active", "kpi", "active", 3, 1, TILE, ALL),
  "kpi.created": def("kpi.created", "kpi", "created", 3, 1, TILE, ALL),
  "kpi.resolved": def("kpi.resolved", "kpi", "resolved", 3, 1, TILE, ALL),
  "kpi.unassigned": def("kpi.unassigned", "kpi", "unassigned", 3, 1, TILE, ALL),
  "kpi.overdue": def("kpi.overdue", "kpi", "overdue", 3, 1, TILE, ALL),
  "kpi.mine": def("kpi.mine", "kpi", "mine", 3, 1, TILE, ALL),
  "kpi.urgent": def("kpi.urgent", "kpi", "urgent", 3, 1, TILE, ALL),
  "kpi.resolution": def("kpi.resolution", "kpi", "resolution", 3, 1, TILE, ALL),
  "chart.trend": def("chart.trend", "chart", "trend", 8, 2, [6, 8, 12], ALL),
  "chart.status": def("chart.status", "chart", "status", 4, 2, [4, 6, 8], ALL),
  "chart.kind": def("chart.kind", "chart", "kind", 4, 2, [4, 6, 8], ALL),
  "chart.priority": def("chart.priority", "chart", "priority", 4, 2, [4, 6, 8], ALL),
  "chart.projects": def("chart.projects", "chart", "byProject", 4, 2, [4, 6, 8, 12], NOT_PROJECT),
  "list.recent": def("list.recent", "list", "recent", 4, 3, [4, 6, 8, 12], ALL),
  "list.projects": def("list.projects", "list", "projects", 6, 3, [6, 8, 12], NOT_PROJECT),
  "list.attention": def("list.attention", "list", "attention", 4, 2, [4, 6, 8, 12], ALL),
};

/** Widgets that may appear on a screen. */
export const widgetsFor = (scope: Scope): WidgetDef[] =>
  WIDGET_IDS.map((id) => WIDGETS[id]).filter((w) => w.scopes.includes(scope));

export type Slot = { id: WidgetId; w: Span; h: Height };
export type Range = 7 | 14 | 30 | 90;
export type Layout = { v: 1; slots: Slot[]; days: Range };

/** Whether an overview strip starts folded to its title row (the inbox does, to keep its height). */
export const startsCollapsed = (scope: Scope) => scope === "inbox";

const slot = (id: WidgetId, patch: Partial<Slot> = {}): Slot => {
  const d = WIDGETS[id];
  return { id, w: d.w, h: d.h, ...patch };
};

/**
 * The layout a person starts from: Admins see the whole workspace (projects, trends); members what is on
 * their plate; Viewers the read-only picture. Overview strips stay to one row of tiles so the screen
 * below keeps the room.
 */
export function defaultLayout(scope: Scope, role?: AppRole): Layout {
  const admin = role === "admin";
  const make = (slots: Slot[]): Layout => ({ v: 1, days: 14, slots });
  const s = (...ids: WidgetId[]) => ids.map((id) => slot(id));
  switch (scope) {
    case "home":
      return make(
        s(
          "kpi.active",
          admin ? "kpi.unassigned" : "kpi.mine",
          "kpi.overdue",
          "kpi.resolved",
          "chart.trend",
          "chart.status",
          admin ? "list.projects" : "list.attention",
          "list.recent",
        ),
      );
    case "inbox":
      return make(s("kpi.active", "kpi.mine", "kpi.unassigned", "kpi.overdue"));
    case "projects":
      return make([...s("kpi.active", "kpi.created", "kpi.resolved"), slot("chart.trend", { w: 3, h: 1 })]);
    case "project":
      return make(s("kpi.active", "kpi.created", "kpi.resolved", "kpi.resolution"));
    case "notifications":
      return make(s("kpi.mine", "kpi.urgent", "kpi.overdue", "kpi.unassigned"));
  }
}

const isSpan = (n: unknown): n is Span => (SPANS as readonly unknown[]).includes(n);
const isHeight = (n: unknown): n is Height => (HEIGHTS as readonly unknown[]).includes(n);
const isRange = (n: unknown): n is Range => n === 7 || n === 14 || n === 30 || n === 90;

/**
 * Stored layouts outlive releases: unknown widgets are dropped, bad sizes snap to the widget's default,
 * duplicates collapse, and widgets that no longer fit the screen go. Anything unreadable gives the default.
 */
export function normaliseLayout(raw: unknown, scope: Scope, role?: AppRole): Layout {
  const fallback = defaultLayout(scope, role);
  if (!raw || typeof raw !== "object") return fallback;
  const r = raw as { v?: unknown; slots?: unknown; days?: unknown };
  if (r.v !== 1 || !Array.isArray(r.slots)) return fallback;
  const seen = new Set<string>();
  const slots: Slot[] = [];
  for (const s of r.slots as unknown[]) {
    if (!s || typeof s !== "object") continue;
    const { id, w, h } = s as { id?: unknown; w?: unknown; h?: unknown };
    if (typeof id !== "string" || !(WIDGET_IDS as readonly string[]).includes(id) || seen.has(id)) continue;
    const d = WIDGETS[id as WidgetId];
    if (!d.scopes.includes(scope)) continue;
    seen.add(id);
    slots.push({ id: d.id, w: isSpan(w) && d.spans.includes(w) ? w : d.w, h: isHeight(h) ? h : d.h });
  }
  return {
    v: 1,
    slots,
    days: isRange(r.days) ? r.days : fallback.days,
  };
}

// --- Edits (pure: each returns a new layout) ---------------------------------------------------------

export function addWidget(l: Layout, id: WidgetId): Layout {
  return l.slots.some((s) => s.id === id) ? l : { ...l, slots: [...l.slots, slot(id)] };
}

export function removeWidget(l: Layout, id: WidgetId): Layout {
  return { ...l, slots: l.slots.filter((s) => s.id !== id) };
}

/** Put `id` where `target` is now (drag and drop, or the move buttons). */
export function moveWidget(l: Layout, id: WidgetId, target: WidgetId): Layout {
  const from = l.slots.findIndex((s) => s.id === id);
  const to = l.slots.findIndex((s) => s.id === target);
  if (from < 0 || to < 0 || from === to) return l;
  const slots = [...l.slots];
  const [moved] = slots.splice(from, 1);
  if (!moved) return l;
  slots.splice(to, 0, moved);
  return { ...l, slots };
}

/** Step a widget one place earlier (-1) or later (+1). */
export function nudgeWidget(l: Layout, id: WidgetId, by: -1 | 1): Layout {
  const at = l.slots.findIndex((s) => s.id === id);
  const next = l.slots[at + by];
  return at < 0 || !next ? l : moveWidget(l, id, next.id);
}

export function resizeWidget(l: Layout, id: WidgetId, size: Partial<Pick<Slot, "w" | "h">>): Layout {
  const d = WIDGETS[id];
  return {
    ...l,
    slots: l.slots.map((s) =>
      s.id !== id
        ? s
        : {
            ...s,
            w: size.w && d.spans.includes(size.w) ? size.w : s.w,
            h: size.h && isHeight(size.h) ? size.h : s.h,
          },
    ),
  };
}

export const setRange = (l: Layout, days: Range): Layout => ({ ...l, days });

export const sameLayout = (a: Layout, b: Layout) => JSON.stringify(a) === JSON.stringify(b);
