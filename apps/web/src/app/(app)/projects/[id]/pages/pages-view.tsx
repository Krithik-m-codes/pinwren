"use client";

import { IGNORED_QUERY_PARAMS, isClosedStatus, roleCan, safeHref } from "@pinwren/core";
import {
  ArrowLeft,
  Crosshair,
  ExternalLink,
  FileStack,
  ImageOff,
  Layers,
  Loader2,
  MessageSquare,
  Plus,
  Settings,
  SlidersHorizontal,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { use, useState } from "react";
import { toast } from "sonner";
import { ButtonLink } from "@/components/button-link";
import { AnnotationsToggle, CaptureView, type Marker } from "@/components/capture-view";
import { KIND_META, pathOf, StatusIcon, timeAgo } from "@/components/feedback-meta";
import { PageHeader } from "@/components/page-header";
import { Segmented } from "@/components/segmented";
import { EmptyState, ErrorState } from "@/components/states";
import { Thumb } from "@/components/thumb";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { assetUrl, type FeedbackDetail, type FeedbackRow, screenshotOf } from "@/lib/api";
import {
  errorMessage,
  useFeedbackDetailsQuery,
  usePageLinkMutation,
  useProjectFeedbackQuery,
  useProjectQuery,
  useUpdateProjectMutation,
} from "@/lib/store/api";
import { useRegroupPagesMutation, useRepinLinkMutation } from "@/lib/store/api/page-review";
import { useViewer } from "@/lib/viewer";
import { type Capture, captureOf, isRegion, placeOn } from "@/lib/geometry";
import { cn } from "@/lib/utils";
import { FeedbackDetailPanel } from "../../../inbox/feedback-detail";
import { here } from "@/lib/routes";

const MAX_REVIEW_ITEMS = 60;

type PageGroup = {
  url: string;
  items: FeedbackRow[];
  open: number;
  closed: number;
  latest: string;
  thumbItem: FeedbackRow | undefined;
};

export function PagesView({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const search = useSearchParams();
  const url = search.get("url");
  const project = useProjectQuery(id);
  // Pages are derived from the project's feedback (up to 500 items; there is no pages endpoint).
  const feedback = useProjectFeedbackQuery(id);

  const groups: PageGroup[] = (() => {
    const map = new Map<string, FeedbackRow[]>();
    for (const f of feedback.data?.items ?? []) {
      if (!f.pageUrl) continue;
      const list = map.get(f.pageUrl) ?? [];
      list.push(f);
      map.set(f.pageUrl, list);
    }
    return [...map.entries()]
      .map(([u, items]) => ({
        url: u,
        items,
        open: items.filter((i) => !isClosedStatus(i.status)).length,
        closed: items.filter((i) => isClosedStatus(i.status)).length,
        latest: items[0]?.createdAt ?? "",
        thumbItem: items.find((i) => i.hasScreenshot),
      }))
      .sort((a, b) => b.latest.localeCompare(a.latest));
  })();

  const name = project.data?.project.name ?? "Project";
  const group = url ? groups.find((g) => g.url === url) : undefined;

  return (
    <div className="flex min-h-svh flex-col md:min-h-[calc(100svh-1rem)]">
      <PageHeader
        title={
          <span className="flex items-center gap-1.5">
            <Link href={`/projects/${id}`} className="text-muted-foreground hover:text-foreground">
              {name}
            </Link>
            <span className="text-muted-foreground">/</span>
            {url ? (
              <>
                <Link href={`/projects/${id}/pages`} className="text-muted-foreground hover:text-foreground">
                  Pages
                </Link>
                <span className="text-muted-foreground">/</span>
                <span className="truncate font-mono text-xs">{pathOf(url)}</span>
              </>
            ) : (
              "Pages"
            )}
          </span>
        }
      >
        {!url && project.data && (
          <UrlGrouping projectId={id} ignored={project.data.project.widgetConfig.ignoredQueryParams} />
        )}
        {!url && (
          <ButtonLink href={`/projects/${id}`} size="sm" variant="ghost">
            <Settings /> <span className="hidden sm:inline">Settings</span>
          </ButtonLink>
        )}
      </PageHeader>
      {feedback.isError ? (
        <ErrorState error={feedback.error} retry={() => void feedback.refetch()} />
      ) : url ? (
        feedback.isLoading ? (
          <ReviewSkeleton />
        ) : group ? (
          <PageReview group={group} projectId={id} />
        ) : (
          <EmptyState
            icon={FileStack}
            title="No feedback on this page"
            description="It may have been deleted or the address changed."
            action={
              <ButtonLink href={`/projects/${id}/pages`} size="sm" variant="outline">
                <ArrowLeft /> All pages
              </ButtonLink>
            }
          />
        )
      ) : (
        <PageGrid
          groups={groups}
          pending={feedback.isLoading}
          projectId={id}
          truncated={!!feedback.data?.nextCursor}
        />
      )}
    </div>
  );
}

function PageGrid({
  groups,
  pending,
  projectId,
  truncated,
}: {
  groups: PageGroup[];
  pending: boolean;
  projectId: string;
  truncated: boolean;
}) {
  if (pending) {
    return (
      <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="aspect-[4/3] rounded-xl" />
        ))}
      </div>
    );
  }
  if (!groups.length) {
    return (
      <EmptyState
        icon={FileStack}
        title="No pages with feedback yet"
        description="Each page where someone leaves a comment or bug report appears here with its screenshot."
        action={
          <ButtonLink href={`/projects/${projectId}`} size="sm" variant="outline">
            Install the widget
          </ButtonLink>
        }
      />
    );
  }
  return (
    <div className="p-4">
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Pages">
        {groups.map((g) => (
          <PageCard key={g.url} group={g} projectId={projectId} />
        ))}
      </ul>
      {truncated && (
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Showing pages from the newest 500 items.
        </p>
      )}
    </div>
  );
}

