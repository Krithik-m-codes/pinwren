"use client";

import { Sparkles } from "lucide-react";
import { EmptyState, ErrorState } from "@/components/states";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { isAdminRole } from "@/lib/api";
import {
  useAiSettingsQuery,
  useMeQuery,
  useTestAiSettingsMutation,
  useUpdateAiSettingsMutation,
} from "@/lib/store/api";
import { useT } from "@/lib/i18n/provider";
import { SectionTitle } from "../settings-shell";
import { AiSettingsForm, type AiSettingsPayload } from "./ai-settings-form";

export function AiSettings() {
  const t = useT();
  const query = useAiSettingsQuery(undefined);
  const me = useMeQuery(undefined);
  const [updateAiSettings] = useUpdateAiSettingsMutation();
  const [testAiSettings] = useTestAiSettingsMutation();

  if (query.isLoading || me.isLoading) {
    return <Skeleton className="h-96 rounded-xl" />;
  }

  if (query.isError) {
    return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  }

  if (!isAdminRole(me.data?.role)) {
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={Sparkles}
            title={t("settings3.workspaceAdminsOnly")}
            description={t("settings3.askAdminConfigureAi")}
          />
        </CardContent>
      </Card>
    );
  }

  const handleSave = async (payload: AiSettingsPayload) => {
    await updateAiSettings(payload).unwrap();
  };

  const handleTest = async (payload: AiSettingsPayload) => {
    return await testAiSettings(payload).unwrap();
  };

  return (
    <div className="grid gap-4">
      <SectionTitle
        title={t("settings3.aiConfiguration")}
        description={t("settings3.aiConfigurationDescription")}
      />
      <AiSettingsForm initialConfig={query.data} onSave={handleSave} onTest={handleTest} />
    </div>
  );
}
