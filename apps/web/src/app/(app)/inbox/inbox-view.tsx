"use client";

import { type FeedbackStatus, isClosedStatus } from "@pinwren/core";
import { Columns3, Keyboard, List } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ButtonLink } from "@/components/button-link";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { STATUS_META } from "@/components/feedback-meta";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIsMobile } from "@/hooks/use-mobile";
import type { FeedbackRow } from "@/lib/api";
import { filtersFromParams, layoutFromParams, listArgs } from "@/lib/inbox-filters";
import {
  errorMessage,
  useDeleteFeedbackMutation,
  useListFeedbackQuery,
  useProjectsQuery,
  useUpdateFeedbackMutation,
} from "@/lib/store/api";
import type { FeedbackPatch } from "@/lib/store/api/feedback";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import {
  changeRecorded,
  menuChanged,
  selectionCleared,
  selectionPruned,
  selectionToggled,
} from "@/lib/store/slices/inbox";
import { followChanged } from "@/lib/store/slices/realtime";
import { shortcutsToggled } from "@/lib/store/slices/ui";
import { useUrlParams } from "@/lib/use-url-params";
import { cn } from "@/lib/utils";
import { useViewer } from "@/lib/viewer";
import { BoardView } from "./board-view";
import { FeedbackDetailPanel } from "./feedback-detail";
import { InboxList } from "./inbox-list";
import { InboxToolbar } from "./inbox-toolbar";
import { Kbd } from "./kbd";