function PageCard({ group: g, projectId }: { group: PageGroup; projectId: string }) {
  // The list rows carry the thumbnail's asset id: no detail request per card.
  const thumb = g.thumbItem?.screenshotAssetId ?? null;
  return (
    <li>
      <Link
        href={`/projects/${projectId}/pages?url=${encodeURIComponent(g.url)}`}
        className="group block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <Card className="gap-0 overflow-hidden py-0 transition-colors group-hover:border-foreground/20">
          <div className="relative aspect-[16/10] overflow-hidden border-b bg-muted">
            {thumb ? (
              <Thumb src={assetUrl(thumb)} />
            ) : (
              <div className="grid size-full place-items-center text-muted-foreground">
                <ImageOff className="size-5" />
              </div>
            )}
          </div>
          <div className="space-y-1.5 p-3">
            <p className="truncate font-mono text-sm">{pathOf(g.url)}</p>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span>
                <span className="font-medium text-foreground tabular-nums">{g.open}</span> open
              </span>
              <span>
                <span className="tabular-nums">{g.closed}</span> closed
              </span>
              <span className="ml-auto">{timeAgo(g.latest)}</span>
            </div>
          </div>
        </Card>
      </Link>
    </li>
  );
}

function ReviewSkeleton() {
  return (
    <div className="grid flex-1 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <Skeleton className="aspect-[16/10] rounded-xl" />
      <div className="space-y-2">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
    </div>
  );
}

type Reviewed = { row: FeedbackRow; detail: FeedbackDetail | undefined };

/**
 * Figma-style page review: the latest capture of the page with every pin and region drawn where it
 * was left, the thread list beside it. Pins from other viewport widths (or scrolled out of the
 * capture) can't be placed honestly, so they are listed as "not on this capture".
 */
