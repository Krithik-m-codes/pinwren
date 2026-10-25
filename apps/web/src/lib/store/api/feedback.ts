import type { FeedbackKind, FeedbackStatus, Priority } from "@pinwren/core";
import type { InfiniteData } from "@reduxjs/toolkit/query";
import type { ThunkDispatch, UnknownAction } from "@reduxjs/toolkit";
import type { ActionResult, FeedbackDetail, FeedbackList, FeedbackRow, IssueLink, Label } from "@/lib/api";
import { type FeedbackListArgs, listQueryString } from "@/lib/inbox-filters";
import { type ApiError, LIST, fulfilled } from "./base";
import { projectsApi } from "./projects";

/** What `PATCH /api/feedback/:id` accepts (core's `feedbackUpdate`). */
export type FeedbackPatch = Partial<{
  status: FeedbackStatus;
  priority: Priority;
  assigneeIds: string[];
  title: string | null;
  roundId: string | null;
  labelIds: string[];
  dueAt: string | null;
  duplicateOfId: string | null;
  kind: FeedbackKind;
}>;

/** Fields of a list row / detail the cache may patch in place (from a PATCH or a stream event). */
export type FeedbackFields = Partial<
  Pick<FeedbackRow, "status" | "priority" | "assigneeIds" | "title" | "roundId" | "kind" | "dueAt" | "labels">
>;

/** One item's change; `optimistic` is what the cache shows meanwhile (labels need their names and colours). */
export type ItemChange = { id: string; patch: FeedbackPatch; optimistic?: FeedbackFields };

/** One patch for several items, or (bulk undo) each item's own patch. */
export type UpdateArgs =
  { ids: string[]; patch: FeedbackPatch; optimistic?: FeedbackFields } | { each: ItemChange[] };

const changesOf = (a: UpdateArgs): ItemChange[] =>
  "each" in a
    ? a.each
    : a.ids.map((id) => ({ id, patch: a.patch, ...(a.optimistic ? { optimistic: a.optimistic } : {}) }));

const ROW_FIELDS = ["status", "priority", "assigneeIds", "title", "roundId", "kind", "dueAt"] as const;

/** The row fields a patch changes (labels come as `optimistic`, the patch only has their ids). */
export function fieldsOfPatch(patch: FeedbackPatch): FeedbackFields {
  const out: Record<string, unknown> = {};
  for (const k of ROW_FIELDS) if (patch[k] !== undefined) out[k] = patch[k];
  return out;
}

/** Every row of an infinite list, in order. */
export const listItems = (data: InfiniteData<FeedbackList, string | null> | undefined): FeedbackRow[] =>
  data?.pages.flatMap((p) => p.items) ?? [];

/** Pages of a project's items for the pages view; there is no pages endpoint, so pages derive from the list. */
const MAX_PAGES_OF_FEEDBACK = 5;

/** Endpoints whose cached data contains feedback rows or a feedback item. */
const FEEDBACK_CACHES = new Set(["listFeedback", "projectFeedback", "feedbackDetail", "feedbackDetails"]);

// Any store that holds this API: the inbox store, or a listener's view of it (their RootState types differ only
// by which endpoints are injected, so they are not mutually assignable).
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
type Dispatch = ThunkDispatch<any, unknown, UnknownAction>;
type CacheEntry = { endpointName: string; originalArgs: unknown };

/**
 * Apply `fields` to every cached copy of the given items (inbox lists, the pages view, open details).
 * Returns an undo for optimistic updates. Used by mutations and by the real-time stream.
 */
