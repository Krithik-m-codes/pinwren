"use client";

import { FEEDBACK_STATUSES, type FeedbackStatus, PRIORITIES, type Priority } from "@annota/core";
import {
  Crosshair,
  Download,
  ExternalLink,
  FileText,
  ImageIcon,
  Link2,
  MoreHorizontal,
  Paperclip,
  SquareDashed,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import { ButtonLink } from "@/components/button-link";
import { CaptureView, type Marker } from "@/components/capture-view";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { copyText } from "@/components/copy-button";
import {
  KIND_META,
  PRIORITY_META,
  PriorityIcon,
  STATUS_META,
  StatusIcon,
  timeAgo,
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
import { type Asset, assetUrl, type FeedbackDetail, formatBytes, screenshotOf } from "@/lib/api";
import {
  type FeedbackPatch,
  itemLink,
  useDeleteFeedback,
  useFeedbackDetail,
  useMembers,
  useUpdateFeedback,
  withParam,
} from "@/lib/feedback-hooks";
import { captureOf, isRegion, placeOn } from "@/lib/geometry";
import { cn } from "@/lib/utils";
import { ItemActions } from "./item-actions";
import { CommentComposer, Timeline } from "./timeline";

export type DetailMenu = "status" | "priority" | "assignee" | null;

const statusItems = FEEDBACK_STATUSES.map((s) => ({ value: s, label: STATUS_META[s].label }));
const priorityItems = PRIORITIES.map((p) => ({ value: p, label: PRIORITY_META[p].label }));

export function FeedbackDetailPanel({
  id,
  onClose,
  menu = null,
  onMenuChange,
}: {
  id: string;
  onClose: () => void;
  /** Which picker is open — lets the inbox's `s` / `p` / `a` keys open them. */
  menu?: DetailMenu;
  onMenuChange?: (menu: DetailMenu) => void;
}) {
  const detail = useFeedbackDetail(id);
  const members = useMembers();
  const update = useUpdateFeedback();
  const remove = useDeleteFeedback();
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (detail.isPending) {
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
  if (detail.isError) return <ErrorState error={detail.error} retry={() => detail.refetch()} />;

  const data = detail.data;
  const { feedback: f, assets } = data;
  const Kind = KIND_META[f.kind].icon;
  const assignee = f.assigneeIds[0] ?? "unassigned";
  const memberItems = [
    { value: "unassigned", label: "Unassigned" },
    ...(members.data?.members.map((m) => ({ value: m.id, label: m.name })) ?? []),
  ];
  const openOnPage = f.pageUrl ? withParam(f.pageUrl, "annota", f.id) : null;
  const patch = (p: FeedbackPatch) => update.mutate({ ids: [id], patch: p });

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
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setConfirmDelete(true)}>
                <Trash2 /> Delete
              </DropdownMenuItem>
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
          <p className="mt-1 text-xs text-muted-foreground">
            {f.reporterGuest?.name ?? f.reporterGuest?.email ?? "Anonymous visitor"} · {timeAgo(f.createdAt)}
            {f.pageTitle && <> · {f.pageTitle}</>}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Select
            items={statusItems}
            value={f.status}
            open={menu === "status"}
            onOpenChange={(o) => onMenuChange?.(o ? "status" : null)}
            onValueChange={(v) => v && patch({ status: v as FeedbackStatus })}
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
            onOpenChange={(o) => onMenuChange?.(o ? "priority" : null)}
            onValueChange={(v) => v && patch({ priority: v as Priority })}
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
            value={assignee}
            open={menu === "assignee"}
            onOpenChange={(o) => onMenuChange?.(o ? "assignee" : null)}
            onValueChange={(v) => v && patch({ assigneeIds: v === "unassigned" ? [] : [String(v)] })}
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
        </div>

        <ItemActions data={data} />

        <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">{f.body}</p>

        <Media data={data} />

        <Attachments assets={assets.filter((a) => a.kind === "attachment")} />

        <ContextTabs data={data} />

        <section aria-label="Activity" className="space-y-3">
          <h3 className="text-sm font-semibold">Activity</h3>
          <Timeline data={data} />
          <CommentComposer feedbackId={id} />
        </section>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete #${f.number}?`}
        description="The item moves to the trash and is purged with its files after 30 days."
        pending={remove.isPending}
        onConfirm={() =>
          remove.mutate([id], {
            onSuccess: () => {
              setConfirmDelete(false);
              onClose();
            },
          })
        }
      />
    </article>
  );
}

/** Screenshot with the item's own pin / region drawn at its captured position. */
function Media({ data }: { data: FeedbackDetail }) {
  const { feedback: f, assets } = data;
  const [showPin, setShowPin] = useState(true);
  const shot = screenshotOf(assets);
  if (!shot) return null;
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
                  // biome-ignore lint/performance/noImgElement: authenticated asset route
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

function ContextTabs({ data }: { data: FeedbackDetail }) {
  const { feedback: f, diagnostics } = data;
  const consoleEntries = diagnostics?.console ?? [];
  const networkEntries = diagnostics?.network ?? [];
  const a = f.anchor;
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
              {a.attrs?.annotaAnchor && (
                <code className="ml-2 font-mono text-xs">
                  data-annota-anchor=&quot;{a.attrs.annotaAnchor}&quot;
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
          <ul className="divide-y overflow-hidden rounded-lg border font-mono text-xs">
            {consoleEntries.map((e, i) => (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: log lines have no id
                key={i}
                className={cn(
                  "px-3 py-1.5 break-all whitespace-pre-wrap",
                  e.level === "error" && "bg-destructive/5 text-destructive",
                  e.level === "warn" && "bg-amber-500/5 text-amber-700 dark:text-amber-400",
                )}
              >
                {e.message}
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
            {networkEntries.map((n, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: request entries have no id
              <li key={i} className="flex gap-3 px-3 py-1.5">
                <span
                  className={cn("w-10 shrink-0", n.status >= 400 || n.status === 0 ? "text-destructive" : "")}
                >
                  {n.status || "ERR"}
                </span>
                <span className="w-12 shrink-0 text-muted-foreground">{n.method}</span>
                <span className="min-w-0 flex-1 break-all">{n.url}</span>
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {Math.round(n.durationMs)}ms
                </span>
              </li>
            ))}
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
