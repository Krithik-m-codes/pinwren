"use client";

import { type FeedbackStatus, isClosedStatus } from "@pinwren/core";
import { Columns3, Keyboard, List, Trash2 } from "lucide-react";
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
import { filtersFromParams, layoutFromParams, listArgs, trashFromParams } from "@/lib/inbox-filters";
import { undoChanges } from "@/lib/inbox-undo";
import {
  errorMessage,
  useDeleteFeedbackMutation,
  useListFeedbackInfiniteQuery,
  useProjectsQuery,
  usePurgeFeedbackMutation,
  useRestoreFeedbackMutation,
  useUpdateFeedbackMutation,
} from "@/lib/store/api";
import {
  type FeedbackFields,
  type FeedbackPatch,
  type ItemChange,
  listItems,
} from "@/lib/store/api/feedback";
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
import { type Feed, InboxList } from "./inbox-list";
import { InboxToolbar } from "./inbox-toolbar";
import { Kbd } from "./kbd";
import { SetupChecklist } from "@/components/setup-checklist";

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
  ["l", "Labels menu"],
  ["r", "Rename the item"],
  ["c", "Comment"],
  ["u", "Undo the last change"],
  ["/", "Search"],
  ["g m", "My work (assigned to me)"],
  ["m", "Move a board card to…"],
  ["?", "This help"],
];

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  !!t.closest(
    "input, textarea, select, [contenteditable=true], [role=listbox], [role=menu], [role=alertdialog], [data-slot=dialog-content]",
  );

/** Keys that change something: ignored for viewers. */
const WRITE_KEYS = new Set(["x", "e", "s", "p", "a", "l", "r", "c", "u"]);

/** How long the second key of a `g …` shortcut may follow the `g`. */

/**
 * The triage inbox (blueprint 06 §3.1): filters in the URL, data from RTK Query (seeded by the server, a
 * page at a time), selection and pickers in the Redux `inbox` slice, live updates from the real-time
 * stream. `?trash=1` is the trash (Admins): restore or delete for good.
 */
