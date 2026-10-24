import {
  type CaptureConfig,
  type CaptureConfigInput,
  type IssueProvider,
  mergeConfig,
  type WidgetBranding,
  type WidgetBrandingInput,
  type WidgetConfig,
  type WidgetConfigInput,
} from "@pinwren/core";
import type { IssueIntegration, Project, ProjectDetail } from "@/lib/api";
import { accountApi } from "./account";
import { LIST, fulfilled } from "./base";

export type ProjectPatch = Partial<
  Pick<
    ProjectDetail,
    "name" | "allowedOrigins" | "publicRead" | "retentionDays" | "notifyReporter" | "widgetRateLimitPerMin"
  >
> & {
  widgetConfig?: WidgetConfigInput;
  captureConfig?: CaptureConfigInput;
  widgetBranding?: WidgetBrandingInput;
  archived?: boolean;
};

export type TrackerCreate = {
  provider: IssueProvider;
  token: string;
  repo: string;
  apiUrl: string | null;
  /** Jira: the account email. */
  email?: string;
  labels: string[];
  autoCreate: IssueIntegration["autoCreate"];
  /** Linear: the signing secret Linear shows for its webhook. */
  webhookSecret?: string;
};

/** The project as it will look once the API has merged `patch` (the API deep-merges partial configs). */
export function applyProjectPatch(p: ProjectDetail, patch: ProjectPatch, now = new Date()): ProjectDetail {
  const { widgetConfig, captureConfig, widgetBranding, archived, ...rest } = patch;
  const next: ProjectDetail = { ...p, ...rest };
  if (widgetConfig) next.widgetConfig = mergeConfig(p.widgetConfig, widgetConfig) as WidgetConfig;
  if (captureConfig) next.captureConfig = mergeConfig(p.captureConfig, captureConfig) as CaptureConfig;
  if (widgetBranding) next.widgetBranding = mergeConfig(p.widgetBranding, widgetBranding) as WidgetBranding;
  if (archived !== undefined) next.archivedAt = archived ? now.toISOString() : null;
  return next;
}

const queues = new Map<string, Promise<unknown>>();
const pendingSaves = new Map<string, number>();

