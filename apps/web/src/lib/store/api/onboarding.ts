import type { ProjectDetail } from "@/lib/api";
import { projectsApi } from "./projects";

// Install and onboarding (wave-5 contract §3.5): the first-run checklist, review links, the project data
// export and reporter erasure. Response shapes mirror packages/api/src/routes/{project-data,review-links}.ts.

export type SetupStep = "admin" | "email" | "emailSent" | "widget" | "feedback" | "team";

export type SetupChecklist = {
  steps: Record<SetupStep, boolean>;
  done: number;
  total: number;
  /** The project the "Install the widget" step opens: the first one not yet seen, else the first. */
  projectId: string | null;
};

export type ReviewLink = {
  id: string;
  label: string;
  /** Always null in lists: the token-bearing URL is shown once, when the link is made. */
  url: null;
  expiresAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  /** Live items guests sent through the link. */
  feedbackCount: number;
};

export type ProjectExport = {
  status: "pending" | "running" | "ready" | "failed";
  requestedAt: string;
  finishedAt: string | null;
  expiresAt: string | null;
  bytes: number | null;
  items: number | null;
  assets: number | null;
  skippedAssets: number | null;
  error: string | null;
  downloadUrl: string | null;
};

export type EraseResult = { feedback: number; comments: number; emails: number; dryRun: boolean };

export type Erasure = {
  at: string;
  by: string;
  emailSha256: string;
  feedback: number;
  comments: number;
  emails: number;
};

/** A project preset asked at creation (`POST /api/projects { preset }`). */
export type ProjectPreset = "public-site" | "review";

export const onboardingApi = projectsApi
  .enhanceEndpoints({ addTagTypes: ["SetupChecklist", "ReviewLink", "ProjectExport", "Erasure"] })
  .injectEndpoints({
    endpoints: (build) => ({
      setupChecklist: build.query<{ checklist: SetupChecklist }, undefined>({
        query: () => "/setup-checklist",
        providesTags: ["SetupChecklist"],
      }),
      /** Project creation with the "what is this site for?" preset. */
      createProjectWithPreset: build.mutation<
        { project: ProjectDetail },
        { name: string; allowedOrigins: string[]; preset: ProjectPreset }
      >({
        query: (body) => ({ url: "/projects", method: "POST", body }),
        invalidatesTags: [{ type: "Project", id: "LIST" }, "NotificationPrefs", "SetupChecklist"],
      }),

      reviewLinks: build.query<{ links: ReviewLink[] }, string>({
        query: (projectId) => `/projects/${projectId}/review-links`,
        providesTags: (_r, _e, projectId) => [{ type: "ReviewLink", id: projectId }],
      }),
      createReviewLink: build.mutation<
        { link: ReviewLink; url: string },
        { projectId: string; label: string; url: string; expiresInDays?: number }
      >({
        query: ({ projectId, ...body }) => ({
          url: `/projects/${projectId}/review-links`,
          method: "POST",
          body,
        }),
        invalidatesTags: (_r, _e, { projectId }) => [{ type: "ReviewLink", id: projectId }],
      }),
      revokeReviewLink: build.mutation<unknown, { id: string; projectId: string }>({
        query: ({ id }) => ({ url: `/review-links/${id}`, method: "DELETE" }),
        invalidatesTags: (_r, _e, { projectId }) => [{ type: "ReviewLink", id: projectId }],
      }),

      projectExport: build.query<{ export: ProjectExport | null }, string>({
        query: (projectId) => `/projects/${projectId}/export`,
        providesTags: (_r, _e, projectId) => [{ type: "ProjectExport", id: projectId }],
      }),
      requestProjectExport: build.mutation<{ export: ProjectExport }, string>({
        query: (projectId) => ({ url: `/projects/${projectId}/export`, method: "POST" }),
        invalidatesTags: (_r, _e, projectId) => [{ type: "ProjectExport", id: projectId }],
      }),

      eraseReporter: build.mutation<{ result: EraseResult }, { email: string; dryRun?: boolean }>({
        query: (body) => ({ url: "/privacy/erase", method: "POST", body }),
        invalidatesTags: (_r, _e, { dryRun }) => (dryRun ? [] : ["Erasure", "Feedback", "SetupChecklist"]),
      }),
      erasures: build.query<{ erasures: Erasure[] }, undefined>({
        query: () => "/privacy/erasures",
        providesTags: ["Erasure"],
      }),
    }),
  });

export const {
  useSetupChecklistQuery,
  useCreateProjectWithPresetMutation,
  useReviewLinksQuery,
  useCreateReviewLinkMutation,
  useRevokeReviewLinkMutation,
  useProjectExportQuery,
  useRequestProjectExportMutation,
  useEraseReporterMutation,
  useErasuresQuery,
} = onboardingApi;
