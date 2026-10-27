"use client";

import { Mail, Server } from "lucide-react";
import { ButtonLink } from "@/components/button-link";
import { EmptyState } from "@/components/states";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { isAdminRole } from "@/lib/api";
import { useMeQuery } from "@/lib/store/api";
import { useT } from "@/lib/i18n/provider";
import { EmailSettingsForm } from "./email-settings";

/**
 * Settings › Email: SMTP and the delivery log, for the instance admin (the first account, BugPin model).
 * The wording of the emails lives in Settings › Notifications › Email templates; a workspace Admin who
 * doesn't run the server is pointed there.
 */
export function EmailPageContent() {
  const t = useT();
  const me = useMeQuery(undefined);
  if (me.isLoading) return <Skeleton className="h-96 rounded-xl" />;
  if (me.data?.instanceAdmin) return <EmailSettingsForm />;
  const orgAdmin = isAdminRole(me.data?.role);
  return (
    <Card>
      <CardContent>
        <EmptyState
          icon={orgAdmin ? Server : Mail}
          title={t("settings3.emailDeliverySetByAdmin")}
          description={
            orgAdmin
              ? t("settings3.smtpConfiguredByServerAdminOrg")
              : t("settings3.smtpConfiguredByServerAdmin")
          }
          action={
            orgAdmin ? (
              <ButtonLink href="/settings/notifications?tab=templates" size="sm" variant="outline">
                {t("settings3.emailTemplates")}
              </ButtonLink>
            ) : undefined
          }
        />
      </CardContent>
    </Card>
  );
}
