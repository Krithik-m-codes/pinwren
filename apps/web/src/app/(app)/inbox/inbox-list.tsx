"use client";

import {
  FEEDBACK_STATUSES,
  type FeedbackStatus,
  isClosedStatus,
  PRIORITIES,
  type Priority,
  type ViewFilters,
} from "@pinwren/core";
import {
  ArrowUp,
  BadgeCheck,
  CalendarClock,
  Camera,
  CircleDot,
  Download,
  Film,
  Flag,
  Inbox as InboxIcon,
  Loader2,
  MessageSquare,
  Paperclip,
  RotateCcw,
  Search,
  SearchX,
  Tag,
  Target,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ButtonLink } from "@/components/button-link";
import {
  KIND_META,
  LocalDate,
  PRIORITY_META,
  PriorityIcon,
  pathOf,
  RelativeTime,
  STATUS_META,
  StatusIcon,
} from "@/components/feedback-meta";
import { NotInstalledEmpty } from "@/components/not-installed-empty";
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
import { type FeedbackRow, type ItemLabel, isForbidden, type Member, type PresenceUser } from "@/lib/api";
import { CLEAR_FILTERS, exportUrl, extraFilterCount, type FeedbackListArgs } from "@/lib/inbox-filters";
import { useRoundsQuery } from "@/lib/store/api";
import type { FeedbackFields, FeedbackPatch, ItemChange } from "@/lib/store/api/feedback";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { selectionCleared } from "@/lib/store/slices/inbox";
import { followChanged, freshCleared, newItemsShown } from "@/lib/store/slices/realtime";
import { useUrlParams } from "@/lib/use-url-params";
import { useMounted } from "@/lib/use-synced-state";
import { cn } from "@/lib/utils";
import { useMembers, useViewer } from "@/lib/viewer";
import { LabelChips, LabelPicker } from "./pickers";

/** The list as the inbox shows it: every loaded page, the total, and "load more". */
export type Feed = {
  items: FeedbackRow[];
  /** Every match, all pages (null until the first page arrives). */
  total: number | null;
  isLoading: boolean;
  isError: boolean;
  isSuccess: boolean;
  error?: unknown;
  refetch: () => void;
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreFailed: boolean;
  loadMore: () => void;
};

const AT_TOP_PX = 48;

const subscribeNever = () => () => {
  // the clock isn't watched: an item turns overdue on the next render
};

/** Start the browser download of an export (the API answers with `Content-Disposition: attachment`). */
export function download(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
}

export const EXPORT_FORMATS = [
  { value: "csv", label: "CSV (spreadsheet)" },
  { value: "json", label: "JSON" },
  { value: "pdf", label: "PDF (first 1,000)" },
] as const;

/**
 * The list column: rows with presence avatars, the "N new" pill while scrolled (new items come in
 * live when the list is at the top), more pages as the list scrolls, and the bulk bar for checked rows.
 */
