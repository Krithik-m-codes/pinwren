import type { DashboardStats, DashboardStatsQuery } from "@pinwren/core";
import { adminApi } from "./admin";

// Dashboard numbers: one aggregate request per (project, range), shared by every widget on the screen.
// `Stats` is invalidated by the real-time stream (listeners.ts) so open dashboards stay current.

export const statsApi = adminApi.injectEndpoints({
  endpoints: (build) => ({
    dashboardStats: build.query<DashboardStats, Pick<DashboardStatsQuery, "days"> & { projectId?: string }>({
      query: ({ days, projectId }) => ({
        url: "/stats",
        params: { days, ...(projectId ? { projectId } : {}) },
      }),
      providesTags: ["Stats"],
    }),
  }),
});

export const { useDashboardStatsQuery } = statsApi;
