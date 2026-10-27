"use client";

import { Mail } from "lucide-react";
import { ButtonLink } from "@/components/button-link";
import { SettingRow } from "@/components/setting-row";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import type { ProjectDetail } from "@/lib/api";
import { useT } from "@/lib/i18n/provider";
import { useMeQuery } from "@/lib/store/api";
import { useProjectPatch } from "./use-project";

/**
 * "Email the reporter" where people look for it: next to the widget's own settings (it used to sit in
 * Privacy & data). Which emails a reporter gets in detail is Settings › Notifications › Reporter.
 */
export function ReporterEmailsCard({ project: p }: { project: ProjectDetail }) {
  const t = useT();
  const save = useProjectPatch(p.id);
  const me = useMeQuery(undefined).data;
  return (
    <Card data-testid="reporter-emails">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="size-4 text-muted-foreground" /> {t("projects1.emailsToReporters")}
        </CardTitle>
        <CardDescription>{t("projects1.emailsToReportersDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <SettingRow
          label={t("projects1.emailTheReporter")}
          htmlFor="notify-reporter"
          description={t("projects1.emailTheReporterDescription")}
        >
          <Switch
            id="notify-reporter"
            checked={p.notifyReporter}
            onCheckedChange={(notifyReporter) =>
              save.mutate({
                patch: { notifyReporter },
                message: notifyReporter
                  ? t("projects1.reportersGetEmails")
                  : t("projects1.noEmailsToReporters"),
              })
            }
          />
        </SettingRow>
        {me?.emailConfigured === false && (
          <p className="text-xs text-amber-700 dark:text-amber-400">{t("projects1.emailNotSetUp")}</p>
        )}
        <ButtonLink href="/settings/notifications" size="sm" variant="outline" className="w-fit">
          {t("projects1.chooseReporterEmails")}
        </ButtonLink>
      </CardContent>
    </Card>
  );
}
