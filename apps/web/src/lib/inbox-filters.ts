import { FEEDBACK_KINDS, FEEDBACK_STATUSES, PRIORITIES, type ViewFilters, viewFilters } from "@pinwren/core";

// The inbox's filters live in the URL (deep links, back/forward, the server can read them), with short
// parameter names. Server components and client components parse them with the same function, so the
// list a server component prefetches is exactly the one the client asks for.

/** URL parameter → `ViewFilters` field (the API's list query, wave-4 contract §2, wave-5 §2). */
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
  label: "labelId",
  reporter: "reporter",
  review: "reviewLinkId",
  sort: "sort",
  order: "order",
} as const satisfies Record<string, keyof ViewFilters>;

type Param = keyof typeof FILTER_PARAMS;
const PARAMS = Object.keys(FILTER_PARAMS) as Param[];

/** Filters that narrow the list (the chips and the "Filter" badge); not the project, status tab or order. */
export const NARROWING_PARAMS = [
  "kind",
  "priority",
  "round",
  "assignee",
  "page",
  "since",
  "label",
  "reporter",
  "review",
  "q",
] as const satisfies readonly Param[];

export type InboxLayout = "list" | "board";

/** Rows per request: one page of the infinite list. The board asks for more at once. */
export const LIST_PAGE_SIZE = 50;
export const BOARD_PAGE_SIZE = 100;

/** The list query the inbox runs: every filter the URL names, `status` always set. */
export type FeedbackListArgs = ViewFilters & {
  status: NonNullable<ViewFilters["status"]>;
  limit: number;
  /** The trash (Admins): deleted items instead of live ones. */
  trash?: true;
};

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

/** `?trash=1`: the trash view (the API refuses it for non-Admins). */
export const trashFromParams = (sp: Readable) => sp.get("trash") === "1";

/** The list request for these filters. The board and the trash show every status. */
export function listArgs(filters: ViewFilters, layout: InboxLayout, trash = false): FeedbackListArgs {
  const args: FeedbackListArgs = {
    ...filters,
    status: filters.status ?? "active",
    limit: layout === "board" ? BOARD_PAGE_SIZE : LIST_PAGE_SIZE,
  };
  if (layout === "board" || trash) args.status = "all";
  if (trash) args.trash = true;
  return args;
}

export const inboxArgsFromParams = (sp: Readable) =>
  listArgs(filtersFromParams(sp), layoutFromParams(sp), trashFromParams(sp));

/** `?projectId=…&status=…` for `GET /api/feedback` (keys sorted, so equal filters give equal strings). */
export function listQueryString(args: Record<string, string | number | boolean | undefined>): string {
  const sp = new URLSearchParams();
  for (const k of Object.keys(args).sort()) {
    const v = args[k];
    if (v !== undefined && v !== "" && v !== false) sp.set(k, String(v));
  }
  return sp.toString();
}

/**
 * `GET /api/feedback/export` for the current list: the same filters without paging, in `format`, and
 * only `ids` when given ("Export selected", every status).
 */
export function exportUrl(
  args: FeedbackListArgs,
  format: "csv" | "json" | "pdf",
  ids?: readonly string[],
): string {
  const { limit: _limit, ...filters } = args;
  const query = ids?.length ? { ...filters, status: "all", ids: ids.join(",") } : filters;
  return `/api/feedback/export?${listQueryString({ ...query, format })}`;
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

/** How many filters beyond the project, the status tab, search and order are on (the "Filter" badge). */
export const extraFilterCount = (f: ViewFilters) =>
  [
    f.kind,
    f.priority,
    f.roundId,
    f.assigneeId,
    f.page,
    f.since,
    f.labelId,
    f.reporter,
    f.reviewLinkId,
  ].filter(Boolean).length;

/** URL changes that clear every narrowing filter (and search), keeping project, status and order. */
export const CLEAR_FILTERS: Record<(typeof NARROWING_PARAMS)[number] | "item", null> = {
  kind: null,
  priority: null,
  round: null,
  assignee: null,
  page: null,
  since: null,
  label: null,
  reporter: null,
  review: null,
  q: null,
  item: null,
};

export const KIND_VALUES = FEEDBACK_KINDS;
export const PRIORITY_VALUES = PRIORITIES;
export const STATUS_VALUES = FEEDBACK_STATUSES;
