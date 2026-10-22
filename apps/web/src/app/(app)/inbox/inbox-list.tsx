"use client";

import { FEEDBACK_STATUSES, type FeedbackStatus, type ViewFilters } from "@pinwren/core";
import {
  ArrowUp,
  BadgeCheck,
  Camera,
  CircleDot,
  Film,
  Inbox as InboxIcon,
  MessageSquare,
  Paperclip,
  Search,
  Target,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { ButtonLink } from "@/components/button-link";
import {
  KIND_META,
  PriorityIcon,
  pathOf,
  RelativeTime,
  STATUS_META,
  StatusIcon,
} from "@/components/feedback-meta";
import { EmptyState, ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { UserAvatar } from "@/components/user-avatar";
import type { FeedbackList, FeedbackRow, Member, PresenceUser } from "@/lib/api";
import { useRoundsQuery } from "@/lib/store/api";
import type { FeedbackPatch } from "@/lib/store/api/feedback";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { selectionCleared } from "@/lib/store/slices/inbox";
import { followChanged, freshCleared, newItemsShown } from "@/lib/store/slices/realtime";
import { useMounted } from "@/lib/use-synced-state";
import { cn } from "@/lib/utils";
import { useMembers, useViewer } from "@/lib/viewer";

type ListQuery = {
  data?: FeedbackList | undefined;
  isLoading: boolean;
  isError: boolean;
  isSuccess: boolean;
  error?: unknown;
  refetch: () => unknown;
};

const AT_TOP_PX = 48;

/**
 * The list column: rows with presence avatars, the "N new" pill while scrolled (new items come in
 * live when the list is at the top), and the bulk bar for checked rows.
 */
export function InboxList({
  list,
  filters,
  selected,
  hasProjects,
  onOpen,
  onCheck,
  onChange,
  onDelete,
}: {
  list: ListQuery;
  filters: ViewFilters;
  selected: string | null;
  hasProjects: boolean;
  onOpen: (id: string) => void;
  onCheck: (id: string, range: boolean) => void;
  onChange: (ids: string[], patch: FeedbackPatch, label: string) => void;
  onDelete: () => void;
}) {
  const dispatch = useAppDispatch();
  const scroller = useRef<HTMLUListElement>(null);
  // The list is server-rendered; `data-ready` marks when it is interactive (keyboard map attached).
  const ready = useMounted();
  const members = useMembers();
  const { canWrite, userId } = useViewer();
  const selection = useAppSelector((s) => s.inbox.selection);
  const density = useAppSelector((s) => s.inbox.prefs.density);
  const follow = useAppSelector((s) => s.realtime.follow);
  const presence = useAppSelector((s) => s.realtime.presence);
  const fresh = useAppSelector((s) => s.realtime.fresh);
  const pendingAll = useAppSelector((s) => s.realtime.pending);
  // Live state exists only in this browser: leave it out until hydration is done, so the server HTML and the
  // first client render agree (boundaries hydrate one by one while the stream may already be delivering).
  const pending = ready
    ? pendingAll.filter((p) => !filters.projectId || p.projectId === filters.projectId)
    : [];
  const items = list.data?.items ?? [];
  const checked = new Set(selection);

  const onScroll = () => {
    const atTop = (scroller.current?.scrollTop ?? 0) < AT_TOP_PX;
    if (atTop !== follow) dispatch(followChanged(atTop));
  };
  const showNew = () => {
    scroller.current?.scrollTo({ top: 0, behavior: "smooth" });
    dispatch(newItemsShown());
  };

  return (
    <>
      {pending.length > 0 && (
        <div className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center">
          <Button
            size="sm"
            className="pointer-events-auto rounded-full shadow-md motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-2"
            onClick={showNew}
            data-testid="new-items-pill"
          >
            <ArrowUp /> {pending.length} new
          </Button>
        </div>
      )}
      <ul
        ref={scroller}
        onScroll={onScroll}
        className={cn("min-h-0 flex-1 overflow-y-auto", selection.length > 0 && "pb-20")}
        aria-label="Feedback"
        data-ready={ready || undefined}
        aria-live="polite"
        aria-busy={list.isLoading || undefined}
      >
        {list.isLoading &&
          ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"].map((k) => (
            <li key={k} className="flex items-center gap-3 border-b px-4 py-3">
              <Skeleton className="size-4 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </li>
          ))}
        {list.isError && (
          <li>
            <ErrorState error={list.error} retry={() => void list.refetch()} />
          </li>
        )}
        {list.isSuccess && items.length === 0 && (
          <li>
            <EmptyInbox
              hasProjects={hasProjects}
              searching={!!filters.q}
              status={filters.status ?? "active"}
            />
          </li>
        )}
        {items.map((f) => (
          <FeedbackListRow
            key={f.id}
            item={f}
            showProject={!filters.projectId}
            members={members}
            viewers={ready ? (presence[f.id] ?? []).filter((u) => u.id !== userId) : []}
            active={f.id === selected}
            checked={checked.has(f.id)}
            selecting={selection.length > 0}
            selectable={canWrite}
            fresh={ready && fresh.includes(f.id)}
            compact={density === "compact"}
            onFreshSeen={() => dispatch(freshCleared(f.id))}
            onCheck={(range) => onCheck(f.id, range)}
            onOpen={() => onOpen(f.id)}
          />
        ))}
      </ul>
      {canWrite && selection.length > 0 && (
        <BulkBar
          count={selection.length}
          members={members}
          projectId={filters.projectId}
          onStatus={(s) =>
            onChange(selection, { status: s }, `${selection.length} moved to ${STATUS_META[s].label}`)
          }
          onAssign={(id) =>
            onChange(
              selection,
              { assigneeIds: id ? [id] : [] },
              id ? `Assigned ${selection.length}` : `Unassigned ${selection.length}`,
            )
          }
          onRound={(id, name) =>
            onChange(
              selection,
              { roundId: id },
              id ? `${selection.length} added to ${name}` : `${selection.length} taken out of their round`,
            )
          }
          onDelete={onDelete}
          onClear={() => dispatch(selectionCleared())}
        />
      )}
    </>
  );
}

