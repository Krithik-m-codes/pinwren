"use client";

import { Target } from "lucide-react";
import { toast } from "sonner";
import { ButtonLink } from "@/components/button-link";
import { SettingRow } from "@/components/setting-row";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { ProjectDetail } from "@/lib/api";
import { errorMessage, useRoundsQuery, useUpdateRoundMutation } from "@/lib/store/api";

const NONE = "none";

/**
 * Which review round new feedback joins (F-055). The widget files reports into the project's active
 * round when there is exactly one, so choosing one here closes the other active rounds.
 */
export function ActiveRoundCard({ project }: { project: ProjectDetail }) {
  const rounds = useRoundsQuery(project.id);
  const [updateRound, update] = useUpdateRoundMutation();
  const list = rounds.data?.rounds ?? [];
  const active = list.filter((r) => r.status === "active");
  const value = active.length === 1 && active[0] ? active[0].id : NONE;
  const items = [
    { value: NONE, label: active.length > 1 ? "Several (none is used)" : "No round" },
    ...list.map((r) => ({ value: r.id, label: r.name })),
  ];

  const choose = async (id: string) => {
    try {
      // Close every other active round first, so there is never a moment with two.
      for (const r of active) {
        if (r.id !== id)
          await updateRound({ id: r.id, projectId: project.id, patch: { status: "closed" } }).unwrap();
      }
      if (id !== NONE) await updateRound({ id, projectId: project.id, patch: { status: "active" } }).unwrap();
      toast.success(
        id === NONE
          ? "New feedback joins no round"
          : `New feedback joins “${list.find((r) => r.id === id)?.name ?? ""}”`,
      );
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="size-4 text-muted-foreground" /> Review round
          <ButtonLink href={`/projects/${project.id}/rounds`} size="sm" variant="ghost" className="ml-auto">
            Manage rounds
          </ButtonLink>
        </CardTitle>
        <CardDescription>
          Group the feedback of one review (“Homepage v2”, “Sprint 14”) and export it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SettingRow
          label="Active round"
          description="New feedback from the widget joins it. Choosing one closes the other active rounds."
        >
          {rounds.isLoading ? (
            <Skeleton className="h-8 w-48" />
          ) : list.length === 0 ? (
            <p className="text-sm text-muted-foreground">No rounds yet.</p>
          ) : (
            <Select
              items={items}
              value={value}
              disabled={update.isLoading}
              onValueChange={(v) => v && v !== value && void choose(v)}
            >
              <SelectTrigger className="w-56" aria-label="Active round">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {items.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </SettingRow>
      </CardContent>
    </Card>
  );
}
