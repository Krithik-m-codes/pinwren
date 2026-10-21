"use client";

import { Archive, FileStack, Inbox } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { use } from "react";
import { ButtonLink } from "@/components/button-link";
import { PageHeader } from "@/components/page-header";
import { ErrorState } from "@/components/states";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CaptureTab } from "./capture-tab";
import { DangerTab } from "./danger-tab";
import { InstallTab } from "./install-tab";
import { PrivacyTab } from "./privacy-tab";
import { useProject } from "./use-project";
import { WidgetTab } from "./widget-tab";

const TABS = [
  { value: "install", label: "Install" },
  { value: "widget", label: "Widget" },
  { value: "capture", label: "Capture" },
  { value: "privacy", label: "Privacy & data" },
  { value: "danger", label: "Danger zone" },
] as const;
type Tab = (typeof TABS)[number]["value"];

export function ProjectSettings({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const query = useProject(id);
  const tab: Tab = TABS.some((t) => t.value === search.get("tab")) ? (search.get("tab") as Tab) : "install";

  if (query.isPending) {
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
  if (query.isError) {
    return (
      <>
        <PageHeader title="Project" />
        <ErrorState error={query.error} retry={() => query.refetch()} />
      </>
    );
  }
  const p = query.data.project;

  return (
    <>
      <PageHeader title={p.name}>
        <ButtonLink href={`/projects/${p.id}/pages`} size="sm" variant="ghost">
          <FileStack /> <span className="hidden sm:inline">Pages</span>
        </ButtonLink>
        <ButtonLink href={`/inbox?project=${p.id}`} size="sm" variant="outline">
          <Inbox /> <span className="hidden sm:inline">Open inbox</span>
        </ButtonLink>
      </PageHeader>
      <div className="mx-auto w-full max-w-5xl p-4 pb-16">
        {p.archivedAt && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
            <Archive className="size-4 shrink-0" />
            This project is archived: the widget is switched off and it&apos;s hidden from your lists.
            <ButtonLink href={`${pathname}?tab=danger`} size="sm" variant="outline" className="ml-auto">
              Restore
            </ButtonLink>
          </div>
        )}
        <Tabs
          value={tab}
          onValueChange={(v) => router.replace(`${pathname}?tab=${String(v)}`, { scroll: false })}
        >
          <div className="-mx-4 overflow-x-auto px-4 pb-1">
            <TabsList variant="line" className="w-full justify-start border-b">
              {TABS.map((t) => (
                <TabsTrigger key={t.value} value={t.value} className="flex-none px-2.5">
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <TabsContent value="install" className="pt-3">
            <InstallTab project={p} />
          </TabsContent>
          <TabsContent value="widget" className="pt-3">
            <WidgetTab project={p} />
          </TabsContent>
          <TabsContent value="capture" className="pt-3">
            <CaptureTab project={p} />
          </TabsContent>
          <TabsContent value="privacy" className="pt-3">
            <PrivacyTab project={p} />
          </TabsContent>
          <TabsContent value="danger" className="pt-3">
            <DangerTab project={p} />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
