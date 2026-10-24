"use client";

import type { AnnotationLayer, FeedbackStatus } from "@pinwren/core";
import { isClosedStatus } from "@pinwren/core";
import { PenLine } from "lucide-react";
import { AnnotationOverlay } from "@/components/annotation-layer";
import { Toggle } from "@/components/ui/toggle";
import type { Placement } from "@/lib/geometry";
import { cn } from "@/lib/utils";

export type Marker = Placement & {
  id: string;
  label: string;
  status?: FeedbackStatus;
  active?: boolean;
  onSelect?: () => void;
  title?: string;
};

/**
 * "Annotations" on/off for a screenshot that carries the reporter's vector shapes (wave-5 contract §2): off
 * shows what was underneath. A view setting, so it stays available to viewers.
 */
export function AnnotationsToggle({
  layer,
  pressed,
  onPressedChange,
}: {
  layer: AnnotationLayer | null | undefined;
  pressed: boolean;
  onPressedChange: (on: boolean) => void;
}) {
  if (!layer?.shapes.length) return null;
  return (
    <Toggle
      size="sm"
      pressed={pressed}
      onPressedChange={onPressedChange}
      aria-label={pressed ? "Hide annotations" : "Show annotations"}
      title={pressed ? "Hide the reporter's annotations" : "Show the reporter's annotations"}
      data-testid="annotations-toggle"
    >
      <PenLine /> Annotations
    </Toggle>
  );
}

/**
 * A screenshot with numbered pins and region rectangles at their captured positions (blueprint 06
 * §3.4). Markers are buttons, so the overlay is reachable by keyboard. `annotations` (the reporter's vector
 * shapes, wave-5 §2) are drawn over the image while `showAnnotations` is on.
 */
export function CaptureView({
  src,
  alt,
  markers = [],
  className,
  showMarkers = true,
  decorative = false,
  annotations,
  showAnnotations = true,
}: {
  src: string;
  alt: string;
  markers?: Marker[];
  className?: string;
  showMarkers?: boolean;
  /** Markers drawn but not interactive (e.g. the capture itself is a link). */
  decorative?: boolean;
  annotations?: AnnotationLayer | null | undefined;
  showAnnotations?: boolean;
}) {
  const Tag = decorative ? "span" : "button";
  return (
    <div className={cn("relative overflow-hidden rounded-lg border bg-muted/40", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- session-authenticated asset; next/image would fetch it without the cookie */}
      <img src={src} alt={alt} className="block w-full select-none" draggable={false} />
      {annotations && showAnnotations && <AnnotationOverlay layer={annotations} />}
      {showMarkers &&
        markers.map((m) => {
          const closed = m.status ? isClosedStatus(m.status) : false;
          const tone = m.active
            ? "bg-primary text-primary-foreground ring-primary"
            : closed
              ? "bg-emerald-600 text-white ring-emerald-600"
              : "bg-blue-600 text-white ring-blue-600";
          if (m.region) {
            return (
              <Tag
                key={m.id}
                type={decorative ? undefined : "button"}
                onClick={m.onSelect}
                title={m.title}
                aria-label={decorative ? undefined : (m.title ?? `Feedback ${m.label}`)}
                aria-hidden={decorative || undefined}
                data-marker={m.id}
                className={cn(
                  "group absolute rounded-[3px] border-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  m.active
                    ? "border-primary bg-primary/15"
                    : closed
                      ? "border-emerald-600/80 bg-emerald-500/10"
                      : "border-blue-600/80 bg-blue-500/10 hover:bg-blue-500/20",
                )}
                style={{
                  left: `${m.left}%`,
                  top: `${m.top}%`,
                  width: `${Math.max(m.width ?? 0, 0.5)}%`,
                  height: `${Math.max(m.height ?? 0, 0.5)}%`,
                }}
              >
                <span
                  className={cn(
                    "absolute -top-2.5 -left-2.5 grid h-5 min-w-5 place-items-center rounded-full px-1 text-[10px] font-semibold tabular-nums shadow ring-2 ring-background",
                    tone,
                  )}
                >
                  {m.label}
                </span>
              </Tag>
            );
          }
          return (
            <Tag
              key={m.id}
              type={decorative ? undefined : "button"}
              onClick={m.onSelect}
              title={m.title}
              aria-label={decorative ? undefined : (m.title ?? `Feedback ${m.label}`)}
              aria-hidden={decorative || undefined}
              data-marker={m.id}
              className={cn(
                "absolute grid h-6 min-w-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full rounded-bl-none px-1 text-[11px] font-semibold tabular-nums shadow-md ring-2 ring-background transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                tone,
                m.active && "scale-110",
              )}
              style={{ left: `${m.left}%`, top: `${m.top}%` }}
            >
              {m.label}
            </Tag>
          );
        })}
    </div>
  );
}
