import type { FeedbackStatus, Priority } from "@pinwren/core";
import type { ThunkDispatch, UnknownAction } from "@reduxjs/toolkit";
import {
  type ActionResult,
  type FeedbackDetail,
  type FeedbackList,
  type FeedbackRow,
  type IssueLink,
  screenshotOf,
} from "@/lib/api";
import { type FeedbackListArgs, listQueryString } from "@/lib/inbox-filters";
import { LIST, fulfilled } from "./base";
import { projectsApi } from "./projects";

export type FeedbackPatch = Partial<{
  status: FeedbackStatus;
  priority: Priority;
  assigneeIds: string[];
  title: string | null;
  roundId: string | null;
}>;

/** Fields of a list row / detail the cache may patch in place (from a PATCH or a stream event). */
export type FeedbackFields = Partial<
  Pick<FeedbackRow, "status" | "priority" | "assigneeIds" | "title" | "roundId">
>;

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
      const args = e.originalArgs as FeedbackListArgs;
      {
        const p = dispatch(feedbackApi.util.updateQueryData("listFeedback", args, (d) => patchRows(d.items)));
        undo.push(() => p.undo());
      }
    } else if (e.endpointName === "projectFeedback") {
      const args = e.originalArgs as string;
      {
        const p = dispatch(
          feedbackApi.util.updateQueryData("projectFeedback", args, (d) => patchRows(d.items)),
        );
        undo.push(() => p.undo());
      }
    } else if (e.endpointName === "feedbackDetail") {
      const id = e.originalArgs as string;
      {
        const p = dispatch(
          feedbackApi.util.updateQueryData("feedbackDetail", id, (d) => {
            if (typeof fields !== "function") Object.assign(d.feedback, fields);
          }),
        );
        undo.push(() => p.undo());
      }
    } else {
      const args = e.originalArgs as string[];
      {
        const p = dispatch(
          feedbackApi.util.updateQueryData("feedbackDetails", args, (d) => {
            if (typeof fields === "function") return;
            for (const x of d) if (set.has(x.feedback.id)) Object.assign(x.feedback, fields);
          }),
        );
        undo.push(() => p.undo());
      }
    }
  }
  return () => {
    for (const u of undo.reverse()) u();
  };
}

/** Drop items from every cached list (deleted here or by someone else). */
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
          d.items = d.items.filter((i) => !set.has(i.id));
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

export const feedbackApi = projectsApi.injectEndpoints({
  endpoints: (build) => ({
    listFeedback: build.query<FeedbackList, FeedbackListArgs>({
      query: (args) => `/feedback?${listQueryString(args)}`,
      providesTags: (r) => rowTags(r?.items),
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
     * Screenshot asset id for a card. The list only says *whether* there is one, so it's read from the
     * detail — cached for long and untagged, so list mutations don't refetch every thumbnail.
     */
    thumbnail: build.query<string | null, string>({
      async queryFn(id, _api, _extra, baseQuery) {
        const res = await baseQuery(`/feedback/${id}`);
        if (res.error) return { error: res.error };
        return { data: screenshotOf((res.data as FeedbackDetail).assets)?.id ?? null };
      },
      keepUnusedDataFor: 600,
    }),

    /**
     * PATCH one or many items, optimistically: lists and open details change at once and roll back if the
     * API refuses. There is no bulk endpoint, so several ids are parallel PATCHes.
     */
    updateFeedback: build.mutation<null, { ids: string[]; patch: FeedbackPatch }>({
      async queryFn({ ids, patch }, _api, _extra, baseQuery) {
        const results = await Promise.all(
          ids.map(async (id) => baseQuery({ url: `/feedback/${id}`, method: "PATCH", body: patch })),
        );
        const failed = results.find((r) => r.error);
        if (failed?.error) return { error: failed.error };
        return { data: null };
      },
      async onQueryStarted({ ids, patch }, api) {
        const { dispatch, queryFulfilled } = api;
        const undo = patchCachedFeedback(dispatch, () => api.getState(), ids, patch);
        try {
          await queryFulfilled;
        } catch {
          undo();
        }
      },
      invalidatesTags: (_r, _e, { ids }) => [
        ...ids.map((id) => ({ type: "Feedback" as const, id })),
        { type: "Project", id: LIST },
        { type: "Round", id: LIST },
      ],
    }),
    deleteFeedback: build.mutation<number, string[]>({
      async queryFn(ids, _api, _extra, baseQuery) {
        const results = await Promise.all(
          ids.map(async (id) => baseQuery({ url: `/feedback/${id}`, method: "DELETE" })),
        );
        const failed = results.find((r) => r.error);
        if (failed?.error) return { error: failed.error };
        return { data: ids.length };
      },
      async onQueryStarted(ids, api) {
        const { dispatch, queryFulfilled } = api;
        if ((await fulfilled(queryFulfilled)) === null) return;
        removeCachedFeedback(dispatch, () => api.getState(), ids);
      },
      invalidatesTags: [
        { type: "Feedback", id: LIST },
        { type: "Project", id: LIST },
        { type: "Round", id: LIST },
      ],
    }),

    addComment: build.mutation<
      unknown,
      { feedbackId: string; body: string; visibility: "internal" | "public" }
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
  }),
});
