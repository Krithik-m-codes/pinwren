"use client";

import { BellOff, CheckCheck, Loader2, Settings2 } from "lucide-react";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ButtonLink } from "@/components/button-link";
import { useTimeAgo } from "@/components/feedback-meta";
import { NotificationIcon } from "@/components/notifications/notification-parts";
import { PageHeader } from "@/components/page-header";
import { Segmented } from "@/components/segmented";
import { EmptyState, ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/lib/i18n/provider";
import { notificationHref, notificationSubject, notificationText } from "@/lib/notification-text";
import {
  errorMessage,
  useMarkNotificationsReadMutation,
  useMeQuery,
  useProjectsQuery,
} from "@/lib/store/api";
import { useNotificationsPageInfiniteQuery } from "@/lib/store/api/notifications";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const ALL = "all";

/**
 * Every notification of the active workspace (wave-5 contract §3.2): All / Unread, per project, newest first,
 * a page at a time. The bell's "View all" and digest emails link here.
 */
export function NotificationsView() {
  const t = useT();
  const timeAgo = useTimeAgo();
  const router = useRouter();
  const params = useSearchParams();
  const me = useMeQuery(undefined).data;
  const [tab, setTab] = useState<"all" | "unread">(params.get("tab") === "unread" ? "unread" : "all");
  const [projectId, setProjectId] = useState<string>(ALL);
  const projects = useProjectsQuery(undefined).data?.projects ?? [];
  const query = useNotificationsPageInfiniteQuery({
    unread: tab === "unread",
    projectId: projectId === ALL ? null : projectId,
  });
  const [markRead, marking] = useMarkNotificationsReadMutation();
  const switching = useWorkspaceFromLink(params.get("org"), me?.orgId);

  const pages = query.data?.pages ?? [];
  const items = pages.flatMap((p) => p.items);
  const unread = pages[0]?.unreadCount ?? 0;
  const projectItems = [
    { value: ALL, label: t("other1.allProjects") },
    ...projects.map((p) => ({ value: p.id, label: p.name })),
  ];

  return (
    <>
      <PageHeader title={t("other1.notifications")} />
      <div className="mx-auto w-full max-w-3xl space-y-4 p-4 pb-16">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label={t("other1.show")}
            value={tab}
            onChange={setTab}
            options={[
              { value: "all", label: t("other1.all") },
              {
                value: "unread",
                label: unread
                  ? t("other1.unreadCount", { count: unread > 99 ? "99+" : unread })
                  : t("other1.unread"),
              },
            ]}
          />
          <Select items={projectItems} value={projectId} onValueChange={(v) => v && setProjectId(v)}>
            <SelectTrigger size="sm" aria-label={t("other1.project")} className="min-w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {projectItems.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="ml-auto flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              disabled={!unread || marking.isLoading}
              onClick={() =>
                void markRead({ all: true })
                  .unwrap()
                  .catch((e: unknown) =>
                    toast.error(t("other1.notMarkedRead"), { description: errorMessage(e) }),
                  )
              }
            >
              <CheckCheck /> {t("other1.markAllRead")}
            </Button>
            <ButtonLink href="/settings/notifications?tab=mine" size="sm" variant="ghost">
              <Settings2 /> {t("other1.settings")}
            </ButtonLink>
          </div>
        </div>

        <Card className="gap-0 overflow-hidden p-0">
          {(query.isLoading || switching) && (
            <div className="space-y-2 p-3" aria-busy>
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          )}
          {query.isError && !query.data && (
            <ErrorState error={query.error} retry={() => void query.refetch()} />
          )}
          {query.isSuccess && !switching && items.length === 0 && (
            <EmptyState
              icon={BellOff}
              title={tab === "unread" ? t("other1.noUnreadNotifications") : t("other1.noNotificationsYet")}
              description={tab === "unread" ? t("other1.readEverything") : t("other1.notificationsEmptyHint")}
            />
          )}
          {!switching && (
            <ul className="divide-y" data-testid="notifications-list">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    data-testid="notification-row"
                    className={cn(
                      "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted focus-visible:outline-none",
                      !n.readAt && "bg-blue-500/[0.04]",
                    )}
                    onClick={() => {
                      if (!n.readAt) void markRead({ ids: [n.id] });
                      router.push(notificationHref(n) as Route);
                    }}
                  >
                    <NotificationIcon
                      type={n.type}
                      className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm">
                        <span className={cn(!n.readAt && "font-medium")}>{notificationText(n, t)}</span>
                        {n.data.projectName && (
                          <span className="text-muted-foreground"> · {n.data.projectName}</span>
                        )}
                      </span>
                      <span className="block truncate text-sm text-muted-foreground">
                        {notificationSubject(n, t)}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1.5">
                      <span className="text-xs text-muted-foreground">{timeAgo(n.createdAt)}</span>
                      {!n.readAt && (
                        <span className="size-1.5 rounded-full bg-blue-600">
                          <span className="sr-only">{t("other1.unread")}</span>
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {query.hasNextPage && !switching && (
            <div className="border-t p-2 text-center">
              <Button
                size="sm"
                variant="ghost"
                disabled={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()}
              >
                {query.isFetchingNextPage ? <Loader2 className="animate-spin" /> : null}
                {query.isFetchingNextPage ? t("other1.loading") : t("other1.loadOlder")}
              </Button>
            </div>
          )}
          {query.isError && query.data && (
            <p role="alert" className="border-t p-3 text-center text-sm text-destructive">
              {errorMessage(query.error, t("other1.couldntLoadMore"))}
            </p>
          )}
        </Card>
      </div>
    </>
  );
}

/**
 * Digest emails link here with `?org=`: when it names another workspace the person belongs to, switch to it
 * first (like the inbox does for item links), then drop the parameter.
 */
function useWorkspaceFromLink(org: string | null, activeOrg: string | undefined): boolean {
  const t = useT();
  const router = useRouter();
  const needed = !!org && !!activeOrg && org !== activeOrg;
  useEffect(() => {
    if (!org || !activeOrg) return;
    const clean = () => router.replace("/notifications");
    if (org === activeOrg) {
      clean();
      return;
    }
    void (async () => {
      const { authClient } = await import("@/lib/auth-client");
      const res = await authClient.organization.setActive({ organizationId: org });
      if (res.error) {
        toast.error(t("other1.noAccessToWorkspaceNotifications"));
        clean();
        return;
      }
      // A full load: every cached list belongs to the previous workspace.
      window.location.replace("/notifications");
    })();
  }, [org, activeOrg, router, t]);
  return needed;
}
