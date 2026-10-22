import { FEEDBACK_KINDS, FEEDBACK_STATUSES, PRIORITIES, type ViewFilters, viewFilters } from "@pinwren/core";

// The inbox's filters live in the URL (deep links, back/forward, the server can read them), with short
// parameter names. Server components and client components parse them with the same function, so the
// list a server component prefetches is exactly the one the client asks for.

/** URL parameter → `ViewFilters` field (the API's list query, wave-4 contract §2). */
export const FILTER_PARAMS = {
  project: "projectId",
  status: "status",
  kind: "kind",
  q: "q",
  priority: "priority",
  round: "roundId",
  assignee: "assigneeId",
  page: "page",
  since: "since",
} as const satisfies Record<string, keyof ViewFilters>;

type Param = keyof typeof FILTER_PARAMS;
const PARAMS = Object.keys(FILTER_PARAMS) as Param[];

export type InboxLayout = "list" | "board";

/** The list query the inbox runs: every filter the URL names, `status` always set. */
export type FeedbackListArgs = ViewFilters & { status: NonNullable<ViewFilters["status"]>; limit: number };

type Readable = { get: (name: string) => string | null };

/** Filters from search params; invalid values are dropped (a hand-edited URL never breaks the inbox). */
export function filtersFromParams(sp: Readable): ViewFilters {
  const out: ViewFilters = {};
  for (const param of PARAMS) {
    const v = sp.get(param);
    if (v === null || v === "") continue;
    const field = FILTER_PARAMS[param];
    if (viewFilters.shape[field].safeParse(v).success) Object.assign(out, { [field]: v });
  }
  return out;
}

export function layoutFromParams(sp: Readable): InboxLayout {
  // `view=board` is the wave-2 spelling, still accepted for old links.
  const v = sp.get("layout") ?? sp.get("view");
  return v === "board" ? "board" : "list";
}

/** The list request for these filters. The board shows every status, so it ignores the status tab. */
export function listArgs(filters: ViewFilters, layout: InboxLayout): FeedbackListArgs {
  const args: FeedbackListArgs = { ...filters, status: filters.status ?? "active", limit: 100 };
  if (layout === "board") args.status = "all";
  return args;
}

export const inboxArgsFromParams = (sp: Readable) => listArgs(filtersFromParams(sp), layoutFromParams(sp));

/** `?projectId=…&status=…` for `GET /api/feedback` (keys sorted, so equal filters give equal strings). */
export function listQueryString(args: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const k of Object.keys(args).sort()) {
    const v = args[k];
    if (v !== undefined && v !== "") sp.set(k, String(v));
  }
  return sp.toString();
}

/** Search params for the inbox URL that show `filters` (and the layout, when it's the board). */
export function paramsForFilters(filters: ViewFilters, layout: InboxLayout = "list"): URLSearchParams {
  const sp = new URLSearchParams();
  for (const param of PARAMS) {
    const v = filters[FILTER_PARAMS[param]];
    if (v !== undefined && v !== "") sp.set(param, v);
  }
  if (layout === "board") sp.set("layout", "board");
  return sp;
}

/** True when two filter sets ask for the same items (e.g. "has this saved view been changed?"). */
export function sameFilters(a: ViewFilters, b: ViewFilters): boolean {
  return PARAMS.every((p) => (a[FILTER_PARAMS[p]] ?? "") === (b[FILTER_PARAMS[p]] ?? ""));
}

/** How many filters beyond the project and the status tab are on (the "Filter" button's badge). */
export const extraFilterCount = (f: ViewFilters) =>
  [f.kind, f.priority, f.roundId, f.assigneeId, f.page, f.since].filter(Boolean).length;

export const KIND_VALUES = FEEDBACK_KINDS;
export const PRIORITY_VALUES = PRIORITIES;
export const STATUS_VALUES = FEEDBACK_STATUSES;
