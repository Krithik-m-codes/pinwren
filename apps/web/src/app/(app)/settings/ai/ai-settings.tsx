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
import { SectionTitle } from "../settings-shell";
import { AiSettingsForm, type AiSettingsPayload } from "./ai-settings-form";

export function AiSettings() {
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
            title="Workspace admins only"
            description="Ask an owner or admin of this workspace to configure AI settings."
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
        title="AI Configuration"
        description="Configure provider credentials and models for automated bug triage, duplicate detection, and summaries."
      />
      <AiSettingsForm initialConfig={query.data} onSave={handleSave} onTest={handleTest} />
    </div>
  );
}
