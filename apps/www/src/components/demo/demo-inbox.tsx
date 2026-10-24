"use client";

import {
  ArrowLeft,
  Bug,
  CircleHelp,
  ExternalLink,
  Image as ImageIcon,
  Inbox,
  Lightbulb,
  type LucideIcon,
  MessageSquare,
  RefreshCw,
  SquareDashed,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ButtonLink } from "@/components/button-link";
import { ResetDemoButton } from "@/components/demo/reset-button";
import { demoKey } from "@/components/demo/demo-widget";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// A read-only copy of the dashboard inbox, showing this visitor's demo sandbox (GET /demo-api/inbox).

type Status = "open" | "in_progress" | "in_review" | "resolved" | "wont_fix" | "duplicate";
type Kind = "comment" | "bug" | "idea" | "question";
type Item = {
  id: string;
  number: number;
  kind: Kind;
  status: Status;
  priority: "none" | "low" | "medium" | "high" | "urgent";
  title: string | null;
  body: string;
  anchor: { css: string; pin: { xPct: number; yPct: number; wPct?: number; hPct?: number } } | null;
  page: { url: string; path: string; title: string | null };
  environment: {
    browser?: string;
    os?: string;
    viewport: { w: number; h: number };
    locale?: string;
  } | null;
  diagnostics: { console: number; network: number; errors: string[]; failed: string[] };
  reporter: { name: string | null; email: string | null };
  assets: {
    id: string;
    kind: "screenshot" | "attachment";
    name: string | null;
    contentType: string;
    bytes: number;
  }[];
  replies: { id: string; body: string; createdAt: string; authorName: string | null; team: boolean }[];
  createdAt: string;
  seeded: boolean;
};

const STATUS: Record<Status, { label: string; dot: string }> = {
  open: { label: "Open", dot: "bg-brand" },
  in_progress: { label: "In progress", dot: "bg-warning" },
  in_review: { label: "In review", dot: "bg-sky-500" },
  resolved: { label: "Resolved", dot: "bg-success" },
  wont_fix: { label: "Won’t fix", dot: "bg-muted-foreground" },
  duplicate: { label: "Duplicate", dot: "bg-muted-foreground" },
};
const KIND: Record<Kind, { label: string; icon: LucideIcon }> = {
  // Same words as the widget and the dashboard: Question / Change / Bug / Other.
  comment: { label: "Other", icon: MessageSquare },
  bug: { label: "Bug", icon: Bug },
  idea: { label: "Change", icon: Lightbulb },
  question: { label: "Question", icon: CircleHelp },
};
const PRIORITY: Record<Item["priority"], string> = {
  none: "No priority",
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};
const FILTERS = [
  { id: "active", label: "Active" },
  { id: "all", label: "All" },
  { id: "closed", label: "Closed" },
] as const;
type Filter = (typeof FILTERS)[number]["id"];
const isClosed = (s: Status) => s === "resolved" || s === "wont_fix" || s === "duplicate";

function ago(iso: string) {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

const initials = (name: string | null) =>
  (name ?? "Guest")
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; items: Item[] };

