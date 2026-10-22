"use client";

import "rrweb-player/dist/style.css";
import { Film, TriangleAlert } from "lucide-react";
import { useEffect, useImperativeHandle, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { type Asset, assetUrl, type FeedbackDetail } from "@/lib/api";
import { cn } from "@/lib/utils";

export type ReplayHandle = { seekTo: (epochMs: number) => void };

type RrwebEvent = { type: number; timestamp: number; data?: { width?: number; height?: number } };
type Player = {
  goto: (offset: number, play?: boolean) => void;
  addEventListener: (event: string, handler: (params: unknown) => unknown) => void;
  $destroy: () => void;
};
type Marker = { at: number; offset: number; kind: "error" | "warn" | "network"; label: string };

const META_EVENT = 4;
const CONTROLLER_PX = 80;

/** A replay asset is gzip of a JSON array of rrweb 2.x events (wave-4 contract §3). */
export async function loadReplayEvents(res: Response): Promise<RrwebEvent[]> {
  const bytes = new Uint8Array(await res.arrayBuffer());
  const gzipped = bytes[0] === 0x1f && bytes[1] === 0x8b;
  const text = gzipped
    ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).text()
    : new TextDecoder().decode(bytes);
  const events: unknown = JSON.parse(text);
  if (!Array.isArray(events)) throw new Error("Not a replay");
  return (events as RrwebEvent[])
    .filter((e) => typeof e.timestamp === "number")
    .sort((a, b) => a.timestamp - b.timestamp);
}

/** Console errors/warnings and failed requests as points on the replay's timeline. */
export function timelineMarkers(
  diagnostics: FeedbackDetail["diagnostics"],
  start: number,
  end: number,
): Marker[] {
  const out: Marker[] = [];
  for (const c of diagnostics?.console ?? []) {
    if (c.level !== "error" && c.level !== "warn") continue;
    if (c.at < start || c.at > end) continue;
    out.push({ at: c.at, offset: c.at - start, kind: c.level, label: c.message.slice(0, 120) });
  }
  for (const n of diagnostics?.network ?? []) {
    if (n.at < start || n.at > end) continue;
    out.push({
      at: n.at,
      offset: n.at - start,
      kind: "network",
      label: `${n.status || "ERR"} ${n.method} ${n.url}`.slice(0, 120),
    });
  }
  return out.sort((a, b) => a.offset - b.offset);
}

/**
 * Session replay (F-007): rrweb-player 2.x, loaded on demand, with console and network markers on a
 * timeline under it. The time it shows is reported up so the Console / Network tabs highlight what
 * happened then; clicking an entry there seeks the player (`handle`).
 */
