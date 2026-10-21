"use client";

import { isClosedStatus } from "@pinwren/core";
import { useQueries, useQuery } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, FileStack, ImageOff, Layers, MessageSquare, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { use, useMemo, useState } from "react";
import { ButtonLink } from "@/components/button-link";
import { CaptureView, type Marker } from "@/components/capture-view";
import { KIND_META, pathOf, StatusIcon, timeAgo } from "@/components/feedback-meta";
import { PageHeader } from "@/components/page-header";
import { Segmented } from "@/components/segmented";
import { EmptyState, ErrorState } from "@/components/states";
import { Thumb } from "@/components/thumb";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  api,
  assetUrl,
  type FeedbackDetail,
  type FeedbackList,
  type FeedbackRow,
  type ProjectDetail,
  qk,
  screenshotOf,
} from "@/lib/api";
import { useThumbnail } from "@/lib/feedback-hooks";
import { type Capture, captureOf, isRegion, placeOn } from "@/lib/geometry";
import { cn } from "@/lib/utils";
import { FeedbackDetailPanel } from "../../../inbox/feedback-detail";

const MAX_PAGES_OF_FEEDBACK = 5;
const MAX_REVIEW_ITEMS = 60;

type PageGroup = {
  url: string;
  items: FeedbackRow[];
  open: number;
  closed: number;
  latest: string;
  thumbItem: FeedbackRow | undefined;
};

/**
 * Every feedback item of the project (newest first). There is no pages endpoint, so pages are
 * derived from the feedback list — capped at 500 items, enough for review but not an archive.
 */
function useProjectFeedback(projectId: string) {
  return useQuery({
    queryKey: qk.feedbackList({ projectId, status: "all", scope: "pages" }),
    queryFn: async () => {
      const items: FeedbackRow[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < MAX_PAGES_OF_FEEDBACK; i++) {
        const sp = new URLSearchParams({ projectId, status: "all", limit: "100" });
        if (cursor) sp.set("cursor", cursor);
        const res: FeedbackList = await api<FeedbackList>(`/feedback?${sp}`);
        items.push(...res.items);
        cursor = res.nextCursor;
        if (!cursor) break;
      }
      return { items, nextCursor: cursor } satisfies FeedbackList;
    },
  });
}

export function PagesView({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const search = useSearchParams();
  const url = search.get("url");
  const project = useQuery({
    queryKey: qk.project(id),
    queryFn: () => api<{ project: ProjectDetail }>(`/projects/${id}`),
  });
  const feedback = useProjectFeedback(id);

  const groups = useMemo<PageGroup[]>(() => {
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
  }, [feedback.data]);

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
        {!url && (
          <ButtonLink href={`/projects/${id}`} size="sm" variant="ghost">
            <Settings /> <span className="hidden sm:inline">Settings</span>
          </ButtonLink>
        )}
      </PageHeader>
      {feedback.isError ? (
        <ErrorState error={feedback.error} retry={() => feedback.refetch()} />
      ) : url ? (
        feedback.isPending ? (
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
          pending={feedback.isPending}
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
  const thumb = useThumbnail(g.thumbItem?.id ?? "", !!g.thumbItem);
  return (
    <li>
      <Link
        href={`/projects/${projectId}/pages?url=${encodeURIComponent(g.url)}`}
        className="group block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <Card className="gap-0 overflow-hidden py-0 transition-colors group-hover:border-foreground/20">
          <div className="relative aspect-[16/10] overflow-hidden border-b bg-muted">
            {g.thumbItem && thumb.data ? (
              <Thumb src={assetUrl(thumb.data)} />
            ) : g.thumbItem && thumb.isPending ? (
              <Skeleton className="size-full rounded-none" />
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
  const details = useQueries({
    queries: rows.map((r) => ({
      queryKey: qk.feedback(r.id),
      queryFn: () => api<FeedbackDetail>(`/feedback/${r.id}`),
      staleTime: 60_000,
    })),
  });
  const reviewed: Reviewed[] = rows.map((row, i) => ({ row, detail: details[i]?.data }));
  const loading = details.some((d) => d.isPending);

  // Captures that carry geometry: a screenshot plus the anchor taken with it.
  const captures = reviewed.filter(
    (r) => r.detail && screenshotOf(r.detail.assets) && r.detail.feedback.anchor,
  );
  const [captureId, setCaptureId] = useState<string | null>(null);
  // Default: the capture on which the most threads can be placed; newest wins a tie.
  const best = captures.reduce<{ c: Reviewed | undefined; n: number }>(
    (acc, c) => {
      const cap = c.detail?.feedback.anchor ? captureOf(c.detail.feedback.anchor) : null;
      const n = cap
        ? reviewed.filter((r) => r.detail?.feedback.anchor && placeOn(r.detail.feedback.anchor, cap)).length
        : 0;
      return n > acc.n ? { c, n } : acc;
    },
    { c: captures[0], n: -1 },
  ).c;
  const base = captures.find((c) => c.row.id === captureId) ?? best;
  const baseShot = base?.detail ? screenshotOf(base.detail.assets) : undefined;
  const baseCapture: Capture | null = base?.detail?.feedback.anchor
    ? captureOf(base.detail.feedback.anchor)
    : null;

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
    router.replace(`${pathname}?${next}`, { scroll: false });
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
                          {/* biome-ignore lint/performance/noImgElement: authenticated asset route */}
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
                          {r.detail.feedback.anchor ? "Not on this capture" : "No position"}
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
                <div className="px-5 pb-5">
                  <ButtonLink href={`/inbox?status=all&item=${selected}`} size="sm" variant="outline">
                    Open in inbox
                  </ButtonLink>
                </div>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
