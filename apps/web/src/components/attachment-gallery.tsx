"use client";

import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  ImageOff,
  Maximize2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes } from "@/lib/api";
import { useT } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { type Bounds, clampView, fitScale, type View, zoomAt } from "@/lib/zoom-view";

export type GalleryItem = {
  id: string;
  /** Shown name; callers pass a fallback for unnamed files. */
  name: string;
  contentType: string;
  bytes: number;
  /** Where the file is served from (session-authenticated, so a plain `<img>` and link, not next/image). */
  src: string;
};

const isImage = (i: GalleryItem) => i.contentType.startsWith("image/");
const kindOf = (i: GalleryItem) => i.contentType.split("/")[1]?.toUpperCase() ?? "";

/**
 * Attachments as a grid of fixed-ratio thumbnails (no layout shift while they load, a skeleton and an error
 * state instead of a broken image). An image opens in a lightbox with zoom, pan and next / previous; other
 * files open in a new tab.
 */
export function AttachmentGallery({ items }: { items: GalleryItem[] }) {
  const t = useT();
  const images = items.filter(isImage);
  const [open, setOpen] = useState<number | null>(null);
  const current = open === null ? undefined : images[open];
  return (
    <>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <li key={item.id} className="group min-w-0 space-y-1.5">
            {isImage(item) ? (
              <ImageCard item={item} onOpen={() => setOpen(images.indexOf(item))} />
            ) : (
              <a
                href={item.src}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t("gallery.open", { name: item.name })}
                className="grid aspect-[16/10] w-full place-items-center rounded-lg border bg-muted text-muted-foreground transition-colors outline-none hover:bg-muted/70 focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <span className="grid justify-items-center gap-1">
                  <FileText className="size-7" />
                  <span className="text-xs font-medium">{kindOf(item)}</span>
                </span>
              </a>
            )}
            <div className="flex items-center gap-1">
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium" title={item.name}>
                  {item.name}
                </span>
                <span className="block text-xs text-muted-foreground tabular-nums">
                  {kindOf(item)} · {formatBytes(item.bytes)}
                </span>
              </div>
              <a
                href={item.src}
                download={item.name}
                aria-label={`${t("inbox1.download")}: ${item.name}`}
                title={t("inbox1.download")}
                className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
              >
                <Download />
              </a>
            </div>
          </li>
        ))}
      </ul>
      <Dialog open={current !== undefined} onOpenChange={(o) => !o && setOpen(null)}>
        {current && open !== null && (
          <DialogContent className="h-[92vh] w-[96vw] max-w-none grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-none">
            <Lightbox
              key={current.id}
              item={current}
              position={open}
              count={images.length}
              onStep={(d) => setOpen((open + d + images.length) % images.length)}
            />
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}

function ImageCard({ item, onOpen }: { item: GalleryItem; onOpen: () => void }) {
  const t = useT();
  const [state, setState] = useState<"loading" | "loaded" | "failed">("loading");
  const [tall, setTall] = useState(false);
  const measure = (img: HTMLImageElement) => {
    setTall(img.naturalHeight > img.naturalWidth * 1.1);
    setState("loaded");
  };
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t("gallery.open", { name: item.name })}
      className="relative block aspect-[16/10] w-full cursor-zoom-in overflow-hidden rounded-lg border bg-muted outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {state === "loading" && <Skeleton className="absolute inset-0 rounded-none" />}
      {state === "failed" ? (
        <span className="absolute inset-0 grid place-content-center justify-items-center gap-1 p-2 text-center text-xs text-muted-foreground">
          <ImageOff className="size-5" />
          {t("gallery.failed")}
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- session-authenticated asset; next/image would fetch it without the cookie
        <img
          // An image that finished (or failed) before React attached its handlers still gets its state.
          ref={(img) => {
            if (!img?.complete || state !== "loading") return;
            if (img.naturalWidth > 0) measure(img);
            else setState("failed");
          }}
          src={item.src}
          alt=""
          decoding="async"
          loading="lazy"
          draggable={false}
          onLoad={(e) => measure(e.currentTarget)}
          onError={() => setState("failed")}
          className={cn(
            "absolute inset-0 size-full transition-opacity duration-200",
            state === "loaded" ? "opacity-100" : "opacity-0",
            tall ? "bg-muted object-contain" : "object-cover object-top",
          )}
        />
      )}
    </button>
  );
}

const STEP = 1.4;

