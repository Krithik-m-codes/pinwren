"use client";

import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useViewer } from "@/lib/viewer";
import { EmailTemplates } from "../email/email-templates";
import { MyNotifications } from "./my-notifications";
import { ProjectGeneral, ProjectReporter } from "./project-notifications";

const TABS = ["general", "reporter", "templates", "mine"] as const;
type Tab = (typeof TABS)[number];

/**
 * Settings › Notifications (BugPin model, wave-5 contract §3.2): per project, who on the team gets new-report
 * emails (General) and which emails reporters get (Reporter); the wording of every email (Email templates);
 * and each person's own switches (My notifications). Admins change the first three; everyone reads them.
 */
export function NotificationSettings() {
  const { isAdmin } = useViewer();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const asked = params.get("tab");
  const tabs: readonly Tab[] = TABS.filter((t) => t !== "templates" || isAdmin);
  const tab: Tab = tabs.find((t) => t === asked) ?? (isAdmin ? "general" : "mine");

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => router.replace(`${pathname}?tab=${String(v)}` as Route, { scroll: false })}
    >
      <TabsList className="max-w-full overflow-x-auto">
        <TabsTrigger value="general">General</TabsTrigger>
        <TabsTrigger value="reporter">Reporter</TabsTrigger>
        {isAdmin && <TabsTrigger value="templates">Email templates</TabsTrigger>}
        <TabsTrigger value="mine">My notifications</TabsTrigger>
      </TabsList>
      <TabsContent value="general" className="mt-2">
        <ProjectGeneral />
      </TabsContent>
      <TabsContent value="reporter" className="mt-2">
        <ProjectReporter />
      </TabsContent>
      {isAdmin && (
        <TabsContent value="templates" className="mt-2">
          <EmailTemplates />
        </TabsContent>
      )}
      <TabsContent value="mine" className="mt-2">
        <MyNotifications />
      </TabsContent>
    </Tabs>
  );
}
