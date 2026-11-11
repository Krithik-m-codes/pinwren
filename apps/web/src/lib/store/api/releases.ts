import type { ApiRelease, ReleaseCreate, ReleaseUpdate } from "@pinwren/core";
import { LIST } from "./base";
import { adminApi } from "./admin";

/** A release of a project with the items fixed in it and the regressions reported from it (ADR 0029). */
export type Release = ApiRelease;

/** What recording a release answers: `created` false when the version already existed; `adopted` items promised for "the next release". */
export type RecordedRelease = { release: Release; created: boolean; adopted: number };

/** Releases of a project and the regression switches' companion endpoints. */
export const releasesApi = adminApi.injectEndpoints({
  endpoints: (build) => ({
    releases: build.query<{ releases: Release[] }, string>({
      query: (projectId) => `/projects/${projectId}/releases`,
      providesTags: (r, _e, projectId) => [
        { type: "Release", id: LIST },
        { type: "Release", id: projectId },
        ...(r?.releases.map((x) => ({ type: "Release" as const, id: x.id })) ?? []),
      ],
    }),
    recordRelease: build.mutation<RecordedRelease, { projectId: string; release: ReleaseCreate }>({
      query: ({ projectId, release }) => ({
        url: `/projects/${projectId}/releases`,
        method: "POST",
        body: release,
      }),
      // A new release may adopt "next release" items, so item lists and details are stale too.
      invalidatesTags: [{ type: "Release", id: LIST }, { type: "Feedback", id: LIST }, "Stats"],
    }),
    updateRelease: build.mutation<{ release: Release }, { id: string; patch: ReleaseUpdate }>({
      query: ({ id, patch }) => ({ url: `/releases/${id}`, method: "PATCH", body: patch }),
      invalidatesTags: [{ type: "Release", id: LIST }],
    }),
    deleteRelease: build.mutation<unknown, string>({
      query: (id) => ({ url: `/releases/${id}`, method: "DELETE" }),
      invalidatesTags: [{ type: "Release", id: LIST }, { type: "Feedback", id: LIST }, "Stats"],
    }),
  }),
});

export const {
  useReleasesQuery,
  useRecordReleaseMutation,
  useUpdateReleaseMutation,
  useDeleteReleaseMutation,
} = releasesApi;