export function InboxList({
  feed,
  args,
  filters,
  trash,
  selected,
  hasProjects,
  onOpen,
  onCheck,
  onChange,
  onChangeEach,
  onDelete,
  onRestore,
  onPurge,
}: {
  feed: Feed;
  args: FeedbackListArgs;
  filters: ViewFilters;
  trash: boolean;
  selected: string | null;
  hasProjects: boolean;
  onOpen: (id: string) => void;
  onCheck: (id: string, range: boolean) => void;
  onChange: (ids: string[], patch: FeedbackPatch, label: string, optimistic?: FeedbackFields) => void;
  onChangeEach: (each: ItemChange[], label: string) => void;
  onDelete: () => void;
  onRestore: () => void;
  onPurge: () => void;
}) {
  const dispatch = useAppDispatch();
  const scroller = useRef<HTMLUListElement>(null);
  // The list is server-rendered; `data-ready` marks when it is interactive (keyboard map attached).
  const ready = useMounted();
  const members = useMembers();
  const { canWrite, isAdmin, userId } = useViewer();
  const selection = useAppSelector((s) => s.inbox.selection);
  const density = useAppSelector((s) => s.inbox.prefs.density);
  const follow = useAppSelector((s) => s.realtime.follow);
  const presence = useAppSelector((s) => s.realtime.presence);
  const fresh = useAppSelector((s) => s.realtime.fresh);
  const pendingAll = useAppSelector((s) => s.realtime.pending);
  // Live state exists only in this browser: leave it out until hydration is done, so the server HTML and the
  // first client render agree (boundaries hydrate one by one while the stream may already be delivering).
  const pending =
    ready && !trash ? pendingAll.filter((p) => !filters.projectId || p.projectId === filters.projectId) : [];
  const items = feed.items;
  const checked = new Set(selection);
  const selectedRows = items.filter((i) => checked.has(i.id));

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
        aria-label={trash ? "Trash" : "Feedback"}
        data-ready={ready || undefined}
        aria-live="polite"
        aria-busy={feed.isLoading || undefined}
      >
        {feed.isLoading &&
          ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"].map((k) => (
            <li key={k} className="flex items-center gap-3 border-b px-4 py-3">
              <Skeleton className="size-4 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </li>
          ))}
        {feed.isError && (
          <li>
            {trash && isForbidden(feed.error) ? (
              <EmptyState
                icon={Trash2}
                title="Only Admins can open the trash"
                description="Ask a workspace Admin to restore an item you need back."
              />
            ) : (
              <ErrorState error={feed.error} retry={feed.refetch} />
            )}
          </li>
        )}
        {feed.isSuccess && items.length === 0 && (
          <li>
            <EmptyInbox
              hasProjects={hasProjects}
              filters={filters}
              trash={trash}
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
            selectable={trash ? isAdmin : canWrite}
            fresh={ready && fresh.includes(f.id)}
            compact={density === "compact"}
            trash={trash}
            onFreshSeen={() => dispatch(freshCleared(f.id))}
            onCheck={(range) => onCheck(f.id, range)}
            onOpen={() => onOpen(f.id)}
          />
        ))}
        {items.length > 0 && <ListFooter feed={feed} />}
      </ul>
      {selection.length > 0 &&
        (trash
          ? isAdmin && (
              <TrashBar
                count={selection.length}
                onRestore={onRestore}
                onPurge={onPurge}
                onClear={() => dispatch(selectionCleared())}
              />
            )
          : canWrite && (
              <BulkBar
                count={selection.length}
                rows={selectedRows}
                members={members}
                projectId={filters.projectId}
                canDelete={isAdmin}
                onStatus={(s) =>
                  onChange(selection, { status: s }, `${selection.length} moved to ${STATUS_META[s].label}`)
                }
                onPriority={(p) =>
                  onChange(
                    selection,
                    { priority: p },
                    `${selection.length} set to ${PRIORITY_META[p].label} priority`,
                  )
                }
                onAssign={(id) =>
                  onChange(
                    selection,
                    { assigneeIds: id ? [id] : [] },
                    id ? `Assigned ${selection.length}` : `Unassigned ${selection.length}`,
                  )
                }
                onLabels={onChangeEach}
                onRound={(id, name) =>
                  onChange(
                    selection,
                    { roundId: id },
                    id
                      ? `${selection.length} added to ${name}`
                      : `${selection.length} taken out of their round`,
                  )
                }
                onExport={(format) => download(exportUrl(args, format, selection))}
                onDelete={onDelete}
                onClear={() => dispatch(selectionCleared())}
              />
            ))}
    </>
  );
}

/** "Showing 50 of 312", and the next page when the end of the list scrolls into view. */
function ListFooter({ feed }: { feed: Feed }) {
  const sentinel = useRef<HTMLLIElement>(null);
  const { hasMore, loadingMore, loadMoreFailed, loadMore } = feed;
  const latest = useRef(loadMore);
  useEffect(() => {
    latest.current = loadMore;
  });
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore || loadingMore || loadMoreFailed || typeof IntersectionObserver === "undefined") {
      return;
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) latest.current();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loadingMore, loadMoreFailed]);

  return (
    <li
      ref={sentinel}
      className="flex items-center justify-center gap-3 px-4 py-3 text-xs text-muted-foreground"
      data-testid="list-footer"
    >
      {feed.total !== null && (
        <span className="tabular-nums">
          {feed.items.length < feed.total
            ? `Showing ${feed.items.length} of ${feed.total}`
            : `${feed.total} item${feed.total === 1 ? "" : "s"}`}
        </span>
      )}
      {hasMore &&
        (loadingMore ? (
          <span className="flex items-center gap-1.5">
            <Loader2 className="size-3.5 animate-spin" /> Loading more…
          </span>
        ) : (
          <Button variant="outline" size="xs" onClick={loadMore} data-testid="load-more">
            {loadMoreFailed ? "Couldn't load more. Retry" : "Load more"}
          </Button>
        ))}
    </li>
  );
}

