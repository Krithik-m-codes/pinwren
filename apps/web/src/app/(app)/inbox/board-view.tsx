"use client";

import { FEEDBACK_STATUSES, type FeedbackStatus } from "@pinwren/core";
import { ArrowRightLeft, MessageSquare, Paperclip } from "lucide-react";
import { useState } from "react";
import { KIND_META, PriorityIcon, pathOf, STATUS_META, StatusIcon } from "@/components/feedback-meta";
import { ErrorState } from "@/components/states";
import { Thumb } from "@/components/thumb";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/user-avatar";
import { assetUrl, type FeedbackRow, type Member } from "@/lib/api";
import { useMembers } from "@/lib/viewer";
import { cn } from "@/lib/utils";
import { DueDate, type Feed } from "./inbox-list";
import { LabelChips } from "./pickers";

const DRAG_TYPE = "application/x-pinwren-feedback";

/**
 * Kanban by status (blueprint 06 §3.3). Drag and drop with the pointer; every card also has a
 * "Move to…" menu (`m` on a focused card) so the board works without a mouse.
 */
export function BoardView({
  feed: list,
  readOnly,
  onOpen,
  onMove,
}: {
  feed: Feed;
  /** Viewers see the board but can't move cards. */
  readOnly: boolean;
  onOpen: (id: string) => void;
  onMove: (id: string, to: FeedbackStatus) => void;
}) {
  const members = useMembers();
  const [over, setOver] = useState<FeedbackStatus | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const items = list.items;

  if (list.isError) return <ErrorState error={list.error} retry={list.refetch} />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {list.hasMore && (
        <p className="flex items-center justify-center gap-3 border-b px-3 py-1.5 text-xs text-muted-foreground">
          <span className="tabular-nums">
            Showing {items.length}
            {list.total !== null ? ` of ${list.total}` : ""} items
          </span>
          <Button
            variant="outline"
            size="xs"
            disabled={list.loadingMore}
            onClick={list.loadMore}
            data-testid="load-more"
          >
            {list.loadingMore ? "Loading…" : list.loadMoreFailed ? "Couldn't load more. Retry" : "Load more"}
          </Button>
        </p>
      )}
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3" data-testid="board">
        {FEEDBACK_STATUSES.map((status) => {
          const column = items.filter((i) => i.status === status);
          return (
            <section
              key={status}
              aria-label={STATUS_META[status].label}
              data-column={status}
              onDragOver={(e) => {
                if (readOnly || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setOver(status);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const id = e.dataTransfer.getData(DRAG_TYPE);
                const item = items.find((i) => i.id === id);
                if (item && item.status !== status) onMove(id, status);
              }}
              className={cn(
                "flex w-[17rem] shrink-0 flex-col rounded-xl bg-muted/50 transition-colors dark:bg-muted/30",
                over === status && "bg-primary/[0.07] ring-2 ring-primary/30 dark:bg-primary/10",
              )}
            >
              <header className="flex items-center gap-2 px-3 pt-3 pb-2">
                <StatusIcon status={status} />
                <h2 className="text-sm font-medium">{STATUS_META[status].label}</h2>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {list.isLoading ? "" : column.length}
                </span>
              </header>
              <ul className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
                {list.isLoading && status === "open" && (
                  <>
                    <Skeleton className="h-24 rounded-lg" />
                    <Skeleton className="h-20 rounded-lg" />
                  </>
                )}
                {list.isSuccess && column.length === 0 && (
                  <li className="grid h-20 place-items-center rounded-lg border border-dashed px-3 text-center text-xs text-muted-foreground">
                    Drop here
                  </li>
                )}
                {column.map((item) => (
                  <BoardCard
                    key={item.id}
                    item={item}
                    assignee={members.find((m) => m.id === item.assigneeIds[0])}
                    onOpen={() => onOpen(item.id)}
                    readOnly={readOnly}
                    onMove={(to) => onMove(item.id, to)}
                    menuOpen={moving === item.id}
                    onMenuOpenChange={(o) => setMoving(o ? item.id : null)}
                  />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function BoardCard({
  item,
  readOnly,
  assignee,
  onOpen,
  onMove,
  menuOpen,
  onMenuOpenChange,
}: {
  item: FeedbackRow;
  readOnly: boolean;
  assignee: Member | undefined;
  onOpen: () => void;
  onMove: (to: FeedbackStatus) => void;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
}) {
  const Kind = KIND_META[item.kind].icon;
  const [dragging, setDragging] = useState(false);
  return (
    <li
      draggable={!readOnly}
      data-card={item.id}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, item.id);
        e.dataTransfer.effectAllowed = "move";
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      className={cn(
        "group relative rounded-lg border bg-card shadow-xs transition-[box-shadow,opacity] hover:shadow-sm",
        !readOnly && "cursor-grab active:cursor-grabbing",
        dragging && "opacity-40",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        onKeyDown={(e) => {
          if (!readOnly && e.key === "m" && !e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            e.stopPropagation();
            onMenuOpenChange(true);
          }
        }}
        aria-label={`#${item.number} ${item.title || item.body}${readOnly ? "" : ". Press m to move."}`}
        className="block w-full rounded-lg p-2.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {item.screenshotAssetId && (
          <div className="relative mb-2 aspect-[16/9] overflow-hidden rounded-md border bg-muted">
            <Thumb src={assetUrl(item.screenshotAssetId)} />
          </div>
        )}
        <p className="line-clamp-2 pr-6 text-sm leading-snug font-medium">{item.title || item.body}</p>
        {item.pageUrl && (
          <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{pathOf(item.pageUrl)}</p>
        )}
        {(item.labels.length > 0 || item.dueAt) && (
          <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <LabelChips labels={item.labels} max={3} />
            {item.dueAt && <DueDate iso={item.dueAt} status={item.status} />}
          </div>
        )}
        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono tabular-nums">#{item.number}</span>
          <Kind className="size-3.5" aria-label={KIND_META[item.kind].label} />
          <PriorityIcon priority={item.priority} />
          {item.commentCount > 0 && (
            <span className="flex items-center gap-0.5 tabular-nums">
              <MessageSquare className="size-3.5" /> {item.commentCount}
            </span>
          )}
          {item.attachmentCount > 0 && <Paperclip className="size-3.5" aria-label="Has attachments" />}
          <span className="ml-auto">
            {assignee ? (
              <UserAvatar name={assignee.name} image={assignee.image} className="size-5" />
            ) : (
              <span className="sr-only">Unassigned</span>
            )}
          </span>
        </div>
      </button>
      {!readOnly && (
        <DropdownMenu open={menuOpen} onOpenChange={onMenuOpenChange}>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Move #${item.number} to…`}
                className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100"
              />
            }
          >
            <ArrowRightLeft />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Move to…</DropdownMenuLabel>
              {FEEDBACK_STATUSES.filter((s) => s !== item.status).map((s) => (
                <DropdownMenuItem key={s} onClick={() => onMove(s)}>
                  <StatusIcon status={s} /> {STATUS_META[s].label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}