function PageReview({ group, projectId }: { group: PageGroup; projectId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [show, setShow] = useState<"open" | "all">("open");
  const [hover, setHover] = useState<string | null>(null);
  const selected = search.get("item");
  const rows = group.items.slice(0, MAX_REVIEW_ITEMS);
  // One request batch for every thread on the page; each detail also lands in its own cache entry.
  const details = useFeedbackDetailsQuery(rows.map((r) => r.id));
  const byId = new Map(details.data?.map((d) => [d.feedback.id, d]));
  const reviewed: Reviewed[] = rows.map((row) => ({ row, detail: byId.get(row.id) }));
  const loading = details.isLoading;

  // Captures that carry geometry: every screenshot taken with a bug report or comment (wave-5 §2), plus
  // older ones whose anchor recorded the viewport.
  const captures = reviewed.filter((r) => r.detail && geometryOf(r.detail));
  const [captureId, setCaptureId] = useState<string | null>(null);
  const [showMarks, setShowMarks] = useState(true);
  // Default: the capture on which the most threads can be placed; newest wins a tie.
  const best = captures.reduce<{ c: Reviewed | undefined; n: number }>(
    (acc, c) => {
      const cap = c.detail ? geometryOf(c.detail) : null;
      const n = cap
        ? reviewed.filter((r) => r.detail?.feedback.anchor && placeOn(r.detail.feedback.anchor, cap)).length
        : 0;
      return n > acc.n ? { c, n } : acc;
    },
    { c: captures[0], n: -1 },
  ).c;
  const base = captures.find((c) => c.row.id === captureId) ?? best;
  const baseShot = base?.detail ? screenshotOf(base.detail.assets) : undefined;
  const baseCapture: Capture | null = base?.detail ? geometryOf(base.detail) : null;

  const visible = reviewed.filter(
    (r) => show === "all" || !isClosedStatus(r.detail?.feedback.status ?? r.row.status),
  );
  const placements = new Map(
    visible.map((r) => {
      const a = r.detail?.feedback.anchor;
      return [r.row.id, a && baseCapture ? placeOn(a, baseCapture) : null] as const;
    }),
  );

  const open = (id: string | null) => {
    const next = new URLSearchParams(search);
    if (id) next.set("item", id);
    else next.delete("item");
    router.replace(here(pathname, next), { scroll: false });
  };

  const markers: Marker[] = visible.flatMap((r) => {
    const p = placements.get(r.row.id);
    if (!p) return [];
    return [
      {
        ...p,
        id: r.row.id,
        label: String(r.row.number),
        status: r.detail?.feedback.status ?? r.row.status,
        active: r.row.id === selected || r.row.id === hover,
        title: `#${r.row.number} ${r.row.title || r.row.body}`.slice(0, 120),
        onSelect: () => open(r.row.id),
      },
    ];
  });
  const offCapture = visible.filter((r) => !placements.get(r.row.id)).length;

  return (
    <div className="grid flex-1 items-start gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_21rem]">
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Show"
            value={show}
            onChange={setShow}
            options={[
              { value: "open", label: `Open ${group.open}` },
              { value: "all", label: `All ${group.items.length}` },
            ]}
          />
          <ButtonLink href={group.url} external size="sm" variant="ghost" className="ml-auto">
            <ExternalLink /> Open page
          </ButtonLink>
        </div>
        {loading && !base ? (
          <Skeleton className="aspect-[16/10] rounded-xl" />
        ) : base && baseShot ? (
          <>
            <CaptureView
              src={assetUrl(baseShot.id)}
              alt={`Capture of ${pathOf(group.url)} from #${base.row.number}`}
              markers={markers}
              className="shadow-sm"
              annotations={baseShot.annotations}
              showAnnotations={showMarks}
            />
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Layers className="size-3.5" /> Capture from #{base.row.number}, {timeAgo(base.row.createdAt)}
                {baseCapture && (
                  <span className="tabular-nums">
                    {" "}
                    · {Math.round(baseCapture.vw)}×{Math.round(baseCapture.vh)}
                  </span>
                )}
              </span>
              <span>
                {markers.length} placed{offCapture > 0 && ` · ${offCapture} not on this capture`}
              </span>
              <span className="ml-auto">
                <AnnotationsToggle
                  layer={baseShot.annotations}
                  pressed={showMarks}
                  onPressedChange={setShowMarks}
                />
              </span>
            </p>
            {captures.length > 1 && (
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">Other captures</p>
                <ul className="flex gap-2 overflow-x-auto pb-1">
                  {captures.map((c) => {
                    const shot = c.detail ? screenshotOf(c.detail.assets) : undefined;
                    if (!shot) return null;
                    const active = c.row.id === base.row.id;
                    return (
                      <li key={c.row.id} className="shrink-0">
                        <button
                          type="button"
                          onClick={() => setCaptureId(c.row.id)}
                          aria-pressed={active}
                          aria-label={`Use the capture from #${c.row.number}`}
                          className={cn(
                            "block w-28 overflow-hidden rounded-md border-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                            active ? "border-primary" : "border-transparent hover:border-border",
                          )}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element -- session-authenticated asset; next/image would fetch it without the cookie */}
                          <img
                            src={assetUrl(shot.id)}
                            alt=""
                            className="aspect-[16/10] w-full object-cover object-top"
                          />
                          <span className="block bg-muted px-1.5 py-0.5 text-left font-mono text-[10px] text-muted-foreground">
                            #{c.row.number}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </>
        ) : (
          <div className="grid aspect-[16/10] place-items-center rounded-xl border border-dashed bg-muted/30 p-6 text-center">
            <div>
              <ImageOff className="mx-auto mb-2 size-5 text-muted-foreground" />
              <p className="text-sm font-medium">No capture of this page yet</p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Turn on “Screenshot with every comment” in{" "}
                <Link className="underline underline-offset-4" href={`/projects/${projectId}?tab=capture`}>
                  Capture settings
                </Link>{" "}
                to see pins in place.
              </p>
            </div>
          </div>
        )}
      </div>

      <aside className="min-w-0 lg:sticky lg:top-16" aria-label="Threads on this page">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <MessageSquare className="size-4" /> Threads
          <span className="font-normal text-muted-foreground tabular-nums">{visible.length}</span>
        </h2>
        {visible.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            Nothing open on this page. Switch to All to see resolved threads.
          </p>
        ) : (
          <ul className="space-y-1.5 lg:max-h-[calc(100svh-9rem)] lg:overflow-y-auto lg:pr-1">
            {visible.map((r) => {
              const Kind = KIND_META[r.row.kind].icon;
              const placed = !!placements.get(r.row.id);
              const status = r.detail?.feedback.status ?? r.row.status;
              return (
                <li key={r.row.id}>
                  <button
                    type="button"
                    onClick={() => open(r.row.id)}
                    onMouseEnter={() => setHover(r.row.id)}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => setHover(r.row.id)}
                    onBlur={() => setHover(null)}
                    aria-current={r.row.id === selected || undefined}
                    className={cn(
                      "flex w-full items-start gap-2.5 rounded-lg border bg-card p-2.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                      r.row.id === selected && "border-primary/50 bg-muted",
                    )}
                  >
                    <span
                      className={cn(
                        "grid h-5 min-w-5 shrink-0 place-items-center rounded-full rounded-bl-none px-1 text-[10px] font-semibold text-white tabular-nums",
                        isClosedStatus(status) ? "bg-emerald-600" : "bg-blue-600",
                      )}
                    >
                      {r.row.number}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-sm leading-snug">{r.row.title || r.row.body}</span>
                      <span className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <StatusIcon status={status} className="size-3.5" />
                        <Kind className="size-3.5" />
                        {isRegion(r.detail?.feedback.anchor) && <span>Region</span>}
                        <span className="ml-auto">{timeAgo(r.row.createdAt)}</span>
                      </span>
                      {!placed && r.detail && (
                        <Badge variant="outline" className="mt-1.5 font-normal text-muted-foreground">
                          {/* No anchor: a bug report or a comment on the whole page (wave-5 §3.3). */}
                          {r.detail.feedback.anchor ? "Not on this capture" : "Whole page"}
                        </Badge>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      <Sheet open={!!selected} onOpenChange={(o) => !o && open(null)}>
        <SheetContent
          side="right"
          showCloseButton={false}
          className="p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl"
        >
          <SheetTitle className="sr-only">Feedback</SheetTitle>
          <div className="h-full overflow-y-auto">
            {selected && (
              <>
                <FeedbackDetailPanel key={selected} id={selected} onClose={() => open(null)} />
                <div className="flex flex-wrap gap-2 px-5 pb-5">
                  <ButtonLink href={`/inbox?status=all&item=${selected}`} size="sm" variant="outline">
                    Open in inbox
                  </ButtonLink>
                  <OnPageActions
                    id={selected}
                    anchored={!!byId.get(selected)?.feedback.anchor}
                    hasPage={!!byId.get(selected)?.feedback.pageUrl}
                  />
                </div>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/**
 * Where a capture was taken (wave-5 §2): the screenshot's own geometry when the widget sent it (bug reports,
 * "Screenshot with every comment"), else the viewport the item's anchor recorded (older items). An element
 * capture shows no viewport, so nothing can be placed on it.
 */
function geometryOf(d: FeedbackDetail): Capture | null {
  const shot = screenshotOf(d.assets);
  if (!shot) return null;
  const g = shot.capture;
  if (g) return g.mode === "element" ? null : { vw: g.vw, vh: g.vh, scrollY: g.scrollY };
  return d.feedback.anchor ? captureOf(d.feedback.anchor) : null;
}

/**
 * "Open on page" (a signed link, so private pins open too) and, for Admins and Editors, "Re-pin on page": the
 * widget opens in re-pin mode and the next click moves the pin (F-031, wave-5 §3.3).
 */
function OnPageActions({ id, anchored, hasPage }: { id: string; anchored: boolean; hasPage: boolean }) {
  const { me } = useViewer();
  const [pageLink, linking] = usePageLinkMutation();
  const [repinLink, repinning] = useRepinLinkMutation();
  if (!hasPage) return null;
  const canRepin = !!me && roleCan(me.role, "feedback.update");
  const go = (make: () => Promise<{ url: string }>, what: string) => {
    // Open the tab inside the click so the browser doesn't block it, then point it at the link.
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    make()
      .then(({ url }) => {
        const safe = safeHref(url);
        if (!safe) throw new Error("The page address isn't a web link");
        if (tab) tab.location.href = safe;
        else window.open(safe, "_blank", "noopener");
      })
      .catch((e: unknown) => {
        tab?.close();
        toast.error(`Couldn't ${what}`, { description: errorMessage(e) });
      });
  };
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={linking.isLoading}
        onClick={() => go(() => pageLink(id).unwrap(), "open the page")}
        data-testid="review-open-on-page"
      >
        {linking.isLoading ? <Loader2 className="animate-spin" /> : <ExternalLink />} Open on page
      </Button>
      {canRepin && anchored && (
        <Button
          size="sm"
          variant="outline"
          disabled={repinning.isLoading}
          onClick={() => go(() => repinLink(id).unwrap(), "start re-pinning")}
          title="Opens the page with the widget in re-pin mode: click where this item belongs"
          data-testid="review-repin"
        >
          {repinning.isLoading ? <Loader2 className="animate-spin" /> : <Crosshair />} Re-pin on page
        </Button>
      )}
    </>
  );
}

const PARAM = /^[A-Za-z0-9_.\-[\]]{1,63}\*?$/;

/**
 * Page Review › URL grouping (Admins): query parameters that don't identify a page on this site, on top of the
 * built-in trackers. Saving re-groups the project's existing pages at once.
 */
function UrlGrouping({ projectId, ignored }: { projectId: string; ignored: string[] }) {
  const { me } = useViewer();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<string[]>(ignored);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [update, updating] = useUpdateProjectMutation();
  const [regroup, regrouping] = useRegroupPagesMutation();
  if (!me || !roleCan(me.role, "projects.manage")) return null;
  const busy = updating.isLoading || regrouping.isLoading;

  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (!PARAM.test(v)) {
      setError("Use a parameter name, optionally ending in * (for example sid or hsa_*)");
      return;
    }
    if (list.length >= 30) {
      setError("At most 30 parameters");
      return;
    }
    if (!list.includes(v)) setList([...list, v]);
    setDraft("");
    setError(null);
  };
  const save = async () => {
    try {
      await update({ id: projectId, patch: { widgetConfig: { ignoredQueryParams: list } } }).unwrap();
      const { merged } = await regroup(projectId).unwrap();
      toast.success(merged ? `Saved · ${merged} page${merged === 1 ? "" : "s"} re-grouped` : "Saved");
      setOpen(false);
    } catch (e) {
      toast.error("Not saved", { description: errorMessage(e) });
    }
  };

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          setList(ignored);
          setDraft("");
          setError(null);
          setOpen(true);
        }}
        data-testid="url-grouping"
      >
        <SlidersHorizontal /> <span className="hidden sm:inline">URL grouping</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>URL grouping</DialogTitle>
            <DialogDescription>
              Pages that differ only in these query parameters count as one page, so their pins and reviews
              stay together. Campaign and tracking parameters (
              {IGNORED_QUERY_PARAMS.filter((p) => !p.startsWith("pin") && p !== "pwt").join(", ")}, utm_*) and
              a trailing slash are always ignored.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            {list.length > 0 ? (
              <ul className="flex flex-wrap gap-2" aria-label="Ignored parameters">
                {list.map((p) => (
                  <li key={p}>
                    <Badge variant="secondary" className="h-6 gap-1 pr-1 font-mono">
                      {p}
                      <button
                        type="button"
                        aria-label={`Remove ${p}`}
                        className="rounded p-0.5 hover:bg-foreground/10"
                        onClick={() => setList(list.filter((x) => x !== p))}
                      >
                        <X className="size-3" />
                      </button>
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                No extra parameters: only the built-in ones are ignored.
              </p>
            )}
            <form
              className="grid gap-1.5"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                add();
              }}
            >
              <div className="flex gap-2">
                <Input
                  id="ignored-param"
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    setError(null);
                  }}
                  placeholder="sessionid or ab_*"
                  aria-label="Add a parameter"
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? "ignored-param-error" : undefined}
                  className="font-mono"
                />
                <Button type="submit" variant="outline" disabled={!draft.trim()}>
                  <Plus /> Add
                </Button>
              </div>
              {error && (
                <p id="ignored-param-error" className="text-xs text-destructive">
                  {error}
                </p>
              )}
            </form>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={busy} data-testid="url-grouping-save">
              {busy && <Loader2 className="animate-spin" />} Save and re-group
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
