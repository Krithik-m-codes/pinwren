"use client";

import { Mail, Server } from "lucide-react";
import { ButtonLink } from "@/components/button-link";
import { EmptyState } from "@/components/states";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { isAdminRole } from "@/lib/api";
import { useMeQuery } from "@/lib/store/api";
import { EmailSettingsForm } from "./email-settings";

/**
 * Settings › Email: SMTP and the delivery log, for the instance admin (the first account, BugPin model).
 * The wording of the emails lives in Settings › Notifications › Email templates; a workspace Admin who
 * doesn't run the server is pointed there.
 */
export function EmailPageContent() {
  const me = useMeQuery(undefined);
  if (me.isLoading) return <Skeleton className="h-96 rounded-xl" />;
  if (me.data?.instanceAdmin) return <EmailSettingsForm />;
  const orgAdmin = isAdminRole(me.data?.role);
  return (
    <Card>
      <CardContent>
        <EmptyState
          icon={orgAdmin ? Server : Mail}
          title="Email delivery is set up by the server's admin"
          description={
            orgAdmin
              ? "Whoever runs this Pinwren server configures SMTP. You can change what the emails say, who gets them and which emails reporters receive under Notifications."
              : "Whoever runs this Pinwren server configures SMTP."
          }
          action={
            orgAdmin ? (
              <ButtonLink href="/settings/notifications?tab=templates" size="sm" variant="outline">
                Email templates
              </ButtonLink>
            ) : undefined
          }
        />
      </CardContent>
    </Card>
  );
}
