"use client";

import { Mail } from "lucide-react";
import { EmptyState } from "@/components/states";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMeInfo } from "@/lib/account-hooks";
import { isAdminRole } from "@/lib/api";
import { EmailSettingsForm } from "./email-settings";
import { EmailTemplates } from "./email-templates";

/** SMTP belongs to the instance admin; the wording of this workspace's emails to its admins. */
export function EmailPageContent() {
  const me = useMeInfo();
  if (me.isPending) return <Skeleton className="h-96 rounded-xl" />;
  const instanceAdmin = !!me.data?.instanceAdmin;
  const orgAdmin = isAdminRole(me.data?.role);
  if (!instanceAdmin && !orgAdmin) {
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={Mail}
            title="Admins only"
            description="Workspace admins edit email wording; the server's admin sets up delivery."
          />
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="grid gap-4">
      {instanceAdmin && <EmailSettingsForm />}
      {orgAdmin && <EmailTemplates />}
    </div>
  );
}
