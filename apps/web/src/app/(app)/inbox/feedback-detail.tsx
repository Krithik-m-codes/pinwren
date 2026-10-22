"use client";

import { FEEDBACK_STATUSES, PRIORITIES } from "@pinwren/core";
import {
  BadgeCheck,
  Crosshair,
  Download,
  ExternalLink,
  FileText,
  Film,
  ImageIcon,
  Link2,
  MoreHorizontal,
  Paperclip,
  SquareDashed,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ButtonLink } from "@/components/button-link";
import { CaptureView, type Marker } from "@/components/capture-view";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { copyText } from "@/components/copy-button";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  type PresenceUser,
  screenshotOf,
} from "@/lib/api";
import { captureOf, isRegion, placeOn } from "@/lib/geometry";
import { itemLink, withParam } from "@/lib/links";
import {
  errorMessage,
  useDeleteFeedbackMutation,
  useFeedbackDetailQuery,
  useRoundsQuery,
  useUpdateFeedbackMutation,
} from "@/lib/store/api";
import type { FeedbackPatch } from "@/lib/store/api/feedback";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { type DetailMenu, menuChanged } from "@/lib/store/slices/inbox";
import { presenceWatched } from "@/lib/store/slices/realtime";
import { useMounted } from "@/lib/use-synced-state";
import { cn } from "@/lib/utils";
import { useMembers, useViewer } from "@/lib/viewer";
import { PresenceStack } from "./inbox-list";
import { ItemActions } from "./item-actions";
import { type ReplayHandle, ReplayViewer } from "./replay-viewer";
import { CommentComposer, Timeline } from "./timeline";

const statusItems = FEEDBACK_STATUSES.map((s) => ({ value: s, label: STATUS_META[s].label }));
const priorityItems = PRIORITIES.map((p) => ({ value: p, label: PRIORITY_META[p].label }));
const NO_ROUND = "none";
const NOBODY: PresenceUser[] = [];

/**
 * One item (blueprint 06 §3.2): header pickers, media (screenshot / session replay), attachments,
 * context tabs synced with the replay, and the timeline. Reports presence while open.
 */
export function FeedbackDetailPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const detail = useFeedbackDetailQuery(id);
  const dispatch = useAppDispatch();
  const { canWrite, userId } = useViewer();
  const watching = useAppSelector((s) => s.realtime.presence[id] ?? NOBODY);
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
  return <DetailBody data={detail.data} onClose={onClose} canWrite={canWrite} others={others} />;
}

function DetailBody({
  data,
  onClose,
  canWrite,
  others,
}: {
  data: FeedbackDetail;
  onClose: () => void;
  canWrite: boolean;
  others: PresenceUser[];
}) {
  const { feedback: f, assets } = data;
  const id = f.id;
  const dispatch = useAppDispatch();
  const members = useMembers();
  const menu = useAppSelector((s) => s.inbox.menu);
  const [update] = useUpdateFeedbackMutation();
  const [remove, removal] = useDeleteFeedbackMutation();
  const rounds = useRoundsQuery(f.projectId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const replay = assets.find((a) => a.kind === "replay");
  const player = useRef<ReplayHandle | null>(null);
  const [replayAt, setReplayAt] = useState<number | null>(null);

  const Kind = KIND_META[f.kind].icon;
  const memberItems = [
    { value: "unassigned", label: "Unassigned" },
    ...members.map((m) => ({ value: m.id, label: m.name })),
  ];
  const roundItems = [
    { value: NO_ROUND, label: "No round" },
    ...(rounds.data?.rounds ?? [])
      .filter((r) => r.status === "active" || r.id === f.roundId)
      .map((r) => ({ value: r.id, label: r.name })),
  ];
  const openOnPage = f.pageUrl ? withParam(f.pageUrl, "pinwren", f.id) : null;
  const patch = (p: FeedbackPatch) => {
    update({ ids: [id], patch: p })
      .unwrap()
      .catch((e: unknown) => toast.error(errorMessage(e)));
  };
  const setMenu = (m: DetailMenu) => dispatch(menuChanged(m));
  const reporter = f.reporterGuest?.name ?? f.reporterGuest?.email ?? "Anonymous visitor";

  return (
    <article className="flex flex-col" aria-label={`Feedback #${f.number}`} data-testid="feedback-detail">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background/90 px-4 py-2 backdrop-blur">
        <span className="font-mono text-xs text-muted-foreground tabular-nums">#{f.number}</span>
        <Badge variant="secondary" className="gap-1">
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
          <Button variant="ghost" size="sm" onClick={() => copyText(itemLink(f.id), "Link copied")}>
            <Link2 /> <span className="hidden sm:inline">Copy link</span>
          </Button>
          {openOnPage && (
            <ButtonLink href={openOnPage} external variant="ghost" size="sm">
              <ExternalLink /> <span className="hidden sm:inline">Open on page</span>
            </ButtonLink>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="More actions" />}>
              <MoreHorizontal />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={() => copyText(`#${f.number}`, "Number copied")}>
                Copy number
              </DropdownMenuItem>
              {f.pageUrl && (
                <DropdownMenuItem onClick={() => copyText(f.pageUrl ?? "", "Page URL copied")}>
                  Copy page URL
                </DropdownMenuItem>
              )}
              {canWrite && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => setConfirmDelete(true)}>
                    <Trash2 /> Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
            <X />
          </Button>
        </div>
      </header>

      <div className="space-y-6 px-4 py-5 sm:px-5">
        <div>
          <h2 className="text-lg leading-snug font-semibold text-balance break-words">
            {f.title || firstLine(f.body)}
          </h2>
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
            <Select
              items={memberItems}
              value={f.assigneeIds[0] ?? "unassigned"}
              open={menu === "assignee"}
              onOpenChange={(o) => setMenu(o ? "assignee" : null)}
              onValueChange={(v) => v && patch({ assigneeIds: v === "unassigned" ? [] : [v] })}
            >
              <SelectTrigger size="sm" aria-label="Assignee" data-testid="assignee-picker">
                {data.assignees[0] ? (
                  <UserAvatar
                    name={data.assignees[0].name}
                    image={data.assignees[0].image}
                    className="size-4"
                  />
                ) : null}
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {memberItems.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.value !== "unassigned" && <UserAvatar name={m.label} className="size-4" />}
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
              {data.assignees[0] ? data.assignees[0].name : "Unassigned"}
            </Badge>
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
            <CommentComposer feedbackId={id} />
          ) : (
            <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
              You have read-only access, so you can&apos;t reply.
            </p>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete #${f.number}?`}
        description="The item moves to the trash and is purged with its files after 30 days."
        pending={removal.isLoading}
        onConfirm={() => {
          remove([id])
            .unwrap()
            .then(() => {
              toast.success("Feedback deleted");
              setConfirmDelete(false);
              onClose();
            })
            .catch((e: unknown) => toast.error(errorMessage(e)));
        }}
      />
    </article>
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
        {placed && (
          <span className="ml-auto flex items-center gap-2">
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
                href={f.pageUrl}
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
          {f.metadata &&
            Object.entries(f.metadata).map(([k, v]) => (
              <Meta key={k} label={k}>
                <code className="font-mono text-xs break-all">{JSON.stringify(v)}</code>
              </Meta>
            ))}
        </dl>
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
