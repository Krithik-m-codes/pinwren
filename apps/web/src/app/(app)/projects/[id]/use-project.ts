"use client";

import { toast } from "sonner";
import { errorMessage, useProjectQuery, useUpdateProjectMutation } from "@/lib/store/api";
import type { ProjectPatch } from "@/lib/store/api/projects";
import { projectsApi } from "@/lib/store/api/projects";
import { useAppSelector } from "@/lib/store/hooks";

export type { ProjectPatch };

/** The project, polled until the widget first pings `/w/config`, so "Waiting for your site" flips live. */
export function useProject(id: string) {
  const seen = useAppSelector((s) => !!projectsApi.endpoints.project.select(id)(s).data?.project.lastSeenAt);
  return useProjectQuery(id, { pollingInterval: seen ? 0 : 4000 });
}

/**
 * Save a project change: the form and preview change at once (optimistic, in the RTK Query endpoint),
 * roll back on a 4xx, and a toast says which happened.
 */
export function useProjectPatch(id: string) {
  const [update, state] = useUpdateProjectMutation();
  return {
    isPending: state.isLoading,
    mutate: (
      { patch, message }: { patch: ProjectPatch; message?: string },
      opts?: { onSuccess?: () => void },
    ) => {
      update({ id, patch })
        .unwrap()
        .then(() => {
          toast.success(message ?? "Saved", { id: `project-save-${id}` });
          opts?.onSuccess?.();
        })
        .catch((e: unknown) => toast.error("Not saved", { description: errorMessage(e) }));
    },
  };
}