export function ReplayViewer({
  asset,
  diagnostics,
  handle,
  onTime,
}: {
  asset: Asset;
  diagnostics: FeedbackDetail["diagnostics"];
  handle: React.RefObject<ReplayHandle | null>;
  onTime: (epochMs: number | null) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const player = useRef<Player | null>(null);
  const [state, setState] = useState<
    { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; start: number; end: number }
  >({ kind: "loading" });
  const [offset, setOffset] = useState(0);
  const report = useRef(onTime);
  useEffect(() => {
    report.current = onTime;
  });

  useImperativeHandle(handle, () => ({
    seekTo: (epochMs: number) => {
      if (state.kind !== "ready" || !player.current) return;
      const to = Math.max(0, Math.min(epochMs - state.start, state.end - state.start));
      player.current.goto(to, false);
      setOffset(to);
      report.current(state.start + to);
    },
  }));

  useEffect(() => {
    const target = box.current;
    if (!target) return;
    // Mutated by the cleanup while the async load is in flight.
    const run = { cancelled: false };
    let instance: Player | null = null;
    (async () => {
      const res = await fetch(assetUrl(asset.id), { credentials: "same-origin" });
      if (!res.ok) throw new Error(`The replay couldn't be loaded (HTTP ${res.status})`);
      const events = await loadReplayEvents(res);
      if (events.length < 2) throw new Error("This replay has no recorded frames.");
      const { default: Player } = await import("rrweb-player");
      if (run.cancelled) return;
      const meta = events.find((e) => e.type === META_EVENT)?.data;
      // The figure is laid out while the replay loads (the box itself is still empty), so it has the width.
      const width = Math.max(240, target.parentElement?.clientWidth ?? target.clientWidth);
      const ratio = meta?.width && meta.height ? meta.height / meta.width : 0.625;
      const height = Math.min(Math.round(width * ratio), 520);
      instance = new Player({
        target,
        props: {
          events: events as never,
          width,
          height: height + CONTROLLER_PX,
          autoPlay: false,
          skipInactive: true,
          showController: true,
        },
      }) as unknown as Player;
      player.current = instance;
      const start = events[0]?.timestamp ?? 0;
      const end = events.at(-1)?.timestamp ?? start;
      instance.addEventListener("ui-update-current-time", (p) => {
        const t = (p as { payload?: number }).payload ?? 0;
        setOffset(t);
        report.current(start + t);
      });
      setState({ kind: "ready", start, end });
      report.current(start);
    })().catch((e: unknown) => {
      if (!run.cancelled)
        setState({
          kind: "error",
          message: e instanceof Error ? e.message : "The replay couldn't be played.",
        });
    });
    return () => {
      run.cancelled = true;
      instance?.$destroy();
      player.current = null;
      report.current(null);
      target.replaceChildren();
    };
  }, [asset.id]);

  const durationMs = typeof asset.meta?.durationMs === "number" ? asset.meta.durationMs : null;
  const markers = state.kind === "ready" ? timelineMarkers(diagnostics, state.start, state.end) : [];
  const total = state.kind === "ready" ? Math.max(1, state.end - state.start) : 1;

  return (
    <figure className="space-y-2" data-testid="replay">
      {state.kind === "loading" && <Skeleton className="aspect-[16/10] w-full rounded-lg" />}
      {state.kind === "error" && (
        <div
          className="grid aspect-[16/10] place-items-center rounded-lg border border-dashed p-6 text-center"
          role="alert"
        >
          <div>
            <TriangleAlert className="mx-auto mb-2 size-5 text-muted-foreground" />
            <p className="text-sm">{state.message}</p>
          </div>
        </div>
      )}
      <div
        ref={box}
        className={cn(
          "pinwren-replay overflow-hidden rounded-lg border bg-muted/30",
          state.kind !== "ready" && "h-0 border-0",
        )}
      />
      {state.kind === "ready" && markers.length > 0 && (
        <div className="space-y-1">
          <div className="relative h-5 rounded bg-muted" aria-label="Replay timeline" role="group">
            <span
              aria-hidden
              className="absolute top-0 bottom-0 w-px bg-foreground/60"
              style={{ left: `${(offset / total) * 100}%` }}
            />
            {markers.map((m) => (
              <button
                type="button"
                key={`${m.kind}-${m.at}-${m.label}`}
                title={m.label}
                aria-label={`Jump to ${m.kind === "network" ? "request" : m.kind}: ${m.label}`}
                data-testid="replay-marker"
                onClick={() => handle.current?.seekTo(m.at)}
                className={cn(
                  "absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-background focus-visible:outline-2 focus-visible:outline-ring",
                  m.kind === "error" && "bg-destructive",
                  m.kind === "warn" && "bg-amber-500",
                  m.kind === "network" && "bg-violet-500",
                )}
                style={{ left: `${(m.offset / total) * 100}%` }}
              />
            ))}
          </div>
          <p className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-full bg-destructive" /> errors
            </span>
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-full bg-amber-500" /> warnings
            </span>
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-full bg-violet-500" /> failed requests
            </span>
          </p>
        </div>
      )}
      <figcaption className="flex items-center gap-2 text-xs text-muted-foreground">
        <Film className="size-3.5" /> Session replay
        {durationMs !== null && <span className="tabular-nums">· {Math.round(durationMs / 1000)} s</span>}
        <span>· inputs are masked when recorded</span>
      </figcaption>
    </figure>
  );
}
