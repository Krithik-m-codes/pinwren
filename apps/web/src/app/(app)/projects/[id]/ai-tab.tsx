"use client";

import { AlertTriangle, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { SettingGroup, SettingRow } from "@/components/setting-row";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import type { ProjectAiConfig, ProjectDetail } from "@/lib/api";
import { errorMessage, useProjectAiQuery, useUpdateProjectAiMutation } from "@/lib/store/api";

export function AiTab({ project: p }: { project: ProjectDetail }) {
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
      toast.success(`${label} updated`);
    } catch (e: unknown) {
      toast.error(`Failed to update ${label}`, { description: errorMessage(e) });
    }
  };

  return (
    <div className="grid max-w-3xl gap-4">
      {isEuPrivacy && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div>
            <p className="font-semibold">EU Privacy Mode is enabled</p>
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-300/90">
              When EU Privacy Mode is active on this project, background AI enrichment is automatically
              bypassed for privacy compliance to prevent any diagnostic transmission.
            </p>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            AI Triage & Enrichment
          </CardTitle>
          <CardDescription>
            Configure automated triage, duplicate checks, and executive summaries for incoming reports on this
            project.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SettingGroup>
            <SettingRow
              label="Enable AI triage"
              htmlFor="project-ai-enabled"
              description="Run background AI enrichment on newly received feedback reports."
            >
              <Switch
                id="project-ai-enabled"
                checked={config.enabled}
                disabled={isUpdating}
                onCheckedChange={(enabled) => handleToggle({ enabled }, "AI triage")}
              />
            </SettingRow>

            <SettingRow
              label="Executive summaries"
              htmlFor="project-ai-summary"
              description="Synthesize a concise summary and suggested headline for each report."
            >
              <Switch
                id="project-ai-summary"
                checked={config.autoSummary}
                disabled={!config.enabled || isUpdating}
                onCheckedChange={(autoSummary) => handleToggle({ autoSummary }, "Executive summary")}
              />
            </SettingRow>

            <SettingRow
              label="Priority & kind suggestions"
              htmlFor="project-ai-severity"
              description="Analyze report content and errors to recommend priority and report type."
            >
              <Switch
                id="project-ai-severity"
                checked={config.autoSeverity}
                disabled={!config.enabled || isUpdating}
                onCheckedChange={(autoSeverity) => handleToggle({ autoSeverity }, "Severity suggestions")}
              />
            </SettingRow>

            <SettingRow
              label="Duplicate detection"
              htmlFor="project-ai-duplicates"
              description="Scan existing feedback items to warn about potential duplicate submissions."
            >
              <Switch
                id="project-ai-duplicates"
                checked={config.detectDuplicates}
                disabled={!config.enabled || isUpdating}
                onCheckedChange={(detectDuplicates) =>
                  handleToggle({ detectDuplicates }, "Duplicate detection")
                }
              />
            </SettingRow>

            <SettingRow
              label="Reproduction steps"
              htmlFor="project-ai-repro"
              description="Convert user session actions into an actionable step-by-step checklist."
            >
              <Switch
                id="project-ai-repro"
                checked={config.generateRepro}
                disabled={!config.enabled || isUpdating}
                onCheckedChange={(generateRepro) => handleToggle({ generateRepro }, "Reproduction synthesis")}
              />
            </SettingRow>
          </SettingGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What the AI provider receives</CardTitle>
          <CardDescription>
            The title and text of the report, the page URL, the element it points at, and the console errors
            and failed requests (URL, method and status) captured with it. Screenshots, session replays,
            request and response bodies, and the name and email of the reporter are never sent. With Privacy
            mode on, or PINWREN_EU_PRIVACY=true, nothing is sent at all.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
