"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellOff } from "lucide-react";
import { toast } from "sonner";
import { ButtonLink } from "@/components/button-link";
import { EmptyState, ErrorState } from "@/components/states";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type NotificationPreference } from "@/lib/api";

type Key = Exclude<keyof NotificationPreference, "projectId" | "projectName">;
const COLUMNS: { key: Key; label: string; hint: string }[] = [
  { key: "newFeedback", label: "New feedback", hint: "Every new comment or bug report" },
  { key: "assigned", label: "Assigned", hint: "Something is assigned to you" },
  { key: "replies", label: "Replies", hint: "Replies on items you're involved in" },
  { key: "statusChanges", label: "Status", hint: "Status changes on your items" },
  { key: "email", label: "Email", hint: "Also send these by email" },
];

const prefsKey = ["notification-preferences"] as const;
type Prefs = { preferences: NotificationPreference[] };

/** Per-project notification matrix (wave-1 §8). In-app notifications are always written; email is opt-out. */
export function NotificationSettings() {
  const qc = useQueryClient();
  const prefs = useQuery({ queryKey: prefsKey, queryFn: () => api<Prefs>("/notification-preferences") });
  const save = useMutation({
    mutationFn: (body: Partial<NotificationPreference> & { projectId: string }) =>
      api("/notification-preferences", { method: "PUT", json: body }),
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: prefsKey });
      const prev = qc.getQueryData<Prefs>(prefsKey);
      if (prev) {
        qc.setQueryData<Prefs>(prefsKey, {
          preferences: prev.preferences.map((p) => (p.projectId === body.projectId ? { ...p, ...body } : p)),
        });
      }
      return { prev };
    },
    onError: (e, _b, ctx) => {
      if (ctx?.prev) qc.setQueryData(prefsKey, ctx.prev);
      toast.error("Not saved", { description: e.message });
    },
    onSuccess: () => toast.success("Notification preferences saved", { id: "prefs" }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>
          Choose what reaches you, per project. Turning off Email keeps the in-app bell.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {prefs.isPending && (
          <div className="space-y-2">
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
          </div>
        )}
        {prefs.isError && <ErrorState error={prefs.error} retry={() => prefs.refetch()} />}
        {prefs.data?.preferences.length === 0 && (
          <EmptyState
            icon={BellOff}
            title="No projects yet"
            description="Preferences appear here once the workspace has a project."
            action={
              <ButtonLink href="/projects?new=1" size="sm" variant="outline">
                Create a project
              </ButtonLink>
            }
          />
        )}
        {prefs.data && prefs.data.preferences.length > 0 && (
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-full min-w-[34rem] text-sm" aria-label="Notification preferences">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Project</th>
                  {COLUMNS.map((c) => (
                    <th key={c.key} className="px-2 py-2 text-center font-medium" title={c.hint}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {prefs.data.preferences.map((p) => (
                  <tr key={p.projectId} data-project={p.projectName}>
                    <th scope="row" className="max-w-48 truncate py-2.5 pr-4 text-left font-medium">
                      {p.projectName}
                    </th>
                    {COLUMNS.map((c) => (
                      <td key={c.key} className="px-2 py-2.5 text-center">
                        <Checkbox
                          className="mx-auto"
                          checked={p[c.key]}
                          aria-label={`${c.label} for ${p.projectName}`}
                          onCheckedChange={(v) => save.mutate({ projectId: p.projectId, [c.key]: v })}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <dl className="mt-4 grid gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
          {COLUMNS.map((c) => (
            <div key={c.key}>
              <dt className="inline font-medium text-foreground">{c.label}</dt> —{" "}
              <dd className="inline">{c.hint}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
