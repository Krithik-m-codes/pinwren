import type { ReviewRoundCreate, ReviewRoundUpdate, SavedViewCreate, SavedViewUpdate } from "@pinwren/core";
import type { ReviewRound, SavedView } from "@/lib/api";
import { LIST } from "./base";
import { feedbackApi } from "./feedback";

/** Review rounds (F-055) and saved views (wave-4 contract §2). */
export const roundsApi = feedbackApi.injectEndpoints({
  endpoints: (build) => ({
    rounds: build.query<{ rounds: ReviewRound[] }, string>({
      query: (projectId) => `/projects/${projectId}/rounds`,
      providesTags: (r, _e, projectId) => [
        { type: "Round", id: LIST },
        { type: "Round", id: `project:${projectId}` },
        ...(r?.rounds.map((x) => ({ type: "Round" as const, id: x.id })) ?? []),
      ],
    }),
    createRound: build.mutation<{ round: ReviewRound }, { projectId: string; body: ReviewRoundCreate }>({
      query: ({ projectId, body }) => ({ url: `/projects/${projectId}/rounds`, method: "POST", body }),
      invalidatesTags: (_r, _e, { projectId }) => [{ type: "Round", id: `project:${projectId}` }],
    }),
    updateRound: build.mutation<
      { round: ReviewRound },
      { id: string; projectId: string; patch: ReviewRoundUpdate }
    >({
      query: ({ id, patch }) => ({ url: `/rounds/${id}`, method: "PATCH", body: patch }),
      async onQueryStarted({ id, projectId, patch }, { dispatch, queryFulfilled }) {
        const optimistic = dispatch(
          roundsApi.util.updateQueryData("rounds", projectId, (d) => {
            const r = d.rounds.find((x) => x.id === id);
            if (!r) return;
            if (patch.name !== undefined) r.name = patch.name;
            if (patch.dueAt !== undefined) r.dueAt = patch.dueAt;
            if (patch.status !== undefined) r.status = patch.status;
          }),
        );
        try {
          await queryFulfilled;
        } catch {
          optimistic.undo();
        }
      },
      invalidatesTags: (_r, _e, { id }) => [{ type: "Round", id }],
    }),
    deleteRound: build.mutation<unknown, { id: string; projectId: string }>({
      query: ({ id }) => ({ url: `/rounds/${id}`, method: "DELETE" }),
      // Its items stay, with `roundId` cleared.
      invalidatesTags: (_r, _e, { projectId }) => [
        { type: "Round", id: `project:${projectId}` },
        { type: "Feedback", id: LIST },
      ],
    }),

    views: build.query<{ views: SavedView[] }, undefined>({
      query: () => "/views",
      providesTags: (r) => [
        { type: "View", id: LIST },
        ...(r?.views.map((v) => ({ type: "View" as const, id: v.id })) ?? []),
      ],
    }),
    createView: build.mutation<{ view: SavedView }, SavedViewCreate>({
      query: (body) => ({ url: "/views", method: "POST", body }),
      invalidatesTags: [{ type: "View", id: LIST }],
    }),
    updateView: build.mutation<{ view: SavedView }, { id: string; patch: SavedViewUpdate }>({
      query: ({ id, patch }) => ({ url: `/views/${id}`, method: "PATCH", body: patch }),
      invalidatesTags: (_r, _e, { id }) => [{ type: "View", id }],
    }),
    deleteView: build.mutation<unknown, string>({
      query: (id) => ({ url: `/views/${id}`, method: "DELETE" }),
      invalidatesTags: [{ type: "View", id: LIST }],
    }),
  }),
});
