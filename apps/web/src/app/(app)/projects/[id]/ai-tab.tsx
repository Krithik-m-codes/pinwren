"use client";

import { AlertTriangle, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { SettingGroup, SettingRow } from "@/components/setting-row";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import type { ProjectAiConfig, ProjectDetail } from "@/lib/api";
import { useT } from "@/lib/i18n/provider";
import { errorMessage, useProjectAiQuery, useUpdateProjectAiMutation } from "@/lib/store/api";

export function AiTab({ project: p }: { project: ProjectDetail }) {
  const t = useT();
  const query = useProjectAiQuery(p.id);
  const [updateAi, { isLoading: isUpdating }] = useUpdateProjectAiMutation();

  const isEuPrivacy = p.widgetConfig.privacyMode;

  if (query.isLoading) {
    return <Skeleton className="h-64 rounded-xl" />;
  }

  const config: ProjectAiConfig = query.data ?? {
    enabled: false,
    autoSummary: true,
    autoSeverity: true,
    detectDuplicates: true,
    generateRepro: true,
    allowReplayInAi: false,
  };

  const handleToggle = async (patch: Partial<ProjectAiConfig>, label: string) => {
    try {
      await updateAi({ id: p.id, patch }).unwrap();
      toast.success(t("projects1.aiLabelUpdated", { label }));
    } catch (e: unknown) {
      toast.error(t("projects1.aiFailedToUpdate", { label }), { description: errorMessage(e) });
    }
  };

  return (
    <div className="grid max-w-3xl gap-4">
      {isEuPrivacy && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div>
            <p className="font-semibold">{t("projects1.euPrivacyEnabled")}</p>
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-300/90">
              {t("projects1.euPrivacyDescription")}
            </p>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            {t("projects1.aiTriageEnrichment")}
          </CardTitle>
          <CardDescription>{t("projects1.aiTriageDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <SettingGroup>
            <SettingRow
              label={t("projects1.enableAiTriage")}
              htmlFor="project-ai-enabled"
              description={t("projects1.enableAiTriageDescription")}
            >
              <Switch
                id="project-ai-enabled"
                checked={config.enabled}
                disabled={isUpdating}
                onCheckedChange={(enabled) => handleToggle({ enabled }, t("projects1.aiTriage"))}
              />
            </SettingRow>

            <SettingRow
              label={t("projects1.executiveSummaries")}
              htmlFor="project-ai-summary"
              description={t("projects1.executiveSummariesDescription")}
            >
              <Switch
                id="project-ai-summary"
                checked={config.autoSummary}
                disabled={!config.enabled || isUpdating}
                onCheckedChange={(autoSummary) =>
                  handleToggle({ autoSummary }, t("projects1.executiveSummary"))
                }
              />
            </SettingRow>

            <SettingRow
              label={t("projects1.prioritySuggestions")}
              htmlFor="project-ai-severity"
              description={t("projects1.prioritySuggestionsDescription")}
            >
              <Switch
                id="project-ai-severity"
                checked={config.autoSeverity}
                disabled={!config.enabled || isUpdating}
                onCheckedChange={(autoSeverity) =>
                  handleToggle({ autoSeverity }, t("projects1.severitySuggestions"))
                }
              />
            </SettingRow>

            <SettingRow
              label={t("projects1.duplicateDetection")}
              htmlFor="project-ai-duplicates"
              description={t("projects1.duplicateDetectionDescription")}
            >
              <Switch
                id="project-ai-duplicates"
                checked={config.detectDuplicates}
                disabled={!config.enabled || isUpdating}
                onCheckedChange={(detectDuplicates) =>
                  handleToggle({ detectDuplicates }, t("projects1.duplicateDetection"))
                }
              />
            </SettingRow>

            <SettingRow
              label={t("projects1.reproductionSteps")}
              htmlFor="project-ai-repro"
              description={t("projects1.reproductionStepsDescription")}
            >
              <Switch
                id="project-ai-repro"
                checked={config.generateRepro}
                disabled={!config.enabled || isUpdating}
                onCheckedChange={(generateRepro) =>
                  handleToggle({ generateRepro }, t("projects1.reproductionSynthesis"))
                }
              />
            </SettingRow>
          </SettingGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("projects1.aiProviderReceives")}</CardTitle>
          <CardDescription>{t("projects1.aiProviderReceivesDescription")}</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