function TrashBar({
  count,
  onRestore,
  onPurge,
  onClear,
}: {
  count: number;
  onRestore: () => void;
  onPurge: () => void;
  onClear: () => void;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Trash actions"
      className="absolute inset-x-3 bottom-3 z-10 mx-auto flex max-w-xl flex-wrap items-center gap-1 rounded-xl border bg-popover p-1.5 pl-3 text-popover-foreground shadow-lg sm:flex-nowrap"
    >
      <span className="mr-auto text-sm font-medium tabular-nums">{count} selected</span>
      <Button variant="ghost" size="sm" onClick={onRestore}>
        <RotateCcw /> Restore
      </Button>
      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={onPurge}>
        <Trash2 /> Delete forever
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Clear selection" onClick={onClear}>
        <X />
      </Button>
    </div>
  );
}

/** The labels every one of `rows` carries (checked in the bulk picker). */
export function sharedLabels(rows: readonly FeedbackRow[]): ItemLabel[] {
  const [first, ...rest] = rows;
  if (!first) return [];
  return first.labels.filter((l) => rest.every((r) => r.labels.some((x) => x.id === l.id)));
}

/**
 * The bulk label picker's toggle as one change per item: a label checked now is added to every item, one
 * unchecked is removed from every item, and each item keeps its other labels. Unchanged items are left out.
 */
export function bulkLabelChanges(rows: readonly FeedbackRow[], next: readonly ItemLabel[]): ItemChange[] {
  const shared = sharedLabels(rows);
  const added = next.filter((l) => !shared.some((s) => s.id === l.id));
  const removed = new Set(shared.filter((s) => !next.some((l) => l.id === s.id)).map((s) => s.id));
  const out: ItemChange[] = [];
  for (const r of rows) {
    const labels = r.labels.filter((l) => !removed.has(l.id));
    for (const a of added) if (!labels.some((l) => l.id === a.id)) labels.push(a);
    const same =
      labels.length === r.labels.length && labels.every((l) => r.labels.some((x) => x.id === l.id));
    if (!same) out.push({ id: r.id, patch: { labelIds: labels.map((l) => l.id) }, optimistic: { labels } });
  }
  return out;
}

