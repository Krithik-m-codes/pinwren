import type { StatsArgs } from "@/lib/store/api/stats";

// The dashboard-wide filter bar (ADR 0029): project, label, assignee and a date range, kept in the URL of the
// home dashboard so a filtered view can be linked. They narrow every widget through `/api/stats`.

export type DashFilters = {
  projectId?: string;
  labelId?: string;
  /** `me`, `none` (unassigned) or a member id. */
  assigneeId?: string;
  /** UTC dates, inclusive. `to` only with `from`. */
  from?: string;
  to?: string;
};

/** URL parameter of each filter. */
export const FILTER_PARAMS = {
  projectId: "project",
  labelId: "label",
  assigneeId: "assignee",
  from: "from",
  to: "to",
} as const satisfies Record<keyof DashFilters, string>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (s: string | null): s is string =>
  !!s && DAY.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/** Filters from a query string; anything malformed is ignored rather than sent to the API. */
export function parseFilters(params: Pick<URLSearchParams, "get">): DashFilters {
  const out: DashFilters = {};
  const project = params.get(FILTER_PARAMS.projectId);
  if (project && UUID.test(project)) out.projectId = project;
  const label = params.get(FILTER_PARAMS.labelId);
  if (label && UUID.test(label)) out.labelId = label;
  const assignee = params.get(FILTER_PARAMS.assigneeId);
  if (assignee && assignee.length <= 100) out.assigneeId = assignee;
  const from = params.get(FILTER_PARAMS.from);
  const to = params.get(FILTER_PARAMS.to);
  if (validDay(from)) {
    out.from = from;
    if (validDay(to) && to >= from) out.to = to;
  }
  return out;
}

/** A change to the filters as a patch for `useUrlParams().setParams` (null clears a parameter). */
export function filtersPatch(patch: { [K in keyof DashFilters]?: string | null }): Record<
  string,
  string | null
> {
  const out: Record<string, string | null> = {};
  for (const key of Object.keys(FILTER_PARAMS) as (keyof DashFilters)[]) {
    if (key in patch) out[FILTER_PARAMS[key]] = patch[key] ?? null;
  }
  // Labels belong to a project: changing the project drops a label picked under the old one.
  if ("projectId" in patch) out[FILTER_PARAMS.labelId] = "labelId" in patch ? (patch.labelId ?? null) : null;
  if ("from" in patch && !patch.from) out[FILTER_PARAMS.to] = null;
  return out;
}

export const hasFilters = (f: DashFilters) => Object.keys(f).length > 0;

/** The stats request for a layout's range and the active filters (an explicit range wins over `days`). */
export function statsArgs(days: StatsArgs["days"], f: DashFilters, scopeProjectId?: string): StatsArgs {
  const projectId = scopeProjectId ?? f.projectId;
  return {
    days,
    ...(projectId ? { projectId } : {}),
    ...(f.labelId ? { labelId: f.labelId } : {}),
    ...(f.assigneeId ? { assigneeId: f.assigneeId } : {}),
    ...(f.from ? { from: f.from, ...(f.to ? { to: f.to } : {}) } : {}),
  };
}

/** `2026-03-01` as a local date at midnight (for the calendar), and back. */
export const dayToDate = (day: string) =>
  new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
export const dateToDay = (d: Date) =>
  `${String(d.getFullYear()).padStart(4, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
