"use client";

import { Archive, Eye, FileStack, Inbox, Target } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ButtonLink } from "@/components/button-link";
import { PageHeader } from "@/components/page-header";
import { ErrorState } from "@/components/states";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActionsTab } from "./actions-tab";
import { AiTab } from "./ai-tab";
import { CaptureTab } from "./capture-tab";
import { DangerTab } from "./danger-tab";
import { InstallTab } from "./install-tab";
import { LabelsTab } from "./labels-tab";
import { PrivacyTab } from "./privacy-tab";
import { ReviewLinksTab } from "./review-links-tab";
import { TrackersTab } from "./trackers-tab";
import { useProject } from "./use-project";
import { WidgetTab } from "./widget-tab";
import { here } from "@/lib/routes";
import { useViewer } from "@/lib/viewer";
import { ReadOnly } from "@/components/read-only";
import type { Key } from "@/lib/i18n/en";
import { useT } from "@/lib/i18n/provider";

const TABS = [
  { value: "install", label: "projects2.tabInstall" },
  { value: "widget", label: "projects2.tabWidget" },
  { value: "review", label: "projects2.reviewLinks" },
  { value: "capture", label: "projects2.tabCapture" },
  { value: "actions", label: "projects2.tabActions" },
  { value: "trackers", label: "projects2.tabIssueTrackers" },
  { value: "labels", label: "projects2.labels" },
  { value: "ai", label: "projects2.tabAiTriage" },
  { value: "privacy", label: "projects2.tabPrivacyData" },
  { value: "danger", label: "projects2.dangerZone" },
] as const satisfies readonly { value: string; label: Key }[];
type Tab = (typeof TABS)[number]["value"];
/** Tabs only organisation admins see (the API refuses everyone else). */
const ADMIN_ONLY = new Set<Tab>(["review", "danger"]);

export function ProjectSettings({ id }: { id: string }) {
  const t = useT();
  // Project settings are configuration: organisation admins only (ADR 0021). Members and viewers see
  // them read-only.
  const { isAdmin: canWrite, isViewer } = useViewer();
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const query = useProject(id);
  const tab: Tab = TABS.some((x) => x.value === search.get("tab")) ? (search.get("tab") as Tab) : "install";

  if (query.isLoading) {
    return (
      <>
        <PageHeader title={<Skeleton className="h-4 w-32" />} />
        <div className="mx-auto w-full max-w-5xl space-y-4 p-4">
          <Skeleton className="h-8 w-96 max-w-full" />
          <Skeleton className="h-56 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </>
    );
  }
  if (!query.data) {
    return (
      <>
        <PageHeader title={t("projects2.project")} />
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      </>
    );
  }
  const p = query.data.project;

  return (
    <>
      <PageHeader title={p.name}>
        <ButtonLink href={`/projects/${p.id}/rounds`} size="sm" variant="ghost">
          <Target /> <span className="hidden sm:inline">{t("projects2.rounds")}</span>
        </ButtonLink>
        <ButtonLink href={`/projects/${p.id}/pages`} size="sm" variant="ghost">
          <FileStack /> <span className="hidden sm:inline">{t("projects2.pages")}</span>
        </ButtonLink>
        <ButtonLink href={`/inbox?project=${p.id}`} size="sm" variant="outline">
          <Inbox /> <span className="hidden sm:inline">{t("projects2.openInbox")}</span>
        </ButtonLink>
      </PageHeader>
      <div className="mx-auto w-full max-w-5xl p-4 pb-16">
        {!canWrite && (
          <p
            className="mb-4 flex items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2 text-sm text-muted-foreground"
            data-testid="read-only-notice"
          >
            <Eye className="size-4 shrink-0" />
            {isViewer ? t("projects2.readOnlyAccess") : t("projects2.adminsOnlyChangeSettings")}
          </p>
        )}
        {p.archivedAt && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
            <Archive className="size-4 shrink-0" />
            {t("projects2.projectArchivedNotice")}
            <ButtonLink href={here(pathname, "tab=danger")} size="sm" variant="outline" className="ml-auto">
              {t("projects2.restore")}
            </ButtonLink>
          </div>
        )}
        <Tabs
          value={tab}
          onValueChange={(v) => router.replace(here(pathname, `tab=${String(v)}`), { scroll: false })}
        >
          <div className="-mx-4 overflow-x-auto px-4 pb-1">
            <TabsList variant="line" className="w-full justify-start border-b">
              {TABS.filter((x) => canWrite || !ADMIN_ONLY.has(x.value)).map((x) => (
                <TabsTrigger key={x.value} value={x.value} className="flex-none px-2.5">
                  {t(x.label)}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <ReadOnly when={!canWrite}>
            <TabsContent value="install" className="pt-3">
              <InstallTab project={p} />
            </TabsContent>
            <TabsContent value="widget" className="pt-3">
              <WidgetTab project={p} />
            </TabsContent>
            <TabsContent value="capture" className="pt-3">
              <CaptureTab project={p} />
            </TabsContent>
            <TabsContent value="actions" className="pt-3">
              <ActionsTab project={p} />
            </TabsContent>
            <TabsContent value="trackers" className="pt-3">
              <TrackersTab project={p} />
            </TabsContent>
            <TabsContent value="ai" className="pt-3">
              <AiTab project={p} />
            </TabsContent>
            <TabsContent value="privacy" className="pt-3">
              <PrivacyTab project={p} />
            </TabsContent>
            {canWrite && (
              <TabsContent value="review" className="pt-3">
                <ReviewLinksTab project={p} />
              </TabsContent>
            )}
            {canWrite && (
              <TabsContent value="danger" className="pt-3">
                <DangerTab project={p} />
              </TabsContent>
            )}
          </ReadOnly>
          {/* Outside ReadOnly: Editors manage labels too (`labels.manage`); the tab checks the role. */}
          <TabsContent value="labels" className="pt-3">
            <LabelsTab project={p} />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
