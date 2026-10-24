"use client";

import { Mail } from "lucide-react";
import { ButtonLink } from "@/components/button-link";
import { SettingRow } from "@/components/setting-row";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import type { ProjectDetail } from "@/lib/api";
import { useMeQuery } from "@/lib/store/api";
import { useProjectPatch } from "./use-project";

/**
 * "Email the reporter" where people look for it: next to the widget's own settings (it used to sit in
 * Privacy & data). Which emails a reporter gets in detail is Settings › Notifications › Reporter.
 */
export function ReporterEmailsCard({ project: p }: { project: ProjectDetail }) {
  const save = useProjectPatch(p.id);
  const me = useMeQuery(undefined).data;
  return (
    <Card data-testid="reporter-emails">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="size-4 text-muted-foreground" /> Emails to reporters
        </CardTitle>
        <CardDescription>
          Reporters who leave an email address in the widget can hear back without an account.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <SettingRow
          label="Email the reporter"
          htmlFor="notify-reporter"
          description="A confirmation when they report, then your public replies and status changes."
        >
          <Switch
            id="notify-reporter"
            checked={p.notifyReporter}
            onCheckedChange={(notifyReporter) =>
              save.mutate({
                patch: { notifyReporter },
                message: notifyReporter ? "Reporters get emails" : "No emails to reporters",
              })
            }
          />
        </SettingRow>
        {me?.emailConfigured === false && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Email isn&apos;t set up on this server yet, so nothing is sent until an admin adds SMTP under
            Settings › Email.
          </p>
        )}
        <ButtonLink href="/settings/notifications" size="sm" variant="outline" className="w-fit">
          Choose which emails reporters get
        </ButtonLink>
      </CardContent>
    </Card>
  );
}