/** Run `task` after every earlier task queued for `key` (whatever their outcome). */
export function inOrder<T>(key: string, task: () => Promise<T> | T): Promise<T> {
  const run = (queues.get(key) ?? Promise.resolve()).then(task, task);
  queues.set(
    key,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

export const projectsApi = accountApi.injectEndpoints({
  endpoints: (build) => ({
    projects: build.query<{ projects: Project[] }, undefined>({
      query: () => "/projects",
      providesTags: (r) => [
        { type: "Project", id: LIST },
        ...(r?.projects.map((p) => ({ type: "Project" as const, id: p.id })) ?? []),
      ],
    }),
    project: build.query<{ project: ProjectDetail }, string>({
      query: (id) => `/projects/${id}`,
      providesTags: (_r, _e, id) => [{ type: "Project", id }],
    }),
    createProject: build.mutation<{ project: ProjectDetail }, { name: string; allowedOrigins: string[] }>({
      query: (body) => ({ url: "/projects", method: "POST", body }),
      invalidatesTags: [{ type: "Project", id: LIST }, "NotificationPrefs"],
    }),
    /**
     * Optimistic: forms and previews change at once and roll back if the API refuses. The answer
     * replaces the cached project (the server's merge is the truth).
     */
    updateProject: build.mutation<{ project: ProjectDetail }, { id: string; patch: ProjectPatch }>({
      // One PATCH per project at a time, in order: the API merges each partial config into what it read,
      // so two in flight at once could each miss the other's change.
      async queryFn({ id, patch }, _api, _extra, baseQuery) {
        const res = await inOrder(id, async () =>
          baseQuery({ url: `/projects/${id}`, method: "PATCH", body: patch }),
        );
        if (res.error) return { error: res.error };
        return { data: res.data as { project: ProjectDetail } };
      },
      async onQueryStarted({ id, patch }, { dispatch, queryFulfilled }) {
        pendingSaves.set(id, (pendingSaves.get(id) ?? 0) + 1);
        const optimistic = dispatch(
          projectsApi.util.updateQueryData("project", id, (draft) => {
            draft.project = applyProjectPatch(draft.project, patch);
          }),
        );
        const data = await fulfilled(queryFulfilled);
        const left = (pendingSaves.get(id) ?? 1) - 1;
        pendingSaves.set(id, left);
        if (data === null) {
          optimistic.undo();
          return;
        }
        // While later saves are still queued, the cache keeps their optimistic changes; the last answer
        // (the server's merge of everything) replaces it.
        if (left === 0) void dispatch(projectsApi.util.upsertQueryData("project", id, data));
      },
      invalidatesTags: [{ type: "Project", id: LIST }, "NotificationPrefs"],
    }),
    rotateProjectKey: build.mutation<{ project: ProjectDetail }, string>({
      query: (id) => ({ url: `/projects/${id}/rotate-key`, method: "POST" }),
      async onQueryStarted(id, { dispatch, queryFulfilled }) {
        const data = await fulfilled(queryFulfilled);
        if (data === null) return;
        void dispatch(projectsApi.util.upsertQueryData("project", id, data));
      },
      invalidatesTags: [{ type: "Project", id: LIST }],
    }),
    /** Webhook-action signing secret; a query that is only run on demand (`useLazy…`). */
    actionSecret: build.query<{ secret: string }, string>({
      query: (id) => `/projects/${id}/action-secret`,
      keepUnusedDataFor: 0,
    }),
    rotateActionSecret: build.mutation<{ secret: string }, string>({
      query: (id) => ({ url: `/projects/${id}/action-secret/rotate`, method: "POST" }),
      invalidatesTags: (_r, _e, id) => [{ type: "Project", id }],
    }),
    /** Signed-identity secret (wave-4 §4), created on first read. Org admins only. */
    identitySecret: build.query<{ secret: string }, string>({
      query: (id) => `/projects/${id}/identity-secret`,
      keepUnusedDataFor: 0,
    }),
    rotateIdentitySecret: build.mutation<{ secret: string }, string>({
      query: (id) => ({ url: `/projects/${id}/identity-secret/rotate`, method: "POST" }),
      invalidatesTags: (_r, _e, id) => [{ type: "Project", id }],
    }),

    trackers: build.query<{ integrations: IssueIntegration[] }, string>({
      query: (projectId) => `/projects/${projectId}/integrations`,
      providesTags: (_r, _e, projectId) => [{ type: "Tracker", id: projectId }],
    }),
    createTracker: build.mutation<
      { integration: IssueIntegration; webhookSecret: string },
      { projectId: string; body: TrackerCreate }
    >({
      query: ({ projectId, body }) => ({ url: `/projects/${projectId}/integrations`, method: "POST", body }),
      invalidatesTags: (_r, _e, { projectId }) => [{ type: "Tracker", id: projectId }],
    }),
    updateTracker: build.mutation<
      { integration: IssueIntegration },
      { id: string; projectId: string; patch: Record<string, unknown> }
    >({
      query: ({ id, patch }) => ({ url: `/integrations/${id}`, method: "PATCH", body: patch }),
      invalidatesTags: (_r, _e, { projectId }) => [{ type: "Tracker", id: projectId }],
    }),
    testTracker: build.mutation<
      { ok: true; name: string } | { ok: false; message: string },
      { id: string; projectId: string }
    >({
      query: ({ id }) => ({ url: `/integrations/${id}/test`, method: "POST" }),
      invalidatesTags: (_r, _e, { projectId }) => [{ type: "Tracker", id: projectId }],
    }),
    trackerWebhookSecret: build.query<{ secret: string; url: string }, string>({
      query: (id) => `/integrations/${id}/webhook-secret`,
      keepUnusedDataFor: 0,
    }),
    deleteTracker: build.mutation<unknown, { id: string; projectId: string }>({
      query: ({ id }) => ({ url: `/integrations/${id}`, method: "DELETE" }),
      invalidatesTags: (_r, _e, { projectId }) => [{ type: "Tracker", id: projectId }],
    }),
  }),
});