function BulkBar({
  count,
  rows,
  members,
  projectId,
  canDelete,
  onStatus,
  onPriority,
  onAssign,
  onLabels,
  onRound,
  onExport,
  onDelete,
  onClear,
}: {
  count: number;
  rows: FeedbackRow[];
  members: Member[];
  projectId: string | undefined;
  canDelete: boolean;
  onStatus: (s: FeedbackStatus) => void;
  onPriority: (p: Priority) => void;
  onAssign: (userId: string | null) => void;
  onLabels: (each: ItemChange[], label: string) => void;
  onRound: (roundId: string | null, name: string) => void;
  onExport: (format: "csv" | "json" | "pdf") => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const rounds = useRoundsQuery(projectId ?? "", { skip: !projectId });
  const active = rounds.data?.rounds.filter((r) => r.status === "active") ?? [];
  const [labelsOpen, setLabelsOpen] = useState(false);
  // Labels belong to a project: the picker needs every checked item to share one.
  const projects = new Set(rows.map((r) => r.projectId));
  const labelProject = projects.size === 1 ? [...projects][0] : undefined;
  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      className="absolute inset-x-3 bottom-3 z-10 mx-auto flex max-w-2xl flex-wrap items-center gap-1 rounded-xl border bg-popover p-1.5 pl-3 text-popover-foreground shadow-lg"
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
        <DropdownMenuTrigger render={<Button variant="ghost" size="sm" data-testid="bulk-priority" />}>
          <Flag /> Priority
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" className="w-40">
          {PRIORITIES.map((p) => (
            <DropdownMenuItem key={p} onClick={() => onPriority(p)}>
              <PriorityIcon priority={p} /> {PRIORITY_META[p].label}
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
      {labelProject ? (
        <LabelPicker
          projectId={labelProject}
          selected={sharedLabels(rows)}
          canCreate
          open={labelsOpen}
          onOpenChange={setLabelsOpen}
          side="top"
          align="end"
          label="Labels of the selected items"
          trigger={
            <Button variant="ghost" size="sm" data-testid="bulk-labels">
              <Tag /> Labels
            </Button>
          }
          onChange={(next) => {
            const each = bulkLabelChanges(rows, next);
            if (each.length) onLabels(each, `Labels changed on ${each.length}`);
          }}
        />
      ) : (
        <Tooltip>
          <TooltipTrigger render={<span />}>
            <Button variant="ghost" size="sm" disabled>
              <Tag /> Labels
            </Button>
          </TooltipTrigger>
          <TooltipContent>Labels belong to a project: select items of one project.</TooltipContent>
        </Tooltip>
      )}
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
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="sm" data-testid="export-selected" />}>
          <Download /> Export
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" className="w-44">
          {EXPORT_FORMATS.map((f) => (
            <DropdownMenuItem key={f.value} onClick={() => onExport(f.value)}>
              {f.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {canDelete && (
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 /> Delete
        </Button>
      )}
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

/** A due date: overdue (red) while the item is still open. */
export function DueDate({
  iso,
  status,
  className,
}: {
  iso: string;
  status: FeedbackStatus;
  className?: string;
}) {
  // The due day counts until its end. "Now" is read only in the browser, after hydration, so the server
  // HTML and the first client render agree; the colour follows.
  const overdue = useSyncExternalStore(
    subscribeNever,
    () => !isClosedStatus(status) && Date.parse(iso) < Date.now(),
    () => false,
  );
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 tabular-nums",
        overdue && "text-destructive",
        className,
      )}
      title={overdue ? "Overdue" : "Due"}
      data-testid="due-date"
    >
      <CalendarClock className="size-3.5" aria-label={overdue ? "Overdue" : "Due"} />
      <LocalDate iso={iso} />
    </span>
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
  trash,
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
  trash: boolean;
  onFreshSeen: () => void;
  onCheck: (range: boolean) => void;
  onOpen: () => void;
}) {
  const Kind = KIND_META[item.kind].icon;
  const assignees = item.assigneeIds
    .map((id) => members.find((m) => m.id === id))
    .filter((m): m is Member => !!m);
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
              <LabelChips labels={item.labels} max={2} className="shrink" />
              {item.dueAt && <DueDate iso={item.dueAt} status={item.status} />}
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
            {assignees.length ? (
              <span
                className="flex -space-x-1.5"
                aria-label={`Assigned to ${assignees.map((a) => a.name).join(", ")}`}
              >
                {assignees.slice(0, 2).map((a) => (
                  <UserAvatar
                    key={a.id}
                    name={a.name}
                    image={a.image}
                    className="size-5 ring-2 ring-background"
                  />
                ))}
              </span>
            ) : (
              <span className="size-5" aria-hidden />
            )}
          </div>
          {!compact &&
            (trash && item.deletedAt ? (
              <span className="text-xs whitespace-nowrap">
                Deleted <RelativeTime iso={item.deletedAt} />
              </span>
            ) : (
              <RelativeTime iso={item.createdAt} className="text-xs whitespace-nowrap" />
            ))}
        </div>
      </button>
    </li>
  );
}

function EmptyInbox({
  hasProjects,
  filters,
  trash,
  status,
}: {
  hasProjects: boolean;
  filters: ViewFilters;
  trash: boolean;
  status: string;
}) {
  const { setParams } = useUrlParams();
  if (trash) {
    return (
      <EmptyState
        icon={Trash2}
        title="The trash is empty"
        description="Deleted items stay here for 30 days, then they are purged with their files."
      />
    );
  }
  if (filters.q) {
    return (
      <EmptyState
        icon={Search}
        title="No matches"
        description={
          status === "all"
            ? "Try other words, an item number like #12, a reporter's email or part of a page URL."
            : "Nothing in this tab matches. The item may already be resolved or closed."
        }
        action={
          status !== "all" ? (
            <Button size="sm" variant="outline" onClick={() => setParams({ status: "all", item: null })}>
              Search all statuses
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setParams({ q: null, item: null })}>
              Clear search
            </Button>
          )
        }
      />
    );
  }
  if (extraFilterCount(filters) > 0) {
    return (
      <EmptyState
        icon={SearchX}
        title="No items match these filters"
        description="Remove a filter, or clear them all to see everything in this tab."
        action={
          <Button size="sm" variant="outline" onClick={() => setParams(CLEAR_FILTERS)}>
            Clear filters
          </Button>
        }
      />
    );
  }
  if (hasProjects && status === "active") {
    // A site the widget has never loaded on can't be "inbox zero": point at the Install tab instead.
    return (
      <NotInstalledEmpty>
        <EmptyState
          icon={InboxIcon}
          title="Inbox zero"
          description="Everything is triaged. New pinned comments and bug reports from your sites land here."
        />
      </NotInstalledEmpty>
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