export function patchCachedFeedback(
  dispatch: Dispatch,
  getState: () => unknown,
  ids: string[],
  fields: FeedbackFields | ((row: FeedbackRow) => void),
): () => void {
  const set = new Set(ids);
  const entries = feedbackApi.util.selectInvalidatedBy(
    getState() as Parameters<typeof feedbackApi.util.selectInvalidatedBy>[0],
    ids.map((id) => ({ type: "Feedback" as const, id })),
  ) as CacheEntry[];
  const undo: (() => void)[] = [];
  const patchRows = (items: FeedbackRow[]) => {
    for (const row of items) {
      if (!set.has(row.id)) continue;
      if (typeof fields === "function") fields(row);
      else Object.assign(row, fields);
    }
  };
  for (const e of entries) {
    if (!FEEDBACK_CACHES.has(e.endpointName)) continue;
    if (e.endpointName === "listFeedback") {
      const p = dispatch(
        feedbackApi.util.updateQueryData("listFeedback", e.originalArgs as FeedbackListArgs, (d) => {
          for (const page of d.pages) patchRows(page.items);
        }),
      );
      undo.push(() => p.undo());
    } else if (e.endpointName === "projectFeedback") {
      const p = dispatch(
        feedbackApi.util.updateQueryData("projectFeedback", e.originalArgs as string, (d) =>
          patchRows(d.items),
        ),
      );
      undo.push(() => p.undo());
    } else if (e.endpointName === "feedbackDetail") {
      const id = e.originalArgs as string;
      const p = dispatch(
        feedbackApi.util.updateQueryData("feedbackDetail", id, (d) => {
          if (typeof fields !== "function") Object.assign(d.feedback, fields);
        }),
      );
      undo.push(() => p.undo());
    } else {
      const p = dispatch(
        feedbackApi.util.updateQueryData("feedbackDetails", e.originalArgs as string[], (d) => {
          if (typeof fields === "function") return;
          for (const x of d) if (set.has(x.feedback.id)) Object.assign(x.feedback, fields);
        }),
      );
      undo.push(() => p.undo());
    }
  }
  return () => {
    for (const u of undo.reverse()) u();
  };
}

/** Drop items from every cached list (deleted or restored here, or by someone else). */
export function removeCachedFeedback(dispatch: Dispatch, getState: () => unknown, ids: string[]) {
  const set = new Set(ids);
  const entries = feedbackApi.util.selectInvalidatedBy(
    getState() as Parameters<typeof feedbackApi.util.selectInvalidatedBy>[0],
    ids.map((id) => ({ type: "Feedback" as const, id })),
  ) as CacheEntry[];
  for (const e of entries) {
    if (e.endpointName === "listFeedback") {
      dispatch(
        feedbackApi.util.updateQueryData("listFeedback", e.originalArgs as FeedbackListArgs, (d) => {
          let removed = 0;
          for (const page of d.pages) {
            const before = page.items.length;
            page.items = page.items.filter((i) => !set.has(i.id));
            removed += before - page.items.length;
          }
          const first = d.pages[0];
          if (first?.total !== undefined) first.total = Math.max(0, first.total - removed);
        }),
      );
    } else if (e.endpointName === "projectFeedback") {
      dispatch(
        feedbackApi.util.updateQueryData("projectFeedback", e.originalArgs as string, (d) => {
          d.items = d.items.filter((i) => !set.has(i.id));
        }),
      );
    }
  }
}

const rowTags = (items: { id: string }[] | undefined) => [
  { type: "Feedback" as const, id: LIST },
  ...(items?.map((i) => ({ type: "Feedback" as const, id: i.id })) ?? []),
];

/** Run one request per id in parallel; the first failure is the result. */
async function each(
  ids: string[],
  run: (id: string) => Promise<{ error?: ApiError | undefined }>,
): Promise<{ error: ApiError; data?: undefined } | { data: number; error?: undefined }> {
  const results = await Promise.all(ids.map(run));
  const failed = results.find((r) => r.error)?.error;
  return failed ? { error: failed } : { data: ids.length };
}

export type Reproduction = { feedbackId: string; markdown: string };
export type PageLink = { url: string; expiresAt: string };

