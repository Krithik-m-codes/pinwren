"use client";

import { FEEDBACK_KINDS, FEEDBACK_STATUSES, PRIORITIES, safeHref } from "@pinwren/core";
import {
  BadgeCheck,
  Bell,
  BellOff,
  Copy,
  Crosshair,
  Download,
  ExternalLink,
  FileText,
  Film,
  ImageIcon,
  Link2,
  Loader2,
  MoreHorizontal,
  Paperclip,
  RotateCcw,
  Shapes,
  SquareDashed,
  Tag,
  Trash2,
  Unlink,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AnnotationsToggle, CaptureView, type Marker } from "@/components/capture-view";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { copyText } from "@/components/copy-button";
import { DatePicker } from "@/components/date-picker";
import {
  KIND_META,
  LocalDate,
  PRIORITY_META,
  PriorityIcon,
  RelativeTime,
  STATUS_META,
  StatusIcon,
} from "@/components/feedback-meta";
import { ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserAvatar } from "@/components/user-avatar";
import {
  type Asset,
  assetUrl,
  type FeedbackDetail,
  formatBytes,
  type ItemLabel,
  type PresenceUser,
  screenshotOf,
} from "@/lib/api";
import { captureOf, isRegion, placeOn } from "@/lib/geometry";
import { itemLink } from "@/lib/links";
import {
  errorMessage,
  useDeleteFeedbackMutation,
  useFeedbackDetailQuery,
  useLazyReproductionQuery,
  useMarkItemNotificationsReadMutation,
  usePageLinkMutation,
  usePurgeFeedbackMutation,
  useRestoreFeedbackMutation,
  useRoundsQuery,
  useUpdateFeedbackMutation,
  useWatchFeedbackMutation,
} from "@/lib/store/api";
import type { FeedbackFields, FeedbackPatch } from "@/lib/store/api/feedback";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { type DetailMenu, menuChanged } from "@/lib/store/slices/inbox";
import { presenceWatched } from "@/lib/store/slices/realtime";
import { useUrlParams } from "@/lib/use-url-params";
import { useMounted } from "@/lib/use-synced-state";
import { cn } from "@/lib/utils";
import { useMembers, useViewer } from "@/lib/viewer";
import { DueDate, PresenceStack } from "./inbox-list";
import { ItemActions } from "./item-actions";
import { AssigneesPicker, ItemSearchPicker, LabelChips, LabelPicker } from "./pickers";
import { type ReplayHandle, ReplayViewer } from "./replay-viewer";
import { CommentComposer, Timeline } from "./timeline";

const statusItems = FEEDBACK_STATUSES.map((s) => ({ value: s, label: STATUS_META[s].label }));
const priorityItems = PRIORITIES.map((p) => ({ value: p, label: PRIORITY_META[p].label }));
const NO_ROUND = "none";
const NOBODY: PresenceUser[] = [];

/** A due date is the end of the chosen day, in the reader's time zone. */
export function endOfDay(d: Date): string {
  const end = new Date(d);
  end.setHours(23, 59, 59, 0);
  return end.toISOString();
}

/**
 * One item (blueprint 06 §3.2): header pickers, media (screenshot / session replay), attachments,
 * context tabs synced with the replay, and the timeline. Reports presence while open, and reads the
 * item's notifications (the bell) when it opens.
 */
export function FeedbackDetailPanel({
  id,
  onClose,
  onDeleted,
}: {
  id: string;
  onClose: () => void;
  /** After a move to the trash (the inbox offers Undo). */
  onDeleted?: (id: string) => void;
}) {
  const detail = useFeedbackDetailQuery(id);
  const dispatch = useAppDispatch();
  const { userId } = useViewer();
  const watching = useAppSelector((s) => s.realtime.presence[id] ?? NOBODY);
  const [markRead] = useMarkItemNotificationsReadMutation();
  // Presence comes from the live stream: hidden until hydrated (see InboxList).
  const ready = useMounted();
  const others = ready ? watching.filter((u) => u.id !== userId) : NOBODY;

  // Presence: heartbeat while this item is open (lib/store/listeners.ts), "left" when it closes.
  useEffect(() => {
    dispatch(presenceWatched(id));
    return () => {
      dispatch(presenceWatched(null));
    };
  }, [id, dispatch]);

  // Opening an item reads its notifications. Best effort: the bell keeps them unread if this fails.
  useEffect(() => {
    void markRead(id);
  }, [id, markRead]);

  if (detail.isLoading) {
    return (
      <div className="space-y-4 p-5" aria-busy>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-7 w-3/4" />
        <div className="flex gap-2">
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-7 w-28" />
        </div>
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    );
  }
  if (!detail.data) return <ErrorState error={detail.error} retry={() => void detail.refetch()} />;
  return <DetailBody data={detail.data} onClose={onClose} onDeleted={onDeleted} others={others} />;
}

