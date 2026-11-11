import type { DashboardStats, DashboardStatsQuery } from "@pinwren/core";
import { adminApi } from "./admin";

// Dashboard numbers: one aggregate request per (filters, range), shared by every widget on the screen.
// `Stats` is invalidated by the real-time stream (listeners.ts) so open dashboards stay current.

/** What a dashboard asks for: the range plus the dashboard-wide filters (all optional). */
export type StatsArgs = Pick<DashboardStatsQuery, "days"> &
  Partial<Pick<DashboardStatsQuery, "projectId" | "labelId" | "assigneeId" | "from" | "to">>;

export const statsApi = adminApi.injectEndpoints({
  endpoints: (build) => ({
    dashboardStats: build.query<DashboardStats, StatsArgs>({
      query: ({ days, projectId, labelId, assigneeId, from, to }) => ({
        url: "/stats",
        params: {
          days,
          ...(projectId ? { projectId } : {}),
          ...(labelId ? { labelId } : {}),
          ...(assigneeId ? { assigneeId } : {}),
          ...(from ? { from, ...(to ? { to } : {}) } : {}),
        },
      }),
      providesTags: ["Stats"],
    }),
  }),
});

export const { useDashboardStatsQuery } = statsApi;
