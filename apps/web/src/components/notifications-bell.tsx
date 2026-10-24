"use client";

import { Bell, CheckCheck } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { timeAgo } from "@/components/feedback-meta";
import { NotificationIcon, useUnreadTitle } from "@/components/notifications/notification-parts";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { notificationHref, notificationSubject, notificationText } from "@/lib/notification-text";
import { useMarkNotificationsReadMutation, useNotificationsQuery } from "@/lib/store/api";
import { cn } from "@/lib/utils";

/**
 * In-app notifications: unread badge (also in the tab title), the latest 30, mark read, jump to the item,
 * and "View all" for the notifications page. The stream's `notification.created` refreshes it the moment
 * a row exists; polling is only the fallback.
 */
export function NotificationsBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const query = useNotificationsQuery(undefined, { pollingInterval: 60_000, skipPollingIfUnfocused: true });
  const [markRead, marking] = useMarkNotificationsReadMutation();

  const unread = query.data?.unreadCount ?? 0;
  const items = query.data?.items ?? [];
  useUnreadTitle(unread);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="relative"
            aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
            data-testid="notifications-bell"
          />
        }
      >
        <Bell />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-blue-600 px-1 text-[10px] leading-none font-semibold text-white tabular-nums">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-1.5rem))] gap-0 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-sm font-semibold">Notifications</p>
          <Button
            variant="ghost"
            size="xs"
            disabled={!unread || marking.isLoading}
            onClick={() => void markRead({ all: true })}
          >
            <CheckCheck /> Mark all read
          </Button>
        </div>
        <div className="max-h-[min(26rem,70svh)] overflow-y-auto">
          {query.isLoading && (
            <div className="space-y-2 p-3">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          )}
          {query.isError && (
            <div
              role="alert"
              className="flex items-center justify-between gap-2 p-4 text-sm text-destructive"
            >
              Couldn&apos;t load notifications.
              <Button size="xs" variant="outline" onClick={() => void query.refetch()}>
                Retry
              </Button>
            </div>
          )}
          {query.isSuccess && items.length === 0 && (
            <div className="px-6 py-10 text-center">
              <Bell className="mx-auto mb-2 size-5 text-muted-foreground" />
              <p className="text-sm font-medium">You&apos;re all caught up</p>
              <p className="mt-1 text-xs text-muted-foreground">
                New reports, assignments, replies and mentions show up here.
              </p>
            </div>
          )}
          <ul className="divide-y">
            {items.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  data-testid="notification-item"
                  className={cn(
                    "flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted focus-visible:outline-none",
                    !n.readAt && "bg-blue-500/[0.04]",
                  )}
                  onClick={() => {
                    if (!n.readAt) void markRead({ ids: [n.id] });
                    setOpen(false);
                    router.push(notificationHref(n) as Route);
                  }}
                >
                  <NotificationIcon type={n.type} className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs text-muted-foreground">
                      {notificationText(n)}
                      {n.data.projectName ? ` · ${n.data.projectName}` : ""}
                    </span>
                    <span className="block truncate text-sm">{notificationSubject(n)}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1.5">
                    <span className="text-[11px] text-muted-foreground">{timeAgo(n.createdAt)}</span>
                    {!n.readAt && (
                      <span className="size-1.5 rounded-full bg-blue-600">
                        <span className="sr-only">Unread</span>
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="border-t p-1.5">
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            data-testid="notifications-view-all"
            className="flex h-8 items-center justify-center rounded-md text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            View all notifications
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
