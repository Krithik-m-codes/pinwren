"use client";

import { useQuery } from "@tanstack/react-query";
import { Camera, Inbox as InboxIcon, MessageSquare, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { KIND_META, PriorityIcon, pathOf, StatusIcon, timeAgo } from "@/components/feedback-meta";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIsMobile } from "@/hooks/use-mobile";
import { api, type FeedbackRow, type Project } from "@/lib/api";
import { cn } from "@/lib/utils";
import { FeedbackDetailPanel } from "./feedback-detail";

const STATUS_TABS = [
  { value: "active", label: "Active" },
  { value: "resolved", label: "Resolved" },
  { value: "all", label: "All" },
] as const;

export function InboxView() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const searchRef = useRef<HTMLInputElement>(null);

  const projectId = params.get("project") ?? undefined;
  const status = params.get("status") ?? "active";
  const q = params.get("q") ?? "";
  const selected = params.get("item");

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
    queryKey: ["projects"],
    queryFn: () => api<{ projects: Project[] }>("/projects"),
  });
  const list = useQuery({
    queryKey: ["feedback", { projectId, status, q }],
    queryFn: () => {
      const sp = new URLSearchParams({ status, limit: "100" });
      if (projectId) sp.set("projectId", projectId);
      if (q) sp.set("q", q);
      return api<{ items: FeedbackRow[]; nextCursor: string | null }>(`/feedback?${sp}`);
    },
    refetchInterval: 20_000,
  });
  const items = useMemo(() => list.data?.items ?? [], [list.data]);
  const project = projects.data?.projects.find((p) => p.id === projectId);

  // j/k to move, Enter to open, Esc to close, / to search (blueprint 06 §5).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable=true], [role=listbox], [role=menu]")) return;
      const idx = items.findIndex((i) => i.id === selected);
      if (e.key === "j" || e.key === "ArrowDown") {
        const next = items[Math.min(idx + 1, items.length - 1)];
        if (next) setParam({ item: next.id });
        e.preventDefault();
      } else if (e.key === "k" || e.key === "ArrowUp") {
        const prev = items[Math.max(idx - 1, 0)];
        if (prev) setParam({ item: prev.id });
        e.preventDefault();
      } else if (e.key === "Escape" && selected) {
        setParam({ item: null });
      } else if (e.key === "/") {
        searchRef.current?.focus();
        e.preventDefault();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, selected, setParam]);

  const detail = selected ? (
    <FeedbackDetailPanel key={selected} id={selected} onClose={() => setParam({ item: null })} />
  ) : null;

  return (
    <div className="flex h-svh min-h-0 flex-col md:h-[calc(100svh-1rem)]">
      <PageHeader title={project ? project.name : "Inbox"}>
        {project && (
          <Button variant="outline" size="sm" render={<Link href={`/projects/${project.id}`} />}>
            Install & settings
          </Button>
        )}
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <Tabs value={status} onValueChange={(v) => setParam({ status: String(v), item: null })}>
          <TabsList>
            {STATUS_TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="px-3">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            defaultValue={q}
            placeholder="Search feedback  /"
            className="h-8 pl-8"
            onKeyDown={(e) => {
              if (e.key === "Enter") setParam({ q: e.currentTarget.value, item: null });
              if (e.key === "Escape") e.currentTarget.blur();
            }}
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <ul className={cn("min-h-0 flex-1 overflow-y-auto", detail && !isMobile && "max-w-[46%] border-r")}>
          {list.isPending &&
            ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"].map((k) => (
              <li key={k} className="flex items-center gap-3 border-b px-4 py-3">
                <Skeleton className="size-4 rounded-full" />
                <Skeleton className="h-4 flex-1" />
              </li>
            ))}
          {list.isError && (
            <li className="p-6 text-sm text-destructive">
              Couldn&apos;t load feedback. {list.error.message}
            </li>
          )}
          {list.isSuccess && items.length === 0 && (
            <EmptyInbox hasProjects={!!projects.data?.projects.length} />
          )}
          {items.map((f) => (
            <FeedbackListRow
              key={f.id}
              item={f}
              active={f.id === selected}
              onOpen={() => setParam({ item: f.id })}
            />
          ))}
        </ul>
        {detail && !isMobile && <div className="min-h-0 flex-1 overflow-y-auto">{detail}</div>}
      </div>

      {isMobile && (
        <Sheet open={!!selected} onOpenChange={(open) => !open && setParam({ item: null })}>
          <SheetContent side="right" className="w-full p-0 sm:max-w-full">
            <SheetTitle className="sr-only">Feedback</SheetTitle>
            <div className="h-full overflow-y-auto">{detail}</div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}

function FeedbackListRow({
  item,
  active,
  onOpen,
}: {
  item: FeedbackRow;
  active: boolean;
  onOpen: () => void;
}) {
  const Kind = KIND_META[item.kind].icon;
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-current={active || undefined}
        className={cn(
          "group flex w-full items-start gap-3 border-b px-4 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted focus-visible:outline-none",
          active && "bg-muted",
        )}
      >
        <StatusIcon status={item.status} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground tabular-nums">#{item.number}</span>
            <p className="min-w-0 flex-1 truncate text-sm font-medium">{item.title || item.body}</p>
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <Kind className="size-3.5 shrink-0" />
            <span className="truncate">{item.projectName}</span>
            {item.pageUrl && <span className="truncate font-mono">{pathOf(item.pageUrl)}</span>}
            <span className="ml-auto shrink-0">{timeAgo(item.createdAt)}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-0.5 text-muted-foreground">
          {item.hasScreenshot && <Camera aria-label="Has screenshot" className="size-3.5" />}
          {item.commentCount > 0 && (
            <span className="flex items-center gap-0.5 text-xs">
              <MessageSquare className="size-3.5" />
              {item.commentCount}
            </span>
          )}
          <PriorityIcon priority={item.priority} />
        </div>
      </button>
    </li>
  );
}

function EmptyInbox({ hasProjects }: { hasProjects: boolean }) {
  return (
    <li className="flex flex-col items-center justify-center gap-3 px-6 py-24 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-muted">
        <InboxIcon className="size-5 text-muted-foreground" />
      </span>
      <p className="font-medium">Nothing here</p>
      <p className="max-w-xs text-sm text-muted-foreground">
        {hasProjects
          ? "New pinned comments and bug reports from your sites will show up here."
          : "Create a project and add the widget to your site to start collecting feedback."}
      </p>
      <Button
        size="sm"
        variant="outline"
        render={<Link href={hasProjects ? "/projects" : "/projects?new=1"} />}
      >
        {hasProjects ? "View projects" : "Create a project"}
      </Button>
    </li>
  );
}
