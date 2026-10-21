"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck, CircleDot, MessageSquare, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { STATUS_META, timeAgo } from "@/components/feedback-meta";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type NotificationItem, qk } from "@/lib/api";
import { cn } from "@/lib/utils";

type NotificationsResponse = { items: NotificationItem[]; unreadCount: number };

function describe(n: NotificationItem): { icon: typeof Bell; text: string } {
  const who = n.data.actorName ?? "Someone";
  switch (n.type) {
    case "feedback.created":
      return { icon: CircleDot, text: "New feedback" };
    case "feedback.assigned":
      return { icon: UserPlus, text: `${who} assigned you` };
    case "feedback.status_changed":
      return {
        icon: CircleDot,
        text: `${who} marked it ${n.data.status ? STATUS_META[n.data.status].label.toLowerCase() : "updated"}`,
      };
    case "comment.created":
      return { icon: MessageSquare, text: `${who} replied` };
    default:
      return { icon: Bell, text: "Update" };
  }
}

/** In-app notifications (wave-1 §8): unread badge, recent list, mark read, jump to the item. */
export function NotificationsBell() {
  const qc = useQueryClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: qk.notifications,
    queryFn: () => api<NotificationsResponse>("/notifications?limit=30"),
    refetchInterval: 30_000,
  });
  const markRead = useMutation({
    mutationFn: (body: { ids: string[] } | { all: true }) =>
      api("/notifications/read", { method: "POST", json: body }),
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: qk.notifications });
      const prev = qc.getQueryData<NotificationsResponse>(qk.notifications);
      if (prev) {
        const ids = "ids" in body ? new Set(body.ids) : null;
        const now = new Date().toISOString();
        let cleared = 0;
        const items = prev.items.map((n) => {
          if (n.readAt || (ids && !ids.has(n.id))) return n;
          cleared++;
          return { ...n, readAt: now };
        });
        qc.setQueryData<NotificationsResponse>(qk.notifications, {
          items,
          unreadCount: ids ? Math.max(0, prev.unreadCount - cleared) : 0,
        });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(qk.notifications, ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.notifications }),
  });

  const unread = query.data?.unreadCount ?? 0;
  const items = query.data?.items ?? [];

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
            disabled={!unread || markRead.isPending}
            onClick={() => markRead.mutate({ all: true })}
          >
            <CheckCheck /> Mark all read
          </Button>
        </div>
        <div className="max-h-[min(26rem,70svh)] overflow-y-auto">
          {query.isPending && (
            <div className="space-y-2 p-3">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          )}
          {query.isError && <p className="p-4 text-sm text-destructive">Couldn&apos;t load notifications.</p>}
          {query.isSuccess && items.length === 0 && (
            <div className="px-6 py-10 text-center">
              <Bell className="mx-auto mb-2 size-5 text-muted-foreground" />
              <p className="text-sm font-medium">You&apos;re all caught up</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Assignments, replies and new reports show up here.
              </p>
            </div>
          )}
          <ul className="divide-y">
            {items.map((n) => {
              const { icon: Icon, text } = describe(n);
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    className={cn(
                      "flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted focus-visible:outline-none",
                      !n.readAt && "bg-blue-500/[0.04]",
                    )}
                    onClick={() => {
                      if (!n.readAt) markRead.mutate({ ids: [n.id] });
                      setOpen(false);
                      if (n.feedbackId) router.push(`/inbox?status=all&item=${n.feedbackId}`);
                    }}
                  >
                    <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs text-muted-foreground">
                        {text} · {n.data.projectName}
                      </span>
                      <span className="block truncate text-sm">
                        {n.data.number !== undefined && (
                          <span className="mr-1 font-mono text-xs text-muted-foreground">
                            #{n.data.number}
                          </span>
                        )}
                        {n.data.title || "Untitled feedback"}
                      </span>
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
              );
            })}
          </ul>
        </div>
      </PopoverContent>
    </Popover>
  );
}
