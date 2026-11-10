import type {
  ApiDashboard,
  DashboardCreate,
  DashboardScope,
  DashboardUpdate,
  UiState,
  UiStateUpdate,
  WorkspacePreferences,
  WorkspacePreferenceUpdate,
} from "@pinwren/core";
import { baseApi, LIST } from "./base";

// Server-stored dashboards (ADR 0029): named layouts per screen, the workspace-shared ones, the default and
// pinned projects per workspace, and the account-wide interface state (start page, dismissed prompts).
// Injected into the base API on its own so the domain chain in ./index stays untouched.

export const dashboardsApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    dashboards: build.query<{ dashboards: ApiDashboard[] }, DashboardScope>({
      query: (scope) => ({ url: "/dashboards", params: { scope } }),
      providesTags: (r, _e, scope) => [
        { type: "Dashboard", id: `scope:${scope}` },
        ...(r?.dashboards.map((d) => ({ type: "Dashboard" as const, id: d.id })) ?? []),
      ],
    }),
    createDashboard: build.mutation<{ dashboard: ApiDashboard }, DashboardCreate>({
      query: (body) => ({ url: "/dashboards", method: "POST", body }),
      // Show the new row at once; the refetch that follows the invalidation replaces the whole list.
      async onQueryStarted({ scope }, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(
            dashboardsApi.util.updateQueryData("dashboards", scope, (d) => {
              if (!d.dashboards.some((x) => x.id === data.dashboard.id)) d.dashboards.push(data.dashboard);
            }),
          );
        } catch {
          // The caller's unwrap() reports it.
        }
      },
      invalidatesTags: (_r, _e, { scope }) => [{ type: "Dashboard", id: `scope:${scope}` }],
    }),
    /** Layout edits update the cached row at once; the request follows (the caller debounces drags). */
    updateDashboard: build.mutation<
      { dashboard: ApiDashboard },
      { id: string; scope: DashboardScope; patch: DashboardUpdate }
    >({
      query: ({ id, patch }) => ({ url: `/dashboards/${id}`, method: "PATCH", body: patch }),
      async onQueryStarted({ id, scope, patch }, { dispatch, queryFulfilled }) {
        const optimistic = dispatch(
          dashboardsApi.util.updateQueryData("dashboards", scope, (d) => {
            const row = d.dashboards.find((x) => x.id === id);
            if (!row) return;
            if (patch.name !== undefined) row.name = patch.name;
            if (patch.layout !== undefined) row.layout = patch.layout;
          }),
        );
        try {
          await queryFulfilled;
        } catch {
          optimistic.undo();
        }
      },
      // Sharing and role defaults move between rows, so those refetch the whole screen.
      invalidatesTags: (_r, _e, { id, scope, patch }) =>
        patch.shared !== undefined || patch.defaultRoles !== undefined || patch.name !== undefined
          ? [{ type: "Dashboard", id: `scope:${scope}` }]
          : [{ type: "Dashboard", id }],
    }),
    deleteDashboard: build.mutation<unknown, { id: string; scope: DashboardScope }>({
      query: ({ id }) => ({ url: `/dashboards/${id}`, method: "DELETE" }),
      invalidatesTags: (_r, _e, { scope }) => [{ type: "Dashboard", id: `scope:${scope}` }, "UiState"],
    }),
    duplicateDashboard: build.mutation<
      { dashboard: ApiDashboard },
      { id: string; scope: DashboardScope; name?: string }
    >({
      query: ({ id, name }) => ({
        url: `/dashboards/${id}/duplicate`,
        method: "POST",
        body: name ? { name } : {},
      }),
      invalidatesTags: (_r, _e, { scope }) => [{ type: "Dashboard", id: `scope:${scope}` }],
    }),

    workspacePreferences: build.query<{ preferences: WorkspacePreferences }, undefined>({
      query: () => "/me/workspace-preferences",
      providesTags: [{ type: "Dashboard", id: LIST }],
    }),
    updateWorkspacePreferences: build.mutation<
      { preferences: WorkspacePreferences },
      WorkspacePreferenceUpdate
    >({
      query: (body) => ({ url: "/me/workspace-preferences", method: "PATCH", body }),
      async onQueryStarted(patch, { dispatch, queryFulfilled }) {
        const optimistic = dispatch(
          dashboardsApi.util.updateQueryData("workspacePreferences", undefined, (d) => {
            if (patch.pinnedProjectIds) d.preferences.pinnedProjectIds = patch.pinnedProjectIds;
            for (const [scope, id] of Object.entries(patch.dashboardDefaults ?? {})) {
              if (id === null) Reflect.deleteProperty(d.preferences.dashboardDefaults, scope);
              else d.preferences.dashboardDefaults[scope as DashboardScope] = id;
            }
          }),
        );
        try {
          const { data } = await queryFulfilled;
          void dispatch(dashboardsApi.util.upsertQueryData("workspacePreferences", undefined, data));
        } catch {
          optimistic.undo();
        }
      },
    }),

    uiState: build.query<{ uiState: UiState }, undefined>({
      query: () => "/me/ui-state",
      providesTags: ["UiState"],
    }),
    updateUiState: build.mutation<{ uiState: UiState }, UiStateUpdate>({
      query: (body) => ({ url: "/me/ui-state", method: "PATCH", body }),
      async onQueryStarted(patch, { dispatch, queryFulfilled }) {
        const optimistic = dispatch(
          dashboardsApi.util.updateQueryData("uiState", undefined, (d) => {
            if (patch.startPage) d.uiState.startPage = patch.startPage;
            for (const [k, v] of Object.entries(patch.nudges ?? {})) {
              (d.uiState.nudges as Record<string, unknown>)[k] = v;
            }
          }),
        );
        try {
          const { data } = await queryFulfilled;
          void dispatch(dashboardsApi.util.upsertQueryData("uiState", undefined, data));
        } catch {
          optimistic.undo();
        }
      },
    }),
  }),
});

export const {
  useDashboardsQuery,
  useCreateDashboardMutation,
  useUpdateDashboardMutation,
  useDeleteDashboardMutation,
  useDuplicateDashboardMutation,
  useWorkspacePreferencesQuery,
  useUpdateWorkspacePreferencesMutation,
  useUiStateQuery,
  useUpdateUiStateMutation,
} = dashboardsApi;