function BulkBar({
  count,
  members,
  projectId,
  onStatus,
  onAssign,
  onRound,
  onDelete,
  onClear,
}: {
  count: number;
  members: Member[];
  projectId: string | undefined;
  onStatus: (s: FeedbackStatus) => void;
  onAssign: (userId: string | null) => void;
  onRound: (roundId: string | null, name: string) => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const rounds = useRoundsQuery(projectId ?? "", { skip: !projectId });
  const active = rounds.data?.rounds.filter((r) => r.status === "active") ?? [];
  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      className="absolute inset-x-3 bottom-3 z-10 mx-auto flex max-w-xl flex-wrap items-center gap-1 rounded-xl border bg-popover p-1.5 pl-3 text-popover-foreground shadow-lg sm:flex-nowrap"
    >
      <span className="mr-auto text-sm font-medium tabular-nums">{count} selected</span>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="sm" />}>
          <CircleDot /> Status
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" className="w-44">
          {FEEDBACK_STATUSES.map((s) => (
            <DropdownMenuItem key={s} onClick={() => onStatus(s)}>
              <StatusIcon status={s} /> {STATUS_META[s].label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="sm" />}>
          <UserRound /> Assign
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" className="w-52">
          <DropdownMenuItem onClick={() => onAssign(null)}>Unassigned</DropdownMenuItem>
          {members.map((m) => (
            <DropdownMenuItem key={m.id} onClick={() => onAssign(m.id)}>
              <UserAvatar name={m.name} image={m.image} className="size-4" /> {m.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {projectId && (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="sm" />}>
            <Target /> Round
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-52">
            {active.length === 0 && (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">No active rounds in this project.</p>
            )}
            {active.map((r) => (
              <DropdownMenuItem key={r.id} onClick={() => onRound(r.id, r.name)}>
                {r.name}
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem onClick={() => onRound(null, "")}>No round</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="text-destructive hover:text-destructive"
        onClick={onDelete}
      >
        <Trash2 /> Delete
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Clear selection" onClick={onClear}>
        <X />
      </Button>
    </div>
  );
}

/** Teammates who have this item open right now (presence, wave-4 §1). */
export function PresenceStack({ users, className }: { users: PresenceUser[]; className?: string }) {
  if (!users.length) return null;
  const names = users.map((u) => u.name).join(", ");
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn("flex -space-x-1.5", className)}
            data-testid="presence"
            aria-label={`Viewing now: ${names}`}
          />
        }
      >
        {users.slice(0, 3).map((u) => (
          <UserAvatar key={u.id} name={u.name} image={u.image} className="size-5 ring-2 ring-background" />
        ))}
        {users.length > 3 && (
          <span className="grid size-5 place-items-center rounded-full bg-muted text-[10px] ring-2 ring-background">
            +{users.length - 3}
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent>Viewing now: {names}</TooltipContent>
    </Tooltip>
  );
}

const FRESH_MS = 4000;

function FeedbackListRow({
  item,
  showProject,
  members,
  viewers,
  active,
  checked,
  selecting,
  selectable,
  fresh,
  compact,
  onFreshSeen,
  onCheck,
  onOpen,
}: {
  item: FeedbackRow;
  showProject: boolean;
  members: Member[];
  viewers: PresenceUser[];
  active: boolean;
  checked: boolean;
  selecting: boolean;
  selectable: boolean;
  fresh: boolean;
  compact: boolean;
  onFreshSeen: () => void;
  onCheck: (range: boolean) => void;
  onOpen: () => void;
}) {
  const Kind = KIND_META[item.kind].icon;
  const assignee = item.assigneeIds[0] ? members.find((m) => m.id === item.assigneeIds[0]) : undefined;
  const latestSeen = useRef(onFreshSeen);
  useEffect(() => {
    latestSeen.current = onFreshSeen;
  });
  useEffect(() => {
    if (!fresh) return;
    const t = setTimeout(() => latestSeen.current(), FRESH_MS);
    return () => clearTimeout(t);
  }, [fresh]);

  return (
    <li
      data-row-id={item.id}
      data-fresh={fresh || undefined}
      className={cn(
        "group relative flex items-start border-b transition-colors hover:bg-muted/60",
        active && "bg-muted",
        checked && "bg-primary/[0.06] hover:bg-primary/[0.08]",
        fresh &&
          "bg-primary/[0.04] motion-safe:animate-in motion-safe:duration-300 motion-safe:fade-in motion-safe:slide-in-from-top-3",
      )}
    >
      {selectable ? (
        // The click only widens the checkbox's hit area; the checkbox inside is the keyboard control.
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
        <div
          className={cn(
            "flex w-9 shrink-0 justify-center self-stretch pl-2 transition-opacity",
            compact ? "pt-2.5" : "pt-3.5",
            !selecting && !checked && "sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100",
          )}
          onClick={(e) => {
            if (e.target === e.currentTarget) onCheck(e.shiftKey);
          }}
        >
          <Checkbox
            checked={checked}
            aria-label={`Select #${item.number}`}
            onClick={(e) => {
              e.preventDefault();
              onCheck(e.shiftKey);
            }}
          />
        </div>
      ) : (
        <span className="w-3 shrink-0" />
      )}
      <button
        type="button"
        data-slot="feedback-row"
        onClick={onOpen}
        aria-current={active || undefined}
        className={cn(
          "flex min-w-0 flex-1 items-start gap-3 pr-4 pl-1 text-left focus-visible:bg-muted focus-visible:outline-none",
          compact ? "py-2" : "py-3",
        )}
      >
        <StatusIcon status={item.status} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
              #{item.number}
            </span>
            <p className="min-w-0 flex-1 truncate text-sm font-medium">{item.title || item.body}</p>
          </div>
          {!compact && (
            <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              <Kind className="size-3.5 shrink-0" aria-label={KIND_META[item.kind].label} />
              {showProject && <span className="max-w-[40%] shrink-0 truncate">{item.projectName}</span>}
              {item.reporterGuest?.verified && (
                <span className="flex shrink-0 items-center gap-0.5 text-emerald-700 dark:text-emerald-400">
                  <BadgeCheck className="size-3.5" aria-label="Verified reporter" />
                  <span className="max-w-24 truncate">
                    {item.reporterGuest.name ?? item.reporterGuest.email}
                  </span>
                </span>
              )}
              {item.pageUrl && <span className="min-w-0 truncate font-mono">{pathOf(item.pageUrl)}</span>}
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 text-muted-foreground">
          <div className="flex h-5 items-center gap-2">
            <PresenceStack users={viewers} />
            {item.hasReplay && <Film aria-label="Has session replay" className="size-3.5" />}
            {item.hasScreenshot && <Camera aria-label="Has screenshot" className="size-3.5" />}
            {item.attachmentCount > 0 && <Paperclip aria-label="Has attachments" className="size-3.5" />}
            {item.commentCount > 0 && (
              <span className="flex items-center gap-0.5 text-xs tabular-nums">
                <MessageSquare className="size-3.5" />
                {item.commentCount}
              </span>
            )}
            <PriorityIcon priority={item.priority} />
            {assignee ? (
              <UserAvatar name={assignee.name} image={assignee.image} className="size-5" />
            ) : (
              <span className="size-5" aria-hidden />
            )}
          </div>
          {!compact && <RelativeTime iso={item.createdAt} className="text-xs whitespace-nowrap" />}
        </div>
      </button>
    </li>
  );
}

function EmptyInbox({
  hasProjects,
  searching,
  status,
}: {
  hasProjects: boolean;
  searching: boolean;
  status: string;
}) {
  if (searching) {
    return (
      <EmptyState icon={Search} title="No matches" description="Try other words, or search all statuses." />
    );
  }
  if (hasProjects && status === "active") {
    return (
      <EmptyState
        icon={InboxIcon}
        title="Inbox zero"
        description="Everything is triaged. New pinned comments and bug reports from your sites land here."
      />
    );
  }
  return (
    <EmptyState
      icon={InboxIcon}
      title="Nothing here"
      description={
        hasProjects
          ? "Nothing matches this filter yet."
          : "Create a project and add the widget to your site to start collecting feedback."
      }
      action={
        <ButtonLink href={hasProjects ? "/projects" : "/projects?new=1"} size="sm" variant="outline">
          {hasProjects ? "View projects" : "Create a project"}
        </ButtonLink>
      }
    />
  );
}