function DetailBody({
  data,
  onClose,
  onDeleted,
  others,
}: {
  data: FeedbackDetail;
  onClose: () => void;
  onDeleted: ((id: string) => void) | undefined;
  others: PresenceUser[];
}) {
  const { feedback: f, assets } = data;
  const id = f.id;
  const dispatch = useAppDispatch();
  const { setParams } = useUrlParams();
  const members = useMembers();
  const viewer = useViewer();
  const inTrash = !!f.deletedAt;
  // In the trash an item is read-only until it is restored.
  const canWrite = viewer.canWrite && !inTrash;
  const menu = useAppSelector((s) => s.inbox.menu);
  const [update] = useUpdateFeedbackMutation();
  const [remove, removal] = useDeleteFeedbackMutation();
  const [restore, restoring] = useRestoreFeedbackMutation();
  const [purge, purging] = usePurgeFeedbackMutation();
  const [watch, watchState] = useWatchFeedbackMutation();
  const [pageLink, linking] = usePageLinkMutation();
  const [reproduction, repro] = useLazyReproductionQuery();
  const rounds = useRoundsQuery(f.projectId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [dupOpen, setDupOpen] = useState(false);
  const replay = assets.find((a) => a.kind === "replay");
  const player = useRef<ReplayHandle | null>(null);
  const [replayAt, setReplayAt] = useState<number | null>(null);

  const Kind = KIND_META[f.kind].icon;
  const roundItems = [
    { value: NO_ROUND, label: "No round" },
    ...(rounds.data?.rounds ?? [])
      .filter((r) => r.status === "active" || r.id === f.roundId)
      .map((r) => ({ value: r.id, label: r.name })),
  ];
  const patch = (p: FeedbackPatch, optimistic?: FeedbackFields) => {
    update({ ids: [id], patch: p, ...(optimistic ? { optimistic } : {}) })
      .unwrap()
      .catch((e: unknown) => toast.error(errorMessage(e)));
  };
  const setMenu = (m: DetailMenu) => dispatch(menuChanged(m));
  const reporter = f.reporterGuest?.name ?? f.reporterGuest?.email ?? "Anonymous visitor";
  const assignees = f.assigneeIds
    .map((uid) => members.find((m) => m.id === uid) ?? data.assignees.find((a) => a.id === uid))
    .filter((m) => !!m);

  /** A signed link that opens the thread on the page, even when pins are private (wave-5 contract §3.3). */
  const openOnPage = () => {
    // Open the tab now (inside the click) so the browser doesn't block it, then point it at the link.
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    pageLink(id)
      .unwrap()
      .then(({ url }) => {
        const safe = safeHref(url);
        if (!safe) throw new Error("The page address isn't a web link");
        if (tab) tab.location.href = safe;
        else window.open(safe, "_blank", "noopener");
      })
      .catch((e: unknown) => {
        tab?.close();
        toast.error("Couldn't open the page", { description: errorMessage(e) });
      });
  };
  const copyMarkdown = () => {
    reproduction(id, true)
      .unwrap()
      .then((r) => copyText(r.markdown, "Copied as Markdown"))
      .catch((e: unknown) => toast.error("Couldn't copy", { description: errorMessage(e) }));
  };
  const toggleWatch = () => {
    watch({ id, watching: !data.watching })
      .unwrap()
      .then((r) => toast.success(r.watching ? "You follow this item" : "You no longer follow this item"))
      .catch((e: unknown) => toast.error(errorMessage(e)));
  };

  return (
    <article className="flex flex-col" aria-label={`Feedback #${f.number}`} data-testid="feedback-detail">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background/90 px-4 py-2 backdrop-blur">
        <span className="font-mono text-xs text-muted-foreground tabular-nums">#{f.number}</span>
        <Badge variant="secondary" className="gap-1" data-testid="kind-badge">
          <Kind className="size-3" />
          {KIND_META[f.kind].label}
        </Badge>
        {isRegion(f.anchor) && (
          <Badge variant="outline" className="gap-1 font-normal">
            <SquareDashed className="size-3" /> Region
          </Badge>
        )}
        <span className="hidden truncate text-xs text-muted-foreground lg:inline">{f.projectName}</span>
        <div className="ml-auto flex items-center gap-0.5">
          <PresenceStack users={others} className="mr-1.5" />
          {!inTrash && (
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleWatch}
              disabled={watchState.isLoading}
              aria-pressed={data.watching}
              data-testid="follow"
              title={
                data.watching
                  ? "You get notified about changes and replies. Click to stop."
                  : "Get notified about changes and replies"
              }
            >
              {data.watching ? <BellOff /> : <Bell />}
              <span className="hidden sm:inline">{data.watching ? "Unfollow" : "Follow"}</span>
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => copyText(itemLink(f.id), "Link copied")}>
            <Link2 /> <span className="hidden sm:inline">Copy link</span>
          </Button>
          {f.pageUrl && !inTrash && (
            <Button
              variant="ghost"
              size="sm"
              onClick={openOnPage}
              disabled={linking.isLoading}
              data-testid="open-on-page"
            >
              {linking.isLoading ? <Loader2 className="animate-spin" /> : <ExternalLink />}
              <span className="hidden sm:inline">Open on page</span>
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="More actions" />}>
              <MoreHorizontal />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onClick={() => copyText(`#${f.number}`, "Number copied")}>
                Copy number
              </DropdownMenuItem>
              {f.pageUrl && (
                <DropdownMenuItem onClick={() => copyText(f.pageUrl ?? "", "Page URL copied")}>
                  Copy page URL
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={copyMarkdown}
                disabled={repro.isFetching}
                data-testid="copy-markdown"
              >
                <Copy /> Copy as Markdown
              </DropdownMenuItem>
              {canWrite && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setMenu("title")}>Rename</DropdownMenuItem>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <Shapes /> Change kind
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-40">
                      <DropdownMenuRadioGroup
                        value={f.kind}
                        onValueChange={(v) => {
                          const kind = FEEDBACK_KINDS.find((k) => k === v);
                          if (kind && kind !== f.kind) patch({ kind });
                        }}
                      >
                        {FEEDBACK_KINDS.map((k) => {
                          const Icon = KIND_META[k].icon;
                          return (
                            <DropdownMenuRadioItem closeOnClick key={k} value={k}>
                              <Icon /> {KIND_META[k].label}
                            </DropdownMenuRadioItem>
                          );
                        })}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  {f.duplicateOf ? (
                    <DropdownMenuItem onClick={() => patch({ duplicateOfId: null, status: "open" })}>
                      <Unlink /> Not a duplicate
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onClick={() => setDupOpen(true)} data-testid="mark-duplicate">
                      Mark duplicate of…
                    </DropdownMenuItem>
                  )}
                </>
              )}
              {viewer.isAdmin && !inTrash && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => setConfirmDelete(true)}>
                    <Trash2 /> Move to trash
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          {canWrite && (
            <ItemSearchPicker
              projectId={f.projectId}
              excludeId={id}
              open={dupOpen}
              onOpenChange={setDupOpen}
              label="Mark duplicate of"
              trigger={<button type="button" className="sr-only" tabIndex={-1} />}
              onPick={(original) => {
                setDupOpen(false);
                patch({ duplicateOfId: original.id, status: "duplicate" });
                toast.success(`Marked as a duplicate of #${original.number}`);
              }}
            />
          )}
          <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
            <X />
          </Button>
        </div>
      </header>

      {inTrash && (
        <div
          className="flex flex-wrap items-center gap-2 border-b bg-destructive/5 px-4 py-2 text-sm"
          data-testid="trash-banner"
        >
          <Trash2 className="size-4 shrink-0 text-destructive" />
          <span className="mr-auto">
            In the trash since <RelativeTime iso={f.deletedAt ?? f.updatedAt} />. It is purged with its files
            30 days after it was deleted.
          </span>
          {viewer.isAdmin && (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={restoring.isLoading}
                onClick={() =>
                  restore([id])
                    .unwrap()
                    .then(() => {
                      toast.success("Restored");
                      setParams({ trash: null });
                    })
                    .catch((e: unknown) => toast.error(errorMessage(e)))
                }
              >
                <RotateCcw /> Restore
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => setConfirmPurge(true)}
              >
                Delete forever
              </Button>
            </>
          )}
        </div>
      )}

      <div className="space-y-6 px-4 py-5 sm:px-5">
        <div>
          <TitleField
            key={f.title ?? ""}
            title={f.title}
            fallback={firstLine(f.body)}
            editable={canWrite}
            editing={canWrite && menu === "title"}
            onEditingChange={(on) => setMenu(on ? "title" : null)}
            onSave={(title) => patch({ title })}
          />
          <p className="mt-1 flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
            <span>{reporter}</span>
            {f.reporterGuest?.verified && (
              <span
                className="inline-flex items-center gap-0.5 text-emerald-700 dark:text-emerald-400"
                title="Identity signed by your app (Pinwren.identify with a signature)"
                data-testid="verified-reporter"
              >
                <BadgeCheck className="size-3.5" /> Verified
              </span>
            )}
            <span>
              · <RelativeTime iso={f.createdAt} />
            </span>
            {f.pageTitle && <span>· {f.pageTitle}</span>}
          </p>
          <DuplicateLinks data={data} onOpen={(item) => setParams({ item })} />
        </div>

        {canWrite ? (
          <div className="flex flex-wrap gap-2">
            <Select
              items={statusItems}
              value={f.status}
              open={menu === "status"}
              onOpenChange={(o) => setMenu(o ? "status" : null)}
              onValueChange={(v) => v && patch({ status: v })}
            >
              <SelectTrigger size="sm" aria-label="Status" data-testid="status-picker">
                <StatusIcon status={f.status} />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statusItems.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    <StatusIcon status={s.value} />
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              items={priorityItems}
              value={f.priority}
              open={menu === "priority"}
              onOpenChange={(o) => setMenu(o ? "priority" : null)}
              onValueChange={(v) => v && patch({ priority: v })}
            >
              <SelectTrigger size="sm" aria-label="Priority" data-testid="priority-picker">
                <PriorityIcon priority={f.priority} />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {priorityItems.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    <PriorityIcon priority={p.value} />
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <AssigneesPicker
              value={f.assigneeIds}
              open={menu === "assignee"}
              onOpenChange={(o) => setMenu(o ? "assignee" : null)}
              label="Assignees"
              onChange={(ids) => patch({ assigneeIds: ids })}
              trigger={
                <Button
                  variant="outline"
                  size="sm"
                  className="max-w-56 font-normal"
                  data-testid="assignee-picker"
                >
                  {assignees.length ? (
                    <>
                      <span className="flex -space-x-1">
                        {assignees.slice(0, 3).map((a) => (
                          <UserAvatar
                            key={a.id}
                            name={a.name}
                            image={a.image}
                            className="size-4 ring-1 ring-background"
                          />
                        ))}
                      </span>
                      <span className="truncate">
                        {assignees.length === 1 ? assignees[0]?.name : `${assignees.length} assignees`}
                      </span>
                    </>
                  ) : (
                    <>
                      <UserRound /> Unassigned
                    </>
                  )}
                </Button>
              }
            />
            <LabelPicker
              projectId={f.projectId}
              selected={f.labels}
              canCreate={canWrite}
              open={menu === "labels"}
              onOpenChange={(o) => setMenu(o ? "labels" : null)}
              label="Labels"
              onChange={(labels: ItemLabel[]) => patch({ labelIds: labels.map((l) => l.id) }, { labels })}
              trigger={
                <Button
                  variant="outline"
                  size="sm"
                  className="max-w-64 font-normal"
                  data-testid="label-picker"
                >
                  <Tag />
                  {f.labels.length ? <LabelChips labels={f.labels} max={2} /> : "Labels"}
                </Button>
              }
            />
            <DatePicker
              value={f.dueAt ? new Date(f.dueAt) : null}
              onChange={(d) => patch({ dueAt: d ? endOfDay(d) : null })}
              placeholder="Due date"
              className="[&_button:first-child]:h-7 [&_button:first-child]:w-auto [&_button:first-child]:text-sm"
            />
            {roundItems.length > 1 && (
              <Select
                items={roundItems}
                value={f.roundId ?? NO_ROUND}
                open={menu === "round"}
                onOpenChange={(o) => setMenu(o ? "round" : null)}
                onValueChange={(v) => v && patch({ roundId: v === NO_ROUND ? null : v })}
              >
                <SelectTrigger size="sm" aria-label="Review round" data-testid="round-picker">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roundItems.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2 text-sm" data-testid="read-only-fields">
            <Badge variant="outline" className="h-7 gap-1.5 px-2.5 font-normal" data-testid="status-picker">
              <StatusIcon status={f.status} /> {STATUS_META[f.status].label}
            </Badge>
            <Badge variant="outline" className="h-7 gap-1.5 px-2.5 font-normal">
              <PriorityIcon priority={f.priority} /> {PRIORITY_META[f.priority].label}
            </Badge>
            <Badge variant="outline" className="h-7 gap-1.5 px-2.5 font-normal">
              {assignees.length ? assignees.map((a) => a.name).join(", ") : "Unassigned"}
            </Badge>
            {f.labels.length > 0 && (
              <Badge variant="outline" className="h-7 gap-1.5 px-2.5 font-normal">
                <LabelChips labels={f.labels} max={5} />
              </Badge>
            )}
            {f.dueAt && (
              <Badge variant="outline" className="h-7 gap-1.5 px-2.5 font-normal">
                <DueDate iso={f.dueAt} status={f.status} />
              </Badge>
            )}
            {f.roundId && (
              <Badge variant="outline" className="h-7 px-2.5 font-normal">
                {rounds.data?.rounds.find((r) => r.id === f.roundId)?.name ?? "In a round"}
              </Badge>
            )}
          </div>
        )}

        {canWrite && <ItemActions data={data} />}

        <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">{f.body}</p>

        <Media data={data} replay={replay} player={player} onReplayTime={setReplayAt} />

        <Attachments assets={assets.filter((a) => a.kind === "attachment")} />

        <ContextTabs
          data={data}
          replayAt={replay ? replayAt : null}
          onSeek={replay ? (at) => player.current?.seekTo(at) : undefined}
        />

        <section aria-label="Activity" className="space-y-3">
          <h3 className="text-sm font-semibold">Activity</h3>
          <Timeline data={data} />
          {canWrite ? (
            <CommentComposer feedbackId={id} reach={data.replyReach} projectId={f.projectId} />
          ) : (
            <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
              {inTrash ? "Restore the item to reply." : "You have read-only access, so you can't reply."}
            </p>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Move #${f.number} to the trash?`}
        description="Admins can restore it from the trash for 30 days; after that it is purged with its files."
        confirmLabel="Move to trash"
        pending={removal.isLoading}
        onConfirm={() => {
          remove([id])
            .unwrap()
            .then(() => {
              setConfirmDelete(false);
              if (onDeleted) onDeleted(id);
              else toast.success("Moved to the trash");
              onClose();
            })
            .catch((e: unknown) => toast.error(errorMessage(e)));
        }}
      />
      <ConfirmDialog
        open={confirmPurge}
        onOpenChange={setConfirmPurge}
        title={`Delete #${f.number} forever?`}
        description="It is removed with its comments, screenshots, replay and attachments. This can't be undone."
        confirmLabel="Delete forever"
        pending={purging.isLoading}
        onConfirm={() => {
          purge([id])
            .unwrap()
            .then(() => {
              toast.success("Deleted forever");
              setConfirmPurge(false);
              onClose();
            })
            .catch((e: unknown) => toast.error(errorMessage(e)));
        }}
      />
    </article>
  );
}

/** The title, editable in place (click it, or `r`): Enter saves, Esc cancels, empty falls back to the body. */
function TitleField({
  title,
  fallback,
  editable,
  editing,
  onEditingChange,
  onSave,
}: {
  title: string | null;
  fallback: string;
  editable: boolean;
  editing: boolean;
  onEditingChange: (on: boolean) => void;
  onSave: (title: string | null) => void;
}) {
  const [value, setValue] = useState(title ?? "");
  const shown = title || fallback;
  if (!editing) {
    return editable ? (
      <h2 className="text-lg leading-snug font-semibold text-balance break-words">
        <button
          type="button"
          className="-mx-1 rounded px-1 text-left hover:bg-muted/70 focus-visible:outline-2 focus-visible:outline-ring"
          title="Rename (r)"
          onClick={() => onEditingChange(true)}
          data-testid="title"
        >
          {shown}
        </button>
      </h2>
    ) : (
      <h2 className="text-lg leading-snug font-semibold text-balance break-words" data-testid="title">
        {shown}
      </h2>
    );
  }
  const save = () => {
    const next = value.trim().slice(0, 200);
    onEditingChange(false);
    if ((next || null) !== (title || null)) onSave(next || null);
  };
  return (
    <Input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      maxLength={200}
      // eslint-disable-next-line jsx-a11y/no-autofocus -- opened by a click or `r`, which hands focus here
      autoFocus
      aria-label="Title"
      placeholder={fallback}
      className="h-9 text-lg font-semibold"
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          save();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          setValue(title ?? "");
          onEditingChange(false);
        }
      }}
    />
  );
}

/** "Duplicate of #12" and "Duplicates: #14, #20", both linking to the other item. */
function DuplicateLinks({ data, onOpen }: { data: FeedbackDetail; onOpen: (id: string) => void }) {
  const original = data.feedback.duplicateOf;
  if (!original && !data.duplicates.length) return null;
  const link = (r: { id: string; number: number; title: string }) => (
    <button
      key={r.id}
      type="button"
      className="font-medium text-foreground underline-offset-4 hover:underline"
      onClick={() => onOpen(r.id)}
      title={r.title}
    >
      #{r.number}
    </button>
  );
  return (
    <p
      className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
      data-testid="duplicates"
    >
      {original && (
        <span className="inline-flex items-center gap-1">
          <StatusIcon status="duplicate" className="size-3.5" /> Duplicate of {link(original)}
          <span className="max-w-48 truncate">{original.title}</span>
        </span>
      )}
      {data.duplicates.length > 0 && (
        <span className="inline-flex flex-wrap items-center gap-1">
          Duplicates: {data.duplicates.map((d, i) => [i > 0 ? ", " : null, link(d)])}
        </span>
      )}
    </p>
  );
}

/** Screenshot (with the item's own pin / region drawn on it) and the session replay, as tabs. */
function Media({
  data,
  replay,
  player,
  onReplayTime,
}: {
  data: FeedbackDetail;
  replay: Asset | undefined;
  player: React.RefObject<ReplayHandle | null>;
  onReplayTime: (at: number | null) => void;
}) {
  const shot = screenshotOf(data.assets);
  if (!replay) return shot ? <Screenshot data={data} shot={shot} /> : null;
  const viewer = (
    <ReplayViewer asset={replay} diagnostics={data.diagnostics} handle={player} onTime={onReplayTime} />
  );
  if (!shot) return viewer;
  return (
    <Tabs defaultValue="screenshot">
      <TabsList className="h-8">
        <TabsTrigger value="screenshot" className="px-2.5">
          <ImageIcon /> Screenshot
        </TabsTrigger>
        <TabsTrigger value="replay" className="px-2.5">
          <Film /> Replay
        </TabsTrigger>
      </TabsList>
      <TabsContent value="screenshot" className="pt-2">
        <Screenshot data={data} shot={shot} />
      </TabsContent>
      <TabsContent value="replay" className="pt-2">
        {viewer}
      </TabsContent>
    </Tabs>
  );
}

function Screenshot({ data, shot }: { data: FeedbackDetail; shot: Asset }) {
  const f = data.feedback;
  const [showPin, setShowPin] = useState(true);
  // The reporter's vector annotations (wave-5 §2), drawn over the unflattened capture; switchable.
  const [showMarks, setShowMarks] = useState(true);
  // An annotated screenshot already carries the reporter's own marks; only overlay on a clean one.
  const placed = f.anchor && shot.kind === "screenshot" ? placeOn(f.anchor, captureOf(f.anchor)) : null;
  const markers: Marker[] = placed
    ? [{ ...placed, id: f.id, label: String(f.number), status: f.status, title: `#${f.number}` }]
    : [];
  return (
    <figure className="space-y-2">
      <a
        href={assetUrl(shot.id)}
        target="_blank"
        rel="noopener noreferrer"
        className="block rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        aria-label="Open screenshot in a new tab"
      >
        <CaptureView
          src={assetUrl(shot.id)}
          alt={`Screenshot attached to #${f.number}`}
          markers={markers}
          showMarkers={showPin}
          decorative
          annotations={shot.annotations}
          showAnnotations={showMarks}
        />
      </a>
      <figcaption className="flex items-center gap-2 text-xs text-muted-foreground">
        <ImageIcon className="size-3.5" />
        {shot.kind === "screenshot_annotated" ? "Annotated screenshot" : "Screenshot"}
        {f.environment?.viewport && (
          <span className="tabular-nums">
            · {f.environment.viewport.w}×{f.environment.viewport.h}
          </span>
        )}
        <span className="ml-auto">
          <AnnotationsToggle layer={shot.annotations} pressed={showMarks} onPressedChange={setShowMarks} />
        </span>
        {placed && (
          <span className="flex items-center gap-2">
            <label htmlFor={`show-pin-${f.id}`}>{isRegion(f.anchor) ? "Show region" : "Show pin"}</label>
            <Switch id={`show-pin-${f.id}`} size="sm" checked={showPin} onCheckedChange={setShowPin} />
          </span>
        )}
      </figcaption>
    </figure>
  );
}

function Attachments({ assets }: { assets: Asset[] }) {
  if (!assets.length) return null;
  return (
    <section aria-label="Attachments" className="space-y-2">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold">
        <Paperclip className="size-3.5" /> Attachments
        <span className="font-normal text-muted-foreground tabular-nums">{assets.length}</span>
      </h3>
      <ul className="grid gap-2 sm:grid-cols-2">
        {assets.map((a) => {
          const image = a.contentType.startsWith("image/");
          return (
            <li key={a.id}>
              <a
                href={assetUrl(a.id)}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-3 rounded-lg border p-2 transition-colors hover:bg-muted/60"
              >
                {image ? (
                  // eslint-disable-next-line @next/next/no-img-element -- session-authenticated asset; next/image would fetch it without the cookie
                  <img
                    src={assetUrl(a.id)}
                    alt=""
                    className="size-10 shrink-0 rounded-md border object-cover"
                  />
                ) : (
                  <span className="grid size-10 shrink-0 place-items-center rounded-md bg-muted">
                    <FileText className="size-4 text-muted-foreground" />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{a.name ?? "Attachment"}</span>
                  <span className="block text-xs text-muted-foreground">
                    {a.contentType.split("/")[1]?.toUpperCase()} · {formatBytes(a.bytes)}
                  </span>
                </span>
                <Download
                  aria-label="Download"
                  className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground"
                />
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Within this window of the replay's current time, a console / network entry counts as "now". */
const NOW_WINDOW_MS = 1500;

function ContextTabs({
  data,
  replayAt,
  onSeek,
}: {
  data: FeedbackDetail;
  /** Epoch ms the replay is showing, or null without a replay. */
  replayAt: number | null;
  onSeek: ((at: number) => void) | undefined;
}) {
  const { feedback: f, diagnostics } = data;
  const consoleEntries = diagnostics?.console ?? [];
  const networkEntries = diagnostics?.network ?? [];
  const a = f.anchor;
  const isNow = (at: number) => replayAt !== null && Math.abs(at - replayAt) <= NOW_WINDOW_MS;
  const entryClass = (at: number) =>
    cn(isNow(at) && "bg-primary/10 ring-1 ring-primary/30 ring-inset", onSeek && "hover:bg-muted/60");
  return (
    <Tabs defaultValue="details">
      <TabsList variant="line" className="w-full justify-start overflow-x-auto border-b">
        <TabsTrigger value="details" className="flex-none">
          Details
        </TabsTrigger>
        {a && (
          <TabsTrigger value="anchor" className="flex-none">
            Anchor
          </TabsTrigger>
        )}
        <TabsTrigger value="console" className="flex-none">
          Console{" "}
          {consoleEntries.length > 0 && <span className="tabular-nums">({consoleEntries.length})</span>}
        </TabsTrigger>
        <TabsTrigger value="network" className="flex-none">
          Network{" "}
          {networkEntries.length > 0 && <span className="tabular-nums">({networkEntries.length})</span>}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="details" className="pt-2">
        <dl className="grid grid-cols-[6.5rem_1fr] gap-x-4 gap-y-2 text-sm sm:grid-cols-[8rem_1fr]">
          <Meta label="Page">
            {f.pageUrl ? (
              <a
                href={safeHref(f.pageUrl) ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all underline-offset-4 hover:underline"
              >
                {f.pageUrl}
              </a>
            ) : (
              "—"
            )}
          </Meta>
          {f.reviewLink && (
            // A guest sent it through a review link (F-012): its name, and every item that came through it.
            <Meta label="Source">
              <Link
                href={`/inbox?project=${f.projectId}&review=${f.reviewLink.id}`}
                className="inline-flex items-center gap-1.5 underline-offset-4 hover:underline"
                data-testid="review-link-source"
              >
                <Link2 className="size-3.5 text-muted-foreground" />
                Review link · {f.reviewLink.label}
              </Link>
            </Meta>
          )}
          <Meta label="Browser">
            {[f.environment?.browser, f.environment?.os].filter(Boolean).join(" · ") || "—"}
          </Meta>
          <Meta label="Viewport">
            {f.environment?.viewport
              ? `${f.environment.viewport.w} × ${f.environment.viewport.h} @${f.environment.dpr ?? 1}x`
              : "—"}
          </Meta>
          <Meta label="Locale">
            {[f.environment?.locale, f.environment?.timezone].filter(Boolean).join(" · ") || "—"}
          </Meta>
          {f.reporterGuest?.email && <Meta label="Reporter">{f.reporterGuest.email}</Meta>}
          {f.reporterGuest?.externalId && (
            <Meta label="User id">
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <code className="font-mono text-xs break-all">{f.reporterGuest.externalId}</code>
                {f.reporterGuest.verified ? (
                  <Badge
                    variant="secondary"
                    className="gap-1 font-normal text-emerald-700 dark:text-emerald-400"
                  >
                    <BadgeCheck className="size-3" /> signed
                  </Badge>
                ) : (
                  <Badge variant="outline" className="font-normal text-muted-foreground">
                    unsigned
                  </Badge>
                )}
              </span>
            </Meta>
          )}
          <Meta label="Consent">
            {f.consent ? (
              <span data-testid="consent-record">
                Accepted <LocalDate iso={f.consent.acceptedAt} time />{" "}
                <span className="text-muted-foreground">
                  · notice <code className="font-mono text-xs">{f.consent.version}</code>
                </span>
              </span>
            ) : (
              <span className="text-muted-foreground">No consent notice was shown</span>
            )}
          </Meta>
        </dl>
        {f.metadata && Object.keys(f.metadata).length > 0 && (
          // What the site attached with `Pinwren.setMetadata()` / `metadata` (plan, build, feature flags…).
          <div className="mt-4 space-y-2" data-testid="host-metadata">
            <h4 className="text-xs font-medium text-muted-foreground">From your site</h4>
            <dl className="grid grid-cols-[6.5rem_1fr] gap-x-4 gap-y-2 text-sm sm:grid-cols-[8rem_1fr]">
              {Object.entries(f.metadata).map(([k, v]) => (
                <Meta key={k} label={k}>
                  {typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? (
                    <span className="break-all">{String(v)}</span>
                  ) : (
                    <code className="font-mono text-xs break-all">{JSON.stringify(v)}</code>
                  )}
                </Meta>
              ))}
            </dl>
          </div>
        )}
      </TabsContent>
      {a && (
        <TabsContent value="anchor" className="pt-2">
          <dl className="grid grid-cols-[6.5rem_1fr] gap-x-4 gap-y-2 text-sm sm:grid-cols-[8rem_1fr]">
            <Meta label="Type">
              <span className="inline-flex items-center gap-1.5">
                {isRegion(a) ? <SquareDashed className="size-3.5" /> : <Crosshair className="size-3.5" />}
                {isRegion(a)
                  ? `Region · ${Math.round(((a.pin.wPct ?? 0) / 100) * a.rect.w)} × ${Math.round(((a.pin.hPct ?? 0) / 100) * a.rect.h)} px`
                  : "Point pin"}
              </span>
            </Meta>
            <Meta label="Element">
              <code className="font-mono text-xs break-all">&lt;{a.tag}&gt;</code>
              {a.attrs?.pinwrenAnchor && (
                <code className="ml-2 font-mono text-xs">
                  data-pinwren-anchor=&quot;{a.attrs.pinwrenAnchor}&quot;
                </code>
              )}
            </Meta>
            <Meta label="Selector">
              <code className="font-mono text-xs break-all" data-testid="anchor-selector">
                {a.css}
              </code>
            </Meta>
            <Meta label="XPath">
              <code className="font-mono text-xs break-all text-muted-foreground">{a.xpath}</code>
            </Meta>
            {a.text.content && (
              <Meta label="Text">
                <span className="break-words">“{a.text.content}”</span>
              </Meta>
            )}
            <Meta label="Position">
              <span className="tabular-nums">
                {a.pin.xPct.toFixed(1)}%, {a.pin.yPct.toFixed(1)}% of the element
              </span>
            </Meta>
            <Meta label="Captured at">
              <span className="tabular-nums">
                {Math.round(a.rect.vw)} × {Math.round(a.rect.vh)} viewport, scrolled{" "}
                {Math.round(a.rect.scrollY)} px
              </span>
            </Meta>
          </dl>
        </TabsContent>
      )}
      <TabsContent value="console" className="pt-2">
        {consoleEntries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No console output was captured.</p>
        ) : (
          <ul
            className="divide-y overflow-hidden rounded-lg border font-mono text-xs"
            data-testid="console-entries"
          >
            {consoleEntries.map((e, i) => (
              <li
                // Keyed by position: log lines have no id
                key={i}
                data-now={isNow(e.at) || undefined}
                className={cn(
                  "px-3 py-1.5 break-all whitespace-pre-wrap",
                  e.level === "error" && "bg-destructive/5 text-destructive",
                  e.level === "warn" && "bg-amber-500/5 text-amber-700 dark:text-amber-400",
                  entryClass(e.at),
                )}
              >
                {onSeek ? (
                  <button
                    type="button"
                    className="w-full text-left"
                    onClick={() => onSeek(e.at)}
                    title="Jump the replay here"
                  >
                    {e.message}
                  </button>
                ) : (
                  e.message
                )}
              </li>
            ))}
          </ul>
        )}
      </TabsContent>
      <TabsContent value="network" className="pt-2">
        {networkEntries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No failed requests were captured.</p>
        ) : (
          <ul className="divide-y overflow-hidden rounded-lg border font-mono text-xs">
            {networkEntries.map((n, i) => {
              const row = (
                <>
                  <span
                    className={cn(
                      "w-10 shrink-0",
                      n.status >= 400 || n.status === 0 ? "text-destructive" : "",
                    )}
                  >
                    {n.status || "ERR"}
                  </span>
                  <span className="w-12 shrink-0 text-muted-foreground">{n.method}</span>
                  <span className="min-w-0 flex-1 break-all">{n.url}</span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    {Math.round(n.durationMs)}ms
                  </span>
                </>
              );
              return (
                // Keyed by position: request entries have no id
                <li
                  key={i}
                  data-now={isNow(n.at) || undefined}
                  className={cn("px-3 py-1.5", entryClass(n.at))}
                >
                  {onSeek ? (
                    <button
                      type="button"
                      className="flex w-full gap-3 text-left"
                      onClick={() => onSeek(n.at)}
                      title="Jump the replay here"
                    >
                      {row}
                    </button>
                  ) : (
                    <span className="flex gap-3">{row}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </TabsContent>
    </Tabs>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

export function firstLine(text: string) {
  const line = text.split("\n")[0] ?? "";
  return line.length > 120 ? `${line.slice(0, 117)}…` : line;
}
