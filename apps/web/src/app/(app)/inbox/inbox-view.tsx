"use client";

import { FEEDBACK_STATUSES, type FeedbackStatus, isClosedStatus } from "@pinwren/core";
import { useQuery } from "@tanstack/react-query";
import {
  Camera,
  CircleDot,
  Columns3,
  Inbox as InboxIcon,
  Keyboard,
  List,
  MessageSquare,
  Paperclip,
  Search,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ButtonLink } from "@/components/button-link";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  KIND_META,
  PriorityIcon,
  pathOf,
  STATUS_META,
  StatusIcon,
  timeAgo,
} from "@/components/feedback-meta";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserAvatar } from "@/components/user-avatar";
import { useIsMobile } from "@/hooks/use-mobile";
import { api, type FeedbackList, type FeedbackRow, type Member, type Project, qk } from "@/lib/api";
import { type FeedbackPatch, useDeleteFeedback, useMembers, useUpdateFeedback } from "@/lib/feedback-hooks";
import { cn } from "@/lib/utils";
import { BoardView } from "./board-view";
import { type DetailMenu, FeedbackDetailPanel } from "./feedback-detail";

const STATUS_TABS = [
  { value: "active", label: "Active" },
  { value: "resolved", label: "Resolved" },
  { value: "all", label: "All" },
] as const;

const KEYS: [string, string][] = [
  ["j / k", "Next / previous item"],
  ["Enter", "Open the focused item"],
  ["Esc", "Close the item, clear selection"],
  ["x", "Select the open item"],
  ["e", "Resolve / reopen"],
  ["s", "Status menu"],
  ["p", "Priority menu"],
  ["a", "Assign menu"],
  ["c", "Comment"],
  ["u", "Undo the last change"],
  ["/", "Search"],
  ["m", "Move a board card to…"],
  ["?", "This help"],
];

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  !!t.closest(
    "input, textarea, select, [contenteditable=true], [role=listbox], [role=menu], [role=alertdialog], [data-slot=dialog-content]",
  );