const KEYS: [string, string][] = [
  ["⌘K", "Command palette"],
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

/** Keys that change something: ignored for viewers. */
const WRITE_KEYS = new Set(["x", "e", "s", "p", "a", "c", "u"]);

/**
 * The triage inbox (blueprint 06 §3.1): filters in the URL, data from RTK Query (seeded by the server),
 * selection and pickers in the Redux `inbox` slice, live updates from the real-time stream.
 */
export function InboxView() {
  const { params, setParams } = useUrlParams();
  const isMobile = useIsMobile();
  const dispatch = useAppDispatch();
  const searchRef = useRef<HTMLInputElement>(null);
  const { canWrite } = useViewer();

  const filters = filtersFromParams(params);
  const layout = layoutFromParams(params);
  const args = listArgs(filters, layout);
  const selected = params.get("item");
  const projectId = filters.projectId;

  const projects = useProjectsQuery(undefined);
  const list = useListFeedbackQuery(args);
  const items = list.data?.items ?? [];
  const project = projects.data?.projects.find((p) => p.id === projectId);
  const [update] = useUpdateFeedbackMutation();
  const [remove, removal] = useDeleteFeedbackMutation();
  const selection = useAppSelector((s) => s.inbox.selection);
  const lastChange = useAppSelector((s) => s.inbox.lastChange);
  const help = useAppSelector((s) => s.ui.shortcutsOpen);
  const [bulkDelete, setBulkDelete] = useState(false);

  // Selection survives refetches but drops rows that left the list.
  useEffect(() => {
    if (list.data) dispatch(selectionPruned(list.data.items.map((i) => i.id)));
  }, [list.data, dispatch]);

  // Entering the inbox shows anything that arrived while it was away.
  useEffect(() => {
    dispatch(followChanged(true));
  }, [dispatch]);

  const undo = () => {
    if (!lastChange) return;
    dispatch(changeRecorded(null));
    update({ ids: lastChange.ids, patch: lastChange.patch })
      .unwrap()
      .then(() => toast("Change undone"))
      .catch((e: unknown) => toast.error(errorMessage(e)));
  };

  const change = (ids: string[], patch: FeedbackPatch, label: string) => {
    // Undo restores the previous value of the first item — for bulk changes the common case.
    const first = items.find((i) => ids.includes(i.id));
    if (first) {
      const prev: FeedbackPatch = {};
      if (patch.status) prev.status = first.status;
      if (patch.priority) prev.priority = first.priority;
      if (patch.assigneeIds) prev.assigneeIds = first.assigneeIds;
      if (patch.roundId !== undefined) prev.roundId = first.roundId;
      dispatch(changeRecorded({ ids, patch: prev, label }));
    }
    update({ ids, patch })
      .unwrap()
      .then(() =>
        toast.success(label, { action: { label: "Undo (u)", onClick: () => latest.current.undo() } }),
      )
      .catch((e: unknown) => toast.error(errorMessage(e)));
  };

  const toggleCheck = (id: string, range = false) =>
    dispatch(selectionToggled({ id, range, order: items.map((i) => i.id) }));

  // Keyboard map (blueprint 06 §5). The listener is attached once and reads the latest state from a ref
  // updated before paint, so a key pressed right after the list renders is never lost, and quick j/j
  // presses advance from the row just chosen rather than a URL that hasn't caught up.
  const snapshot = {
    items,
    selected,
    layout,
    selectionSize: selection.length,
    setParams,
    toggleCheck,
    change,
    undo,
    canWrite,
  };
  const latest = useRef(snapshot);
  const pending = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (pending.current === selected) pending.current = null;
    latest.current = snapshot;
  });
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const st = latest.current;
      const { items } = st;
      const selected = pending.current ?? st.selected;
      if (e.key === "Escape") {
        if (isTyping(e.target) && !(e.target as HTMLElement).closest("[data-slot=feedback-row]")) return;
        pending.current = null;
        if (selected) st.setParams({ item: null });
        else if (st.selectionSize) dispatch(selectionCleared());
        return;
      }
      if (isTyping(e.target)) return;
      const key = e.key;
      if (!st.canWrite && WRITE_KEYS.has(key)) return;
      const idx = items.findIndex((i) => i.id === selected);
      const current = idx >= 0 ? items[idx] : undefined;
      const move = (to: FeedbackRow | undefined) => {
        if (!to) return;
        pending.current = to.id;
        st.setParams({ item: to.id });
      };
      if (key === "?") {
        dispatch(shortcutsToggled(true));
      } else if (key === "/") {
        searchRef.current?.focus();
      } else if (key === "u") {
        st.undo();
      } else if (st.layout === "list" && (key === "j" || key === "ArrowDown")) {
        move(items[Math.min(idx + 1, items.length - 1)]);
      } else if (st.layout === "list" && (key === "k" || key === "ArrowUp")) {
        move(items[Math.max(idx - 1, 0)]);
      } else if (key === "x" && current) {
        st.toggleCheck(current.id, e.shiftKey);
      } else if (key === "e" && selected) {
        const now = current?.status;
        const to: FeedbackStatus = now && isClosedStatus(now) ? "open" : "resolved";
        st.change([selected], { status: to }, to === "resolved" ? "Resolved" : "Reopened");
      } else if ((key === "s" || key === "p" || key === "a") && selected) {
        dispatch(menuChanged(key === "s" ? "status" : key === "p" ? "priority" : "assignee"));
      } else if (key === "c" && selected) {
        document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Comment"]')?.focus();
      } else {
        return;
      }
      e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch]);

  // Keep the focused row in view while moving with j/k.
  useEffect(() => {
    if (!selected) return;
    document.querySelector(`[data-row-id="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const detail = selected ? (
    <FeedbackDetailPanel key={selected} id={selected} onClose={() => setParams({ item: null })} />
  ) : null;
  const asSheet = isMobile || layout === "board";

  return (
    <div className="flex h-svh min-h-0 flex-col md:h-[calc(100svh-1rem)]">
      <PageHeader title={project ? project.name : "Inbox"}>
        <Tabs
          value={layout}
          onValueChange={(v) => setParams({ layout: v === "board" ? "board" : null, view: null, item: null })}
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
          onClick={() => dispatch(shortcutsToggled(true))}
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

      <InboxToolbar filters={filters} layout={layout} searchRef={searchRef} />

      {layout === "board" ? (
        <BoardView
          list={list}
          readOnly={!canWrite}
          onOpen={(id) => setParams({ item: id })}
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
            <InboxList
              list={list}
              filters={filters}
              selected={selected}
              hasProjects={!!projects.data?.projects.length}
              onOpen={(id) => {
                pending.current = null;
                setParams({ item: id });
              }}
              onCheck={toggleCheck}
              onChange={change}
              onDelete={() => setBulkDelete(true)}
            />
          </div>
          {detail && !asSheet && <div className="min-h-0 flex-1 overflow-y-auto">{detail}</div>}
        </div>
      )}

      {asSheet && (
        <Sheet open={!!selected} onOpenChange={(open) => !open && setParams({ item: null })}>
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
        open={bulkDelete}
        onOpenChange={setBulkDelete}
        title={`Delete ${selection.length} item${selection.length === 1 ? "" : "s"}?`}
        description="They move to the trash and are purged with their files after 30 days."
        pending={removal.isLoading}
        onConfirm={() => {
          const ids = [...selection];
          remove(ids)
            .unwrap()
            .then((n) => {
              toast.success(n === 1 ? "Feedback deleted" : `${n} items deleted`);
              setBulkDelete(false);
              if (selected && ids.includes(selected)) setParams({ item: null });
              dispatch(selectionCleared());
            })
            .catch((e: unknown) => toast.error(errorMessage(e)));
        }}
      />

      <Dialog open={help} onOpenChange={(o) => dispatch(shortcutsToggled(o))}>
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