function Lightbox({
  item,
  position,
  count,
  onStep,
}: {
  item: GalleryItem;
  position: number;
  count: number;
  onStep: (d: number) => void;
}) {
  const t = useT();
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [stage, setStage] = useState({ sw: 0, sh: 0 });
  const [natural, setNatural] = useState({ iw: 0, ih: 0 });
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  // What the person set by zooming or panning; null follows "fit to window" as the window changes.
  const [custom, setCustom] = useState<View | null>(null);
  const [panning, setPanning] = useState(false);

  const bounds: Bounds = { ...stage, ...natural };
  const fit = fitScale(bounds);
  const view = clampView(custom ?? { s: fit, x: 0, y: 0 }, bounds);
  const zoomed = view.s > fit + 0.001;
  const ready = status === "ready" && stage.sw > 0;

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measureStage = () => setStage({ sw: el.clientWidth, sh: el.clientHeight });
    measureStage();
    const ro = new ResizeObserver(measureStage);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const zoomTo = (next: number, cx = stage.sw / 2, cy = stage.sh / 2) => {
    if (ready) setCustom(zoomAt(view, next, cx, cy, bounds));
  };
  const panBy = (dx: number, dy: number) => {
    if (ready) setCustom(clampView({ ...view, x: view.x + dx, y: view.y + dy }, bounds));
  };
  const onWheel = useEffectEvent((e: WheelEvent) => {
    const r = stageRef.current?.getBoundingClientRect();
    if (!r) return;
    zoomTo(view.s * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
  });
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    // Not React's onWheel: that one is passive, and a pinch (Ctrl+wheel) must not zoom the whole page.
    const on = (e: WheelEvent) => {
      e.preventDefault();
      onWheel(e);
    };
    el.addEventListener("wheel", on, { passive: false });
    return () => el.removeEventListener("wheel", on);
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const act: Record<string, () => void> = {
      "+": () => zoomTo(view.s * STEP),
      "=": () => zoomTo(view.s * STEP),
      "-": () => zoomTo(view.s / STEP),
      "0": () => setCustom(null),
      "1": () => zoomTo(1),
      ArrowLeft: () => (zoomed ? panBy(60, 0) : onStep(-1)),
      ArrowRight: () => (zoomed ? panBy(-60, 0) : onStep(1)),
      ArrowUp: () => zoomed && panBy(0, 60),
      ArrowDown: () => zoomed && panBy(0, -60),
    };
    const run = act[e.key];
    if (!run || (count < 2 && (e.key === "ArrowLeft" || e.key === "ArrowRight") && !zoomed)) return;
    e.preventDefault();
    run();
  };

  const icon = (label: string, onClick: () => void, children: React.ReactNode, disabled = !ready) => (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );

  return (
    <>
      <div className="flex flex-wrap items-center gap-1 border-b py-2 pr-12 pl-4">
        <div className="min-w-0 flex-1">
          <DialogTitle className="truncate text-sm font-medium">{item.name}</DialogTitle>
          <p className="truncate text-xs text-muted-foreground tabular-nums">
            {count > 1 && `${t("gallery.position", { i: position + 1, n: count })} · `}
            {kindOf(item)} · {formatBytes(item.bytes)}
          </p>
        </div>
        {icon(t("gallery.zoomOut"), () => zoomTo(view.s / STEP), <ZoomOut />)}
        <span aria-live="polite" className="min-w-11 text-center text-xs text-muted-foreground tabular-nums">
          {ready ? `${Math.round(view.s * 100)}%` : ""}
        </span>
        {icon(t("gallery.zoomIn"), () => zoomTo(view.s * STEP), <ZoomIn />)}
        {icon(t("gallery.fit"), () => setCustom(null), <Maximize2 />)}
        {icon(
          t("gallery.actual"),
          () => zoomTo(1),
          <span className="text-[0.6875rem] font-semibold">1:1</span>,
        )}
        <a
          href={item.src}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t("gallery.openNew")}
          title={t("gallery.openNew")}
          className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
        >
          <ExternalLink />
        </a>
        <a
          href={item.src}
          download={item.name}
          aria-label={t("inbox1.download")}
          title={t("inbox1.download")}
          className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
        >
          <Download />
        </a>
      </div>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- a zoomable viewport: keys and pointer drag are its whole interface */}
      <div
        ref={stageRef}
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard users zoom and pan from here
        tabIndex={0}
        role="application"
        aria-label={item.name}
        onKeyDown={onKeyDown}
        onDoubleClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          if (zoomed) setCustom(null);
          else zoomTo(Math.max(1, fit * 2), e.clientX - r.left, e.clientY - r.top);
        }}
        onPointerDown={(e) => {
          // Buttons on the stage (previous / next) keep their own clicks.
          if (e.button !== 0 || !ready || (e.target as HTMLElement).closest("button")) return;
          drag.current = { x: e.clientX, y: e.clientY };
          e.currentTarget.setPointerCapture(e.pointerId);
          setPanning(true);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          panBy(e.clientX - drag.current.x, e.clientY - drag.current.y);
          drag.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={() => {
          drag.current = null;
          setPanning(false);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setPanning(false);
        }}
        className={cn(
          "relative touch-none overflow-hidden bg-muted/40 outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset",
          zoomed ? (panning ? "cursor-grabbing" : "cursor-grab") : "cursor-default",
        )}
      >
        {status === "loading" && <Skeleton className="absolute inset-0 rounded-none" />}
        {status === "failed" ? (
          <div className="absolute inset-0 grid place-content-center justify-items-center gap-2 text-sm text-muted-foreground">
            <ImageOff className="size-6" />
            {t("gallery.failed")}
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- session-authenticated asset; next/image would fetch it without the cookie
          <img
            ref={(img) => {
              if (!img?.complete || status !== "loading") return;
              if (img.naturalWidth > 0) {
                setNatural({ iw: img.naturalWidth, ih: img.naturalHeight });
                setStatus("ready");
              } else setStatus("failed");
            }}
            src={item.src}
            alt=""
            draggable={false}
            onLoad={(e) => {
              setNatural({ iw: e.currentTarget.naturalWidth, ih: e.currentTarget.naturalHeight });
              setStatus("ready");
            }}
            onError={() => setStatus("failed")}
            style={{
              width: natural.iw || undefined,
              height: natural.ih || undefined,
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`,
            }}
            className={cn(
              "absolute top-0 left-0 max-w-none origin-top-left will-change-transform",
              ready ? "visible" : "invisible",
            )}
          />
        )}
        {count > 1 && (
          <>
            <Button
              variant="secondary"
              size="icon"
              aria-label={t("gallery.prev")}
              className="absolute top-1/2 left-3 -translate-y-1/2 rounded-full shadow"
              onClick={() => onStep(-1)}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="secondary"
              size="icon"
              aria-label={t("gallery.next")}
              className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full shadow"
              onClick={() => onStep(1)}
            >
              <ChevronRight />
            </Button>
          </>
        )}
      </div>
    </>
  );
}
