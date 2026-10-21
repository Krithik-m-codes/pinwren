"use client";

import { type CaptureConfigInput, mergeConfig, type WidgetConfigInput } from "@annota/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, type ProjectDetail, qk } from "@/lib/api";

export type ProjectPatch = Partial<
  Pick<
    ProjectDetail,
    "name" | "allowedOrigins" | "publicRead" | "retentionDays" | "notifyReporter" | "widgetRateLimitPerMin"
  >
> & {
  widgetConfig?: WidgetConfigInput;
  captureConfig?: CaptureConfigInput;
  archived?: boolean;
};

export function useProject(id: string) {
  return useQuery({
    queryKey: qk.project(id),
    queryFn: () => api<{ project: ProjectDetail }>(`/projects/${id}`),
    // Poll until the widget pings /w/config, so "Waiting for your site" flips live (blueprint 06 §3.5).
    refetchInterval: (q) => (q.state.data?.project.lastSeenAt ? false : 4000),
  });
}

/**
 * Optimistic project PATCH: the form and preview change at once, roll back on a 4xx, and a toast says
 * which happened. Partial configs are deep-merged the same way the API merges them.
 */
export function useProjectPatch(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ patch }: { patch: ProjectPatch; message?: string }) =>
      api<{ project: ProjectDetail }>(`/projects/${id}`, { method: "PATCH", json: patch }),
    onMutate: async ({ patch }) => {
      await qc.cancelQueries({ queryKey: qk.project(id) });
      const prev = qc.getQueryData<{ project: ProjectDetail }>(qk.project(id));
      if (prev) {
        const { widgetConfig, captureConfig, archived, ...rest } = patch;
        const next: ProjectDetail = { ...prev.project, ...rest };
        if (widgetConfig) next.widgetConfig = mergeConfig(prev.project.widgetConfig, widgetConfig) as never;
        if (captureConfig)
          next.captureConfig = mergeConfig(prev.project.captureConfig, captureConfig) as never;
        if (archived !== undefined) next.archivedAt = archived ? new Date().toISOString() : null;
        qc.setQueryData(qk.project(id), { project: next });
      }
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.project(id), ctx.prev);
      toast.error("Not saved", { description: e.message });
    },
    onSuccess: ({ project }, { message }) => {
      qc.setQueryData(qk.project(id), { project });
      void qc.invalidateQueries({ queryKey: qk.projects });
      toast.success(message ?? "Saved", { id: `project-save-${id}` });
    },
  });
}
