"use client";

import { Target } from "lucide-react";
import { toast } from "sonner";
import { ButtonLink } from "@/components/button-link";
import { SettingRow } from "@/components/setting-row";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { ProjectDetail } from "@/lib/api";
import { useT } from "@/lib/i18n/provider";
import { errorMessage, useRoundsQuery, useUpdateRoundMutation } from "@/lib/store/api";

const NONE = "none";

/**
 * Which review round new feedback joins (F-055). The widget files reports into the project's active
 * round when there is exactly one, so choosing one here closes the other active rounds.
 */
export function ActiveRoundCard({ project }: { project: ProjectDetail }) {
  const t = useT();
  const rounds = useRoundsQuery(project.id);
  const [updateRound, update] = useUpdateRoundMutation();
  const list = rounds.data?.rounds ?? [];
  const active = list.filter((r) => r.status === "active");
  const value = active.length === 1 && active[0] ? active[0].id : NONE;
  const items = [
    { value: NONE, label: active.length > 1 ? t("projects1.severalNoneUsed") : t("projects1.noRound") },
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
          ? t("projects1.newFeedbackJoinsNoRound")
          : t("projects1.newFeedbackJoins", { name: list.find((r) => r.id === id)?.name ?? "" }),
      );
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="size-4 text-muted-foreground" /> {t("projects1.reviewRound")}
          <ButtonLink href={`/projects/${project.id}/rounds`} size="sm" variant="ghost" className="ml-auto">
            {t("projects1.manageRounds")}
          </ButtonLink>
        </CardTitle>
        <CardDescription>{t("projects1.reviewRoundDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        <SettingRow label={t("projects1.activeRound")} description={t("projects1.activeRoundDescription")}>
          {rounds.isLoading ? (
            <Skeleton className="h-8 w-48" />
          ) : list.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("projects1.noRoundsYet")}</p>
          ) : (
            <Select
              items={items}
              value={value}
              disabled={update.isLoading}
              onValueChange={(v) => v && v !== value && void choose(v)}
            >
              <SelectTrigger className="w-56" aria-label={t("projects1.activeRound")}>
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