export const feedbackApi = projectsApi.injectEndpoints({
  endpoints: (build) => ({
    /**
     * The inbox list, a page at a time (`nextCursor`). Refetches (after a change, a stream gap) reload
     * every page already shown, so scrolling far down never snaps back.
     */
    listFeedback: build.infiniteQuery<FeedbackList, FeedbackListArgs, string | null>({
      infiniteQueryOptions: {
        initialPageParam: null,
        getNextPageParam: (last) => last.nextCursor,
      },
      query: ({ queryArg, pageParam }) =>
        `/feedback?${listQueryString({ ...queryArg, cursor: pageParam ?? undefined })}`,
      providesTags: (r) => rowTags(r?.pages.flatMap((p) => p.items)),
    }),
    /**
     * Every item of a project (newest first), for the pages view. There is no pages endpoint, so pages are
     * derived from the list — up to 500 items, enough for review but not an archive.
     */
    projectFeedback: build.query<FeedbackList, string>({
      async queryFn(projectId, _api, _extra, baseQuery) {
        const items: FeedbackRow[] = [];
        let cursor: string | null = null;
        for (let i = 0; i < MAX_PAGES_OF_FEEDBACK; i++) {
          const qs = listQueryString({ projectId, status: "all", limit: 100, cursor: cursor ?? undefined });
          const res = await baseQuery(`/feedback?${qs}`);
          if (res.error) return { error: res.error };
          const page = res.data as FeedbackList;
          items.push(...page.items);
          cursor = page.nextCursor;
          if (!cursor) break;
        }
        return { data: { items, nextCursor: cursor } };
      },
      providesTags: (r) => rowTags(r?.items),
    }),
    feedbackDetail: build.query<FeedbackDetail, string>({
      query: (id) => `/feedback/${id}`,
      providesTags: (_r, _e, id) => [{ type: "Feedback", id }],
    }),
    /** Several items at once (the page review draws every pin); each also fills its own detail cache. */
    feedbackDetails: build.query<FeedbackDetail[], string[]>({
      async queryFn(ids, _api, _extra, baseQuery) {
        const results = await Promise.all(ids.map(async (id) => baseQuery(`/feedback/${id}`)));
        const failed = results.find((r) => r.error);
        if (failed?.error) return { error: failed.error };
        return { data: results.map((r) => r.data as FeedbackDetail) };
      },
      async onQueryStarted(_ids, { dispatch, queryFulfilled }) {
        const data = await fulfilled(queryFulfilled);
        if (data === null) return;
        dispatch(
          feedbackApi.util.upsertQueryEntries(
            data.map((d) => ({ endpointName: "feedbackDetail" as const, arg: d.feedback.id, value: d })),
          ),
        );
      },
      providesTags: (_r, _e, ids) => ids.map((id) => ({ type: "Feedback" as const, id })),
      keepUnusedDataFor: 120,
    }),

    /**
     * PATCH one or many items, optimistically: lists and open details change at once and roll back if the
     * API refuses. There is no bulk endpoint, so several ids are parallel PATCHes; `each` gives every item
     * its own patch (bulk undo puts each one's previous value back).
     */
    updateFeedback: build.mutation<null, UpdateArgs>({
      async queryFn(args, _api, _extra, baseQuery) {
        const changes = changesOf(args);
        const results = await Promise.all(
          changes.map(async (c) => baseQuery({ url: `/feedback/${c.id}`, method: "PATCH", body: c.patch })),
        );
        const failed = results.find((r) => r.error);
        if (failed?.error) return { error: failed.error };
        return { data: null };
      },
      async onQueryStarted(args, api) {
        const { dispatch, queryFulfilled } = api;
        const undos = changesOf(args).map((c) =>
          patchCachedFeedback(dispatch, () => api.getState(), [c.id], {
            ...fieldsOfPatch(c.patch),
            ...c.optimistic,
          }),
        );
        try {
          await queryFulfilled;
        } catch {
          for (const u of undos.reverse()) u();
        }
      },
      invalidatesTags: (_r, _e, args) => [
        ...changesOf(args).map((c) => ({ type: "Feedback" as const, id: c.id })),
        { type: "Project", id: LIST },
        { type: "Round", id: LIST },
        // Label counts in project settings.
        ...("each" in args || args.patch.labelIds ? [{ type: "Label" as const, id: LIST }] : []),
      ],
    }),
    /** Move to the trash (Admins). */
    deleteFeedback: build.mutation<number, string[]>({
      queryFn: (ids, _api, _extra, baseQuery) =>
        each(ids, async (id) => baseQuery({ url: `/feedback/${id}`, method: "DELETE" })),
      async onQueryStarted(ids, api) {
        const { dispatch, queryFulfilled } = api;
        if ((await fulfilled(queryFulfilled)) === null) return;
        removeCachedFeedback(dispatch, () => api.getState(), ids);
      },
      // The items' own details too: opened again from the Trash view they must show they are trashed.
      invalidatesTags: (_r, _e, ids) => [
        ...ids.map((id) => ({ type: "Feedback" as const, id })),
        { type: "Feedback", id: LIST },
        { type: "Project", id: LIST },
        { type: "Round", id: LIST },
        { type: "Label", id: LIST },
      ],
    }),
    /** Take items out of the trash (Admins); also the delete toast's Undo. */
    restoreFeedback: build.mutation<number, string[]>({
      queryFn: (ids, _api, _extra, baseQuery) =>
        each(ids, async (id) => baseQuery({ url: `/feedback/${id}/restore`, method: "POST" })),
      async onQueryStarted(ids, api) {
        const { dispatch, queryFulfilled } = api;
        if ((await fulfilled(queryFulfilled)) === null) return;
        removeCachedFeedback(dispatch, () => api.getState(), ids);
      },
      invalidatesTags: (_r, _e, ids) => [
        ...ids.map((id) => ({ type: "Feedback" as const, id })),
        { type: "Feedback", id: LIST },
        { type: "Project", id: LIST },
        { type: "Round", id: LIST },
        { type: "Label", id: LIST },
      ],
    }),
    /** Delete forever (items in the trash, Admins). */
    purgeFeedback: build.mutation<number, string[]>({
      queryFn: (ids, _api, _extra, baseQuery) =>
        each(ids, async (id) => baseQuery({ url: `/feedback/${id}/forever`, method: "DELETE" })),
      async onQueryStarted(ids, api) {
        const { dispatch, queryFulfilled } = api;
        if ((await fulfilled(queryFulfilled)) === null) return;
        removeCachedFeedback(dispatch, () => api.getState(), ids);
      },
      invalidatesTags: [{ type: "Feedback", id: LIST }],
    }),

    /** "Copy as Markdown": the reproduction context (page, environment, steps, failing requests). */
    reproduction: build.query<Reproduction, string>({
      query: (id) => `/feedback/${id}/reproduction`,
      keepUnusedDataFor: 30,
    }),
    /** Follow / unfollow (wave-5 contract §3.2), optimistic on the open detail. */
    watchFeedback: build.mutation<{ watching: boolean }, { id: string; watching: boolean }>({
      query: ({ id, watching }) => ({ url: `/feedback/${id}/watch`, method: watching ? "POST" : "DELETE" }),
      async onQueryStarted({ id, watching }, { dispatch, queryFulfilled }) {
        const p = dispatch(
          feedbackApi.util.updateQueryData("feedbackDetail", id, (d) => {
            d.watching = watching;
          }),
        );
        try {
          await queryFulfilled;
        } catch {
          p.undo();
        }
      },
    }),
    /** A signed link that opens the item's thread on its page, even when pins are private (§3.3). */
    pageLink: build.mutation<PageLink, string>({
      query: (id) => ({ url: `/feedback/${id}/page-link`, method: "POST" }),
    }),
    /** Opening an item reads its notifications (bell). */
    markItemNotificationsRead: build.mutation<{ updated: number }, string>({
      query: (feedbackId) => ({ url: "/notifications/read", method: "POST", body: { feedbackId } }),
      invalidatesTags: (r) => (r?.updated ? ["Notification"] : []),
    }),

    labels: build.query<{ labels: Label[] }, string>({
      query: (projectId) => `/projects/${projectId}/labels`,
      providesTags: (r, _e, projectId) => [
        { type: "Label", id: LIST },
        { type: "Label", id: projectId },
        ...(r?.labels.map((l) => ({ type: "Label" as const, id: l.id })) ?? []),
      ],
    }),
    createLabel: build.mutation<{ label: Label }, { projectId: string; name: string; color: string }>({
      query: ({ projectId, ...body }) => ({ url: `/projects/${projectId}/labels`, method: "POST", body }),
      invalidatesTags: [{ type: "Label", id: LIST }],
    }),
    updateLabel: build.mutation<{ label: Label }, { id: string; name?: string; color?: string }>({
      query: ({ id, ...body }) => ({ url: `/labels/${id}`, method: "PATCH", body }),
      // Rows and details show the name and colour.
      invalidatesTags: [{ type: "Label", id: LIST }, "Feedback"],
    }),
    deleteLabel: build.mutation<unknown, string>({
      query: (id) => ({ url: `/labels/${id}`, method: "DELETE" }),
      invalidatesTags: [{ type: "Label", id: LIST }, "Feedback"],
    }),

    addComment: build.mutation<
      unknown,
      { feedbackId: string; body: string; visibility: "internal" | "public"; mentions?: string[] }
    >({
      query: ({ feedbackId, ...body }) => ({ url: `/feedback/${feedbackId}/comments`, method: "POST", body }),
      invalidatesTags: (_r, _e, { feedbackId }) => [{ type: "Feedback", id: feedbackId }],
    }),
    editComment: build.mutation<unknown, { id: string; feedbackId: string; body: string }>({
      query: ({ id, body }) => ({ url: `/comments/${id}`, method: "PATCH", body: { body } }),
      invalidatesTags: (_r, _e, { feedbackId }) => [{ type: "Feedback", id: feedbackId }],
    }),
    deleteComment: build.mutation<unknown, { id: string; feedbackId: string }>({
      query: ({ id }) => ({ url: `/comments/${id}`, method: "DELETE" }),
      invalidatesTags: (_r, _e, { feedbackId }) => [{ type: "Feedback", id: feedbackId }],
    }),
    runPanelAction: build.mutation<ActionResult, { feedbackId: string; actionId: string }>({
      query: ({ feedbackId, actionId }) => ({
        url: `/feedback/${feedbackId}/actions/${encodeURIComponent(actionId)}`,
        method: "POST",
      }),
      invalidatesTags: (_r, _e, { feedbackId }) => [{ type: "Feedback", id: feedbackId }],
    }),
    createIssue: build.mutation<{ issue: IssueLink }, { feedbackId: string; integrationId: string }>({
      query: ({ feedbackId, integrationId }) => ({
        url: `/feedback/${feedbackId}/issues`,
        method: "POST",
        body: { integrationId },
      }),
      invalidatesTags: (_r, _e, { feedbackId }) => [{ type: "Feedback", id: feedbackId }],
    }),
    /** Presence heartbeat (wave-4 §1): the item this person has open, or null when they left it. */
    presenceHeartbeat: build.mutation<{ ok: true }, string | null>({
      query: (feedbackId) => ({ url: "/presence", method: "POST", body: { feedbackId } }),
    }),
    translateFeedback: build.mutation<
      { targetLocale: string; title: string | null; body: string },
      { id: string; targetLocale: string }
    >({
      query: ({ id, targetLocale }) => ({
        url: `/feedback/${id}/ai/translate`,
        method: "POST",
        body: { targetLocale },
      }),
      invalidatesTags: (_r, _e, { id }) => [{ type: "Feedback", id }],
    }),
    applyAiTriage: build.mutation<
      { ok: true; applied: string[] },
      {
        id: string;
        applyTitle?: boolean | undefined;
        applyPriority?: boolean | undefined;
        applyKind?: boolean | undefined;
        linkDuplicate?: boolean | undefined;
      }
    >({
      query: ({ id, ...body }) => ({
        url: `/feedback/${id}/ai/apply`,
        method: "POST",
        body,
      }),
      invalidatesTags: (_r, _e, { id }) => [{ type: "Feedback", id }],
    }),
  }),
});