export function DemoInbox() {
  const params = useSearchParams();
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [filter, setFilter] = useState<Filter>("active");
  const [tick, setTick] = useState(0);
  const selectedId = params.get("item");

  useEffect(() => {
    let live = true;
    demoKey(); // a first-time visitor gets a sandbox (seeded on first read) without opening /demo first
    fetch("/demo-api/inbox", { cache: "no-store" })
      .then(async (res) => {
        const data = (await res.json()) as { items?: Item[]; title?: string };
        if (!live) return;
        if (!res.ok || !data.items)
          setLoad({ state: "error", message: data.title ?? "Couldn’t load the inbox" });
        else setLoad({ state: "ready", items: data.items });
      })
      .catch(() => {
        if (live) setLoad({ state: "error", message: "Couldn’t reach the demo server" });
      });
    return () => {
      live = false;
    };
  }, [tick]);

  const items = useMemo(() => {
    if (load.state !== "ready") return [];
    return load.items.filter((i) =>
      filter === "all" ? true : filter === "closed" ? isClosed(i.status) : !isClosed(i.status),
    );
  }, [load, filter]);
  const selected = items.find((i) => i.id === selectedId) ?? items[0] ?? null;

  const select = useCallback(
    (id: string) => router.replace(`/demo/inbox?item=${encodeURIComponent(id)}`, { scroll: false }),
    [router],
  );

  // j / k move through the list, like the dashboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || t?.closest("input, textarea, [contenteditable]")) return;
      if (e.key !== "j" && e.key !== "k") return;
      const idx = selected ? items.indexOf(selected) : -1;
      const next = items[Math.min(items.length - 1, Math.max(0, idx + (e.key === "j" ? 1 : -1)))];
      if (next) {
        e.preventDefault();
        select(next.id);
        document.getElementById(`row-${next.id}`)?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, selected, select]);

  const counts = useMemo(() => {
    const all = load.state === "ready" ? load.items : [];
    return {
      active: all.filter((i) => !isClosed(i.status)).length,
      all: all.length,
      closed: all.filter((i) => isClosed(i.status)).length,
    };
  }, [load]);

  return (
    <div className="flex min-h-[calc(100dvh-3.5rem)] flex-col">
      <div className="border-b bg-background">
        <div className="container-page flex flex-wrap items-center gap-3 py-4">
          <div className="flex items-center gap-3">
            <span className="bg-brand-soft text-brand grid size-9 place-items-center rounded-lg">
              <Inbox className="size-4.5" aria-hidden />
            </span>
            <div>
              <h1 className="text-lg leading-tight font-semibold">Inbox</h1>
              <p className="text-xs text-muted-foreground">Pinwren demo · your sandbox · read-only</p>
            </div>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" onClick={() => setTick((t) => t + 1)}>
              <RefreshCw aria-hidden />
              Refresh
            </Button>
            <ResetDemoButton />
            <ButtonLink href="/demo" size="sm" className="bg-brand text-brand-foreground hover:bg-brand/90">
              <ArrowLeft aria-hidden />
              Back to the page
            </ButtonLink>
          </div>
        </div>
      </div>

      <div className="container-page grid flex-1 gap-5 py-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <section aria-label="Feedback" className="flex min-w-0 flex-col rounded-2xl border bg-card shadow-xs">
          <div role="tablist" aria-label="Status filter" className="flex gap-1 border-b p-2">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-sm font-medium transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                  filter === f.id
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {f.label}
                <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">{counts[f.id]}</span>
              </button>
            ))}
            <span className="ml-auto hidden items-center gap-1 pr-1 text-xs text-muted-foreground sm:flex">
              <kbd className="rounded border bg-background px-1 font-mono">j</kbd>
              <kbd className="rounded border bg-background px-1 font-mono">k</kbd>
              to move
            </span>
          </div>
          {load.state === "loading" && (
            <ul className="space-y-px p-2" aria-busy="true" aria-label="Loading feedback">
              {[0, 1, 2, 3].map((i) => (
                <li key={i} className="h-16 animate-pulse rounded-lg bg-muted/60" />
              ))}
            </ul>
          )}
          {load.state === "error" && (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-sm">
              <TriangleAlert className="text-warning size-5" aria-hidden />
              <p className="text-muted-foreground">{load.message}</p>
              <ButtonLink href="/demo" size="sm" variant="outline">
                Open the demo page
              </ButtonLink>
            </div>
          )}
          {load.state === "ready" && items.length === 0 && (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-sm">
              <Inbox className="size-5 text-muted-foreground" aria-hidden />
              <p className="font-medium">Nothing here</p>
              <p className="text-muted-foreground">
                {filter === "closed"
                  ? "Resolve a pin on the demo page and it shows up here."
                  : "Leave a comment on the demo page to see it arrive."}
              </p>
            </div>
          )}
          {load.state === "ready" && items.length > 0 && (
            <ul className="divide-y" aria-label="Feedback list">
              {items.map((i) => {
                const K = KIND[i.kind];
                const active = selected?.id === i.id;
                return (
                  <li key={i.id}>
                    <button
                      id={`row-${i.id}`}
                      type="button"
                      aria-current={active ? "true" : undefined}
                      onClick={() => select(i.id)}
                      className={cn(
                        "flex w-full gap-3 px-3.5 py-3 text-left transition-colors focus-visible:bg-muted focus-visible:outline-none",
                        active ? "bg-brand-soft/70" : "hover:bg-muted/50",
                      )}
                    >
                      <span
                        className={cn("mt-1.5 size-2 shrink-0 rounded-full", STATUS[i.status].dot)}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="font-mono">#{i.number}</span>
                          <span className="inline-flex items-center gap-1">
                            <K.icon className="size-3" aria-hidden />
                            {K.label}
                          </span>
                          {i.anchor?.pin.wPct !== undefined && (
                            <span className="inline-flex items-center gap-1">
                              <SquareDashed className="size-3" aria-hidden />
                              Region
                            </span>
                          )}
                          <span className="ml-auto">{ago(i.createdAt)}</span>
                        </span>
                        <span className="mt-0.5 block truncate text-sm font-medium">{i.title ?? i.body}</span>
                        <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                          {i.reporter.name ?? "Guest"}
                          {i.replies.length > 0 && (
                            <span className="inline-flex items-center gap-0.5">
                              <MessageSquare className="size-3" aria-hidden />
                              {i.replies.length}
                            </span>
                          )}
                          {i.assets.some((a) => a.kind === "screenshot") && (
                            <ImageIcon className="size-3" aria-label="Has a screenshot" />
                          )}
                          <span className="sr-only">, {STATUS[i.status].label}</span>
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-label="Details" className="min-w-0">
          {selected ? <Detail item={selected} /> : load.state === "ready" ? <NoSelection /> : null}
        </section>
      </div>
    </div>
  );
}

function NoSelection() {
  return (
    <div className="grid h-full min-h-64 place-items-center rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
      Select an item to see the details.
    </div>
  );
}

function Detail({ item }: { item: Item }) {
  const shot = item.assets.find((a) => a.kind === "screenshot");
  const attachments = item.assets.filter((a) => a.kind === "attachment");
  const env = item.environment;
  const region = item.anchor?.pin.wPct !== undefined;
  return (
    <article className="rounded-2xl border bg-card shadow-xs lg:sticky lg:top-20">
      <header className="border-b p-5">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-medium">
            <span className={cn("size-1.5 rounded-full", STATUS[item.status].dot)} aria-hidden />
            {STATUS[item.status].label}
          </span>
          <span className="rounded-full border px-2 py-0.5 text-muted-foreground">
            {KIND[item.kind].label}
          </span>
          <span className="rounded-full border px-2 py-0.5 text-muted-foreground">
            {PRIORITY[item.priority]}
          </span>
          {item.seeded && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">Example</span>
          )}
        </div>
        <h2 className="mt-3 text-xl font-semibold tracking-tight">
          <span className="font-mono text-muted-foreground">#{item.number}</span> {item.title ?? "Comment"}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {item.reporter.name ?? "Guest"} · {ago(item.createdAt)} · on{" "}
          <span className="font-mono text-xs">{item.page.path}</span>
        </p>
      </header>
      <div className="space-y-6 p-5">
        <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{item.body}</p>

        {shot && (
          <figure>
            {/* eslint-disable-next-line @next/next/no-img-element -- a per-visitor capture from the in-memory demo API; nothing to optimise */}
            <img
              src={`/demo-api/assets/${shot.id}`}
              alt="Screenshot attached to the report"
              className="w-full rounded-lg border bg-muted object-contain"
            />
          </figure>
        )}

        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <Meta label="Pinned to">
            {item.anchor ? (
              <span className="font-mono text-xs break-all">
                {region ? "Region on " : "Point on "}
                {item.anchor.css}
              </span>
            ) : (
              "The page"
            )}
          </Meta>
          <Meta label="Browser">
            {env
              ? `${env.browser ?? "Unknown"} · ${env.os ?? "Unknown"} · ${env.viewport.w}×${env.viewport.h}`
              : "—"}
          </Meta>
          <Meta label="Console">
            {item.diagnostics.console} {item.diagnostics.console === 1 ? "entry" : "entries"}
          </Meta>
          <Meta label="Failed requests">{item.diagnostics.network}</Meta>
        </dl>

        {(item.diagnostics.errors.length > 0 || item.diagnostics.failed.length > 0) && (
          <div>
            <h3 className="text-sm font-semibold">Diagnostics</h3>
            <ul className="mt-2 space-y-1 font-mono text-xs">
              {item.diagnostics.errors.map((e) => (
                <li
                  key={e}
                  className="rounded bg-destructive/10 px-2 py-1 break-all text-red-700 dark:text-red-300"
                >
                  {e}
                </li>
              ))}
              {item.diagnostics.failed.map((f) => (
                <li key={f} className="rounded bg-muted px-2 py-1 break-all">
                  {f}
                </li>
              ))}
            </ul>
          </div>
        )}

        {attachments.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold">Attachments</h3>
            <ul className="mt-2 space-y-1 text-sm">
              {attachments.map((a) => (
                <li key={a.id}>
                  <a href={`/demo-api/assets/${a.id}`} className="underline underline-offset-4">
                    {a.name ?? "attachment"}
                  </a>{" "}
                  <span className="text-xs text-muted-foreground">{Math.round(a.bytes / 1024)} KB</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <h3 className="text-sm font-semibold">Thread</h3>
          {item.replies.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              No replies yet — reply from the pin on the page.
            </p>
          ) : (
            <ol className="mt-3 space-y-3">
              {item.replies.map((r) => (
                <li key={r.id} className="flex gap-2.5">
                  <span
                    className={cn(
                      "grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold",
                      r.team ? "bg-brand text-brand-foreground" : "bg-muted text-foreground",
                    )}
                    aria-hidden
                  >
                    {initials(r.authorName)}
                  </span>
                  <div className="min-w-0 rounded-lg bg-muted/50 px-3 py-2 text-sm">
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{r.authorName ?? "Guest"}</span>
                      {r.team && (
                        <span className="bg-brand-soft text-brand ml-1.5 rounded px-1 text-[10px] font-medium">
                          Team
                        </span>
                      )}
                      {" · "}
                      {ago(r.createdAt)}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap">{r.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t pt-5">
          <Link
            href={`/demo?pinwren=${encodeURIComponent(item.id)}`}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-sm font-medium hover:bg-muted"
          >
            <ExternalLink className="size-3.5" aria-hidden />
            Open on page
          </Link>
          <p className="text-xs text-muted-foreground">
            In your own instance you’d change the status, assign, reply internally or send it to GitHub here.
          </p>
        </div>
      </div>
    </article>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