export function InboxView() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const searchRef = useRef<HTMLInputElement>(null);

  const projectId = params.get("project") ?? undefined;
  const view = params.get("view") === "board" ? "board" : "list";
  const status = view === "board" ? "all" : (params.get("status") ?? "active");
  const q = params.get("q") ?? "";
  const selected = params.get("item");

  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<DetailMenu>(null);
  const [help, setHelp] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const lastAnchor = useRef<string | null>(null);
  const undoStack = useRef<{ ids: string[]; patch: FeedbackPatch; label: string } | null>(null);

  const setParam = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "") next.delete(k);
        else next.set(k, v);
      }
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  const projects = useQuery({
    queryKey: qk.projects,
    queryFn: () => api<{ projects: Project[] }>("/projects"),
  });
  const members = useMembers();
  const listParams = { projectId, status, q };
  const list = useQuery({
    queryKey: qk.feedbackList(listParams),
    queryFn: () => {
      const sp = new URLSearchParams({ status, limit: "100" });
      if (projectId) sp.set("projectId", projectId);
      if (q) sp.set("q", q);
      return api<FeedbackList>(`/feedback?${sp}`);
    },
    refetchInterval: 20_000,
  });
  const items = useMemo(() => list.data?.items ?? [], [list.data]);
  const project = projects.data?.projects.find((p) => p.id === projectId);
  const update = useUpdateFeedback();
  const remove = useDeleteFeedback();

  // Selection survives refetches but drops items that left the list.
  useEffect(() => {
    setChecked((prev) => {
      const ids = new Set(items.map((i) => i.id));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [items]);

  const undo = useCallback(() => {
    const last = undoStack.current;
    if (!last) return;
    undoStack.current = null;
    update.mutate({ ids: last.ids, patch: last.patch }, { onSuccess: () => toast("Change undone") });
  }, [update]);

  const change = useCallback(
    (ids: string[], patch: FeedbackPatch, label: string) => {
      const before = items.filter((i) => ids.includes(i.id));
      // Undo restores the previous value of the first item — for bulk changes the common case.
      const first = before[0];
      if (first) {
        const prev: FeedbackPatch = {};
        if (patch.status) prev.status = first.status;
        if (patch.priority) prev.priority = first.priority;
        if (patch.assigneeIds) prev.assigneeIds = first.assigneeIds;
        undoStack.current = { ids, patch: prev, label };
      }
      update.mutate(
        { ids, patch },
        {
          onSuccess: () =>
            toast.success(label, {
              action: { label: "Undo (u)", onClick: () => undo() },
            }),
        },
      );
    },
    [items, update, undo],
  );

  const toggleCheck = useCallback(
    (id: string, range = false) => {
      setChecked((prev) => {
        const next = new Set(prev);
        if (range && lastAnchor.current) {
          const a = items.findIndex((i) => i.id === lastAnchor.current);
          const b = items.findIndex((i) => i.id === id);
          if (a >= 0 && b >= 0) {
            for (const it of items.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(it.id);
            return next;
          }
        }
        if (next.has(id)) next.delete(id);
        else next.add(id);
        lastAnchor.current = id;
        return next;
      });
    },
    [items],
  );

  // Keyboard map (blueprint 06 §5). The listener is attached once and reads the latest state from a
  // ref updated before paint, so a key pressed right after the list renders is never lost, and quick
  // j/j presses advance from the row just chosen rather than a stale URL.
  const latest = useRef({
    items,
    selected,
    view,
    checkedSize: checked.size,
    setParam,
    toggleCheck,
    change,
    undo,
  });
  // The row j/k just chose, until the URL catches up (router.replace is async).
  const pending = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (pending.current === selected) pending.current = null;
    latest.current = {
      items,
      selected,
      view,
      checkedSize: checked.size,
      setParam,
      toggleCheck,
      change,
      undo,
    };
  });
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const st = latest.current;
      const { items, view } = st;
      const selected = pending.current ?? st.selected;
      if (e.key === "Escape") {
        if (isTyping(e.target) && !(e.target as HTMLElement).closest("[data-slot=feedback-row]")) return;
        pending.current = null;
        if (selected) st.setParam({ item: null });
        else if (st.checkedSize) setChecked(new Set());
        return;
      }
      if (isTyping(e.target)) return;
      const idx = items.findIndex((i) => i.id === selected);
      const current = idx >= 0 ? items[idx] : undefined;
      const move = (to: FeedbackRow | undefined) => {
        if (!to) return;
        pending.current = to.id;
        st.setParam({ item: to.id });
      };
      const key = e.key;
      if (key === "?") {
        setHelp(true);
      } else if (key === "/") {
        searchRef.current?.focus();
      } else if (key === "u") {
        st.undo();
      } else if (view === "list" && (key === "j" || key === "ArrowDown")) {
        move(items[Math.min(idx + 1, items.length - 1)]);
      } else if (view === "list" && (key === "k" || key === "ArrowUp")) {
        move(items[Math.max(idx - 1, 0)]);
      } else if (key === "x" && current) {
        st.toggleCheck(current.id, e.shiftKey);
      } else if (key === "e" && selected) {
        const now = current?.status;
        const to: FeedbackStatus = now && isClosedStatus(now) ? "open" : "resolved";
        st.change([selected], { status: to }, to === "resolved" ? "Resolved" : "Reopened");
      } else if ((key === "s" || key === "p" || key === "a") && selected) {
        setMenu(key === "s" ? "status" : key === "p" ? "priority" : "assignee");
      } else if (key === "c" && selected) {
        document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Comment"]')?.focus();
      } else {
        return;
      }
      e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Keep the focused row in view while moving with j/k.
  useEffect(() => {
    if (!selected) return;
    document.querySelector(`[data-row-id="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const detail = selected ? (
    <FeedbackDetailPanel
      key={selected}
      id={selected}
      onClose={() => setParam({ item: null })}
      menu={menu}
      onMenuChange={setMenu}
    />
  ) : null;
  const asSheet = isMobile || view === "board";
  const checkedIds = [...checked];

  return (
    <div className="flex h-svh min-h-0 flex-col md:h-[calc(100svh-1rem)]">
      <PageHeader title={project ? project.name : "Inbox"}>
        <Tabs
          value={view}
          onValueChange={(v) => setParam({ view: v === "board" ? "board" : null, item: null })}
        >
          <TabsList className="h-7">
            <TabsTrigger value="list" className="px-2" aria-label="List view">
              <List /> <span className="hidden sm:inline">List</span>
            </TabsTrigger>
            <TabsTrigger value="board" className="px-2" aria-label="Board view">
              <Columns3 /> <span className="hidden sm:inline">Board</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Keyboard shortcuts"
          className="hidden sm:inline-flex"
          onClick={() => setHelp(true)}
        >
          <Keyboard />
        </Button>
        {project && (
          <ButtonLink
            href={`/projects/${project.id}`}
            variant="outline"
            size="sm"
            className="hidden sm:inline-flex"
          >
            Settings
          </ButtonLink>
        )}
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        {view === "list" ? (
          <Tabs value={status} onValueChange={(v) => setParam({ status: String(v), item: null })}>
            <TabsList>
              {STATUS_TABS.map((t) => (
                <TabsTrigger key={t.value} value={t.value} className="px-3">
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        ) : (
          <p className="text-sm text-muted-foreground">
            Drag cards between columns, or press <Kbd>m</Kbd> on a card.
          </p>
        )}
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            defaultValue={q}
            placeholder="Search feedback"
            aria-label="Search feedback"
            className="h-8 pr-8 pl-8"
            onKeyDown={(e) => {
              if (e.key === "Enter") setParam({ q: e.currentTarget.value, item: null });
              if (e.key === "Escape") e.currentTarget.blur();
            }}
          />
          <Kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2">/</Kbd>
        </div>
      </div>

      {view === "board" ? (
        <BoardView
          list={list}
          members={members.data?.members ?? []}
          onOpen={(id) => setParam({ item: id })}
          onMove={(id, to) => change([id], { status: to }, `Moved to ${STATUS_META[to].label}`)}
        />
      ) : (
        <div className="flex min-h-0 flex-1">
          <div
            className={cn(
              "relative flex min-h-0 min-w-0 flex-1 flex-col",
              detail && !asSheet && "max-w-[46%] border-r",
            )}
          >
            <ul
              className={cn("min-h-0 flex-1 overflow-y-auto", checked.size > 0 && "pb-20")}
              aria-label="Feedback"
            >
              {list.isPending &&
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
                  <ErrorState error={list.error} retry={() => list.refetch()} />
                </li>
              )}
              {list.isSuccess && items.length === 0 && (
                <li>
                  <EmptyInbox
                    hasProjects={!!projects.data?.projects.length}
                    searching={!!q}
                    status={status}
                  />
                </li>
              )}
              {items.map((f) => (
                <FeedbackListRow
                  key={f.id}
                  item={f}
                  showProject={!projectId}
                  members={members.data?.members}
                  active={f.id === selected}
                  checked={checked.has(f.id)}
                  selecting={checked.size > 0}
                  onCheck={(range) => toggleCheck(f.id, range)}
                  onOpen={() => {
                    pending.current = null;
                    setParam({ item: f.id });
                  }}
                />
              ))}
            </ul>
            {checked.size > 0 && (
              <BulkBar
                count={checked.size}
                members={members.data?.members ?? []}
                onStatus={(s) => {
                  change(checkedIds, { status: s }, `${checked.size} moved to ${STATUS_META[s].label}`);
                }}
                onAssign={(userId) =>
                  change(
                    checkedIds,
                    { assigneeIds: userId ? [userId] : [] },
                    userId ? `Assigned ${checked.size}` : `Unassigned ${checked.size}`,
                  )
                }
                onDelete={() => setConfirmBulkDelete(true)}
                onClear={() => setChecked(new Set())}
              />
            )}
          </div>
          {detail && !asSheet && <div className="min-h-0 flex-1 overflow-y-auto">{detail}</div>}
        </div>
      )}

      {asSheet && (
        <Sheet open={!!selected} onOpenChange={(open) => !open && setParam({ item: null })}>
          <SheetContent
            side="right"
            showCloseButton={false}
            className="p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl"
          >
            <SheetTitle className="sr-only">Feedback</SheetTitle>
            <div className="h-full overflow-y-auto">{detail}</div>
          </SheetContent>
        </Sheet>
      )}

      <ConfirmDialog
        open={confirmBulkDelete}
        onOpenChange={setConfirmBulkDelete}
        title={`Delete ${checked.size} item${checked.size === 1 ? "" : "s"}?`}
        description="They move to the trash and are purged with their files after 30 days."
        pending={remove.isPending}
        onConfirm={() =>
          remove.mutate(checkedIds, {
            onSuccess: () => {
              setConfirmBulkDelete(false);
              if (selected && checked.has(selected)) setParam({ item: null });
              setChecked(new Set());
            },
          })
        }
      />

      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>Work through the inbox without the mouse.</DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-[6rem_1fr] gap-x-4 gap-y-2 text-sm">
            {KEYS.map(([k, label]) => (
              <div key={k} className="contents">
                <dt>
                  {k.split(" / ").map((part, i) => (
                    <span key={part}>
                      {i > 0 && <span className="text-muted-foreground"> / </span>}
                      <Kbd>{part}</Kbd>
                    </span>
                  ))}
                </dt>
                <dd className="text-muted-foreground">{label}</dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-grid h-5 min-w-5 place-items-center rounded border bg-muted px-1 font-mono text-[11px] text-muted-foreground",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

function BulkBar({
  count,
  members,
  onStatus,
  onAssign,
  onDelete,
  onClear,
}: {
  count: number;
  members: Member[];
  onStatus: (s: FeedbackStatus) => void;
  onAssign: (userId: string | null) => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      className="absolute inset-x-3 bottom-3 z-10 mx-auto flex max-w-lg flex-wrap items-center gap-1 rounded-xl border bg-popover p-1.5 pl-3 text-popover-foreground shadow-lg sm:flex-nowrap"
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

function FeedbackListRow({
  item,
  showProject,
  members,
  active,
  checked,
  selecting,
  onCheck,
  onOpen,
}: {
  item: FeedbackRow;
  showProject: boolean;
  members: Member[] | undefined;
  active: boolean;
  checked: boolean;
  selecting: boolean;
  onCheck: (range: boolean) => void;
  onOpen: () => void;
}) {
  const Kind = KIND_META[item.kind].icon;
  const assignee = item.assigneeIds[0] ? members?.find((m) => m.id === item.assigneeIds[0]) : undefined;
  return (
    <li
      data-row-id={item.id}
      className={cn(
        "group relative flex items-start border-b transition-colors hover:bg-muted/60",
        active && "bg-muted",
        checked && "bg-primary/[0.06] hover:bg-primary/[0.08]",
      )}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the click only widens the checkbox hit area */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the checkbox inside is the keyboard control */}
      <div
        className={cn(
          "flex w-9 shrink-0 justify-center self-stretch pt-3.5 pl-2 transition-opacity",
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
      <button
        type="button"
        data-slot="feedback-row"
        onClick={onOpen}
        aria-current={active || undefined}
        className="flex min-w-0 flex-1 items-start gap-3 py-3 pr-4 pl-1 text-left focus-visible:bg-muted focus-visible:outline-none"
      >
        <StatusIcon status={item.status} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
              #{item.number}
            </span>
            <p className="min-w-0 flex-1 truncate text-sm font-medium">{item.title || item.body}</p>
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <Kind className="size-3.5 shrink-0" aria-label={KIND_META[item.kind].label} />
            {showProject && <span className="max-w-[40%] shrink-0 truncate">{item.projectName}</span>}
            {item.pageUrl && <span className="min-w-0 truncate font-mono">{pathOf(item.pageUrl)}</span>}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 text-muted-foreground">
          <div className="flex h-5 items-center gap-2">
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
          <span className="text-xs whitespace-nowrap">{timeAgo(item.createdAt)}</span>
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