export function InboxView() {
  const { params, setParams } = useUrlParams();
  const isMobile = useIsMobile();
  const dispatch = useAppDispatch();
  const searchRef = useRef<HTMLInputElement>(null);
  const { canWrite, isAdmin } = useViewer();

  const filters = filtersFromParams(params);
  const trash = trashFromParams(params);
  const layout = trash ? "list" : layoutFromParams(params);
  const args = listArgs(filters, layout, trash);
  const selected = params.get("item");
  const projectId = filters.projectId;

  const projects = useProjectsQuery(undefined);
  const list = useListFeedbackInfiniteQuery(args);
  const items = listItems(list.data);
  const project = projects.data?.projects.find((p) => p.id === projectId);
  const [update] = useUpdateFeedbackMutation();
  const [remove, removal] = useDeleteFeedbackMutation();
  const [restore] = useRestoreFeedbackMutation();
  const [purge, purging] = usePurgeFeedbackMutation();
  const selection = useAppSelector((s) => s.inbox.selection);
  const lastChange = useAppSelector((s) => s.inbox.lastChange);
  const help = useAppSelector((s) => s.ui.shortcutsOpen);
  const [bulkDelete, setBulkDelete] = useState(false);
  const [bulkPurge, setBulkPurge] = useState(false);

  const feed: Feed = {
    items,
    total: list.data?.pages[0]?.total ?? null,
    isLoading: list.isLoading,
    isError: list.isError && !items.length,
    isSuccess: list.isSuccess || items.length > 0,
    error: list.error,
    refetch: () => void list.refetch(),
    hasMore: list.hasNextPage,
    loadingMore: list.isFetchingNextPage,
    loadMoreFailed: list.isFetchNextPageError,
    loadMore: () => void list.fetchNextPage(),
  };

  // Selection survives refetches but drops rows that left the list.
  const ids = items.map((i) => i.id).join(",");
  useEffect(() => {
    if (list.data) dispatch(selectionPruned(ids ? ids.split(",") : []));
  }, [ids, list.data, dispatch]);

  // Entering the inbox shows anything that arrived while it was away.
  useEffect(() => {
    dispatch(followChanged(true));
  }, [dispatch]);

  const undo = () => {
    if (!lastChange) return;
    dispatch(changeRecorded(null));
    update({ each: lastChange.each })
      .unwrap()
      .then(() => toast("Change undone"))
      .catch((e: unknown) => toast.error(errorMessage(e)));
  };

  const change = (ids: string[], patch: FeedbackPatch, label: string, optimistic?: FeedbackFields) => {
    // Undo puts every item back to its own previous value (not the first item's for all).
    const back = undoChanges(items, ids, patch);
    if (back.length) dispatch(changeRecorded({ each: back, label }));
    update({ ids, patch, ...(optimistic ? { optimistic } : {}) })
      .unwrap()
      .then(() =>
        toast.success(label, { action: { label: "Undo (u)", onClick: () => latest.current.undo() } }),
      )
      .catch((e: unknown) => toast.error(errorMessage(e)));
  };

  /** A change that differs per item (bulk labels keep each item's other labels). */
  const changeEach = (each: ItemChange[], label: string) => {
    const fields = Object.assign({}, ...each.map((c) => c.patch)) as FeedbackPatch;
    const back = undoChanges(
      items,
      each.map((c) => c.id),
      fields,
    );
    if (back.length) dispatch(changeRecorded({ each: back, label }));
    update({ each })
      .unwrap()
      .then(() =>
        toast.success(label, { action: { label: "Undo (u)", onClick: () => latest.current.undo() } }),
      )
      .catch((e: unknown) => toast.error(errorMessage(e)));
  };

  /** Restore from the trash: the trash view's action, and Undo on the delete toast. */
  const restoreItems = (ids: string[]) =>
    restore(ids)
      .unwrap()
      .then((n) => toast.success(n === 1 ? "Restored" : `${n} items restored`))
      .catch((e: unknown) => toast.error(errorMessage(e)));

  const toggleCheck = (id: string, range = false) =>
    dispatch(selectionToggled({ id, range, order: items.map((i) => i.id) }));

  // Keyboard map (blueprint 06 §5). The listener is attached once and reads the latest state from a ref
  // updated before paint, so a key pressed right after the list renders is never lost, and quick j/j
  // presses advance from the row just chosen rather than a URL that hasn't caught up.
  const snapshot = {
    items,
    selected,
    layout,
    trash,
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
      // `g m` (My work) is global: components/shell/global-shortcuts.tsx swallows both keys first.
      if (st.trash) {
        // The trash is read-only: only moving around and help.
        if (!["?", "/", "j", "k", "ArrowDown", "ArrowUp"].includes(key)) return;
      } else if (!st.canWrite && WRITE_KEYS.has(key)) {
        return;
      }
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
      } else if ((key === "s" || key === "p" || key === "a" || key === "l") && selected) {
        dispatch(
          menuChanged(
            key === "s" ? "status" : key === "p" ? "priority" : key === "a" ? "assignee" : "labels",
          ),
        );
      } else if (key === "r" && selected) {
        dispatch(menuChanged("title"));
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
    <FeedbackDetailPanel
      key={selected}
      id={selected}
      onClose={() => setParams({ item: null })}
      onDeleted={(id) =>
        toast.success("Moved to the trash", {
          action: { label: "Undo", onClick: () => void restoreItems([id]) },
        })
      }
    />
  ) : null;
  const asSheet = isMobile || layout === "board";

  return (
    <div className="flex h-svh min-h-0 flex-col md:h-[calc(100svh-1rem)]">
      <PageHeader title={trash ? "Trash" : project ? project.name : "Inbox"}>
        {!trash && (
          <Tabs
            value={layout}
            onValueChange={(v) =>
              setParams({ layout: v === "board" ? "board" : null, view: null, item: null })
            }
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
        )}
        {isAdmin && (
          <Button
            variant={trash ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={trash}
            onClick={() => setParams({ trash: trash ? null : "1", item: null, layout: null, saved: null })}
            data-testid="trash-toggle"
          >
            <Trash2 /> <span className="hidden sm:inline">{trash ? "Leave trash" : "Trash"}</span>
          </Button>
        )}
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

      <SetupChecklist />

      <InboxToolbar
        filters={filters}
        layout={layout}
        trash={trash}
        args={args}
        total={feed.total}
        searchRef={searchRef}
      />

      {layout === "board" ? (
        <BoardView
          feed={feed}
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
              feed={feed}
              args={args}
              filters={filters}
              trash={trash}
              selected={selected}
              hasProjects={!!projects.data?.projects.length}
              onOpen={(id) => {
                pending.current = null;
                setParams({ item: id });
              }}
              onCheck={toggleCheck}
              onChange={change}
              onChangeEach={changeEach}
              onDelete={() => setBulkDelete(true)}
              onRestore={() => {
                const ids = [...selection];
                void restoreItems(ids).then(() => dispatch(selectionCleared()));
              }}
              onPurge={() => setBulkPurge(true)}
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
        title={`Move ${selection.length} item${selection.length === 1 ? "" : "s"} to the trash?`}
        description="Admins can restore them from the trash for 30 days; after that they are purged with their files."
        confirmLabel="Move to trash"
        pending={removal.isLoading}
        onConfirm={() => {
          const ids = [...selection];
          remove(ids)
            .unwrap()
            .then((n) => {
              toast.success(n === 1 ? "Moved to the trash" : `${n} items moved to the trash`, {
                action: { label: "Undo", onClick: () => void restoreItems(ids) },
              });
              setBulkDelete(false);
              if (selected && ids.includes(selected)) setParams({ item: null });
              dispatch(selectionCleared());
            })
            .catch((e: unknown) => toast.error(errorMessage(e)));
        }}
      />

      <ConfirmDialog
        open={bulkPurge}
        onOpenChange={setBulkPurge}
        title={`Delete ${selection.length} item${selection.length === 1 ? "" : "s"} forever?`}
        description="They are removed with their comments, screenshots, replays and attachments. This can't be undone."
        confirmLabel="Delete forever"
        pending={purging.isLoading}
        onConfirm={() => {
          const ids = [...selection];
          purge(ids)
            .unwrap()
            .then((n) => {
              toast.success(n === 1 ? "Deleted forever" : `${n} items deleted forever`);
              setBulkPurge(false);
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
                      {part.split(" ").map((p, j) => (
                        <span key={p}>
                          {j > 0 && " "}
                          <Kbd>{p}</Kbd>
                        </span>
                      ))}
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
