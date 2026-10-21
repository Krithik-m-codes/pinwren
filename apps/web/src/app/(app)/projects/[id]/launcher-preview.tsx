"use client";

import type { WidgetConfig } from "@pinwren/core";
import { Bug, EyeOff, MapPin, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export const LAUNCHER_ICONS = { pin: MapPin, comment: MessageCircle, bug: Bug } as const;

/** Readable text colour on the accent (WCAG relative luminance). */
export function onAccent(hex: string): string {
  let h = hex.replace("#", "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  if (h.length !== 6) return "#fff";
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = Number.parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? "#111" : "#fff";
}

const DEFAULT_CONSENT =
  "Your comment, the page address, browser details and any screenshot are sent to the site owner.";

/** The launcher as the widget draws it, on a mock page. Offsets are scaled to the preview frame. */
export function LauncherPreview({ config }: { config: WidgetConfig }) {
  const { launcher, consent } = config;
  const Icon = LAUNCHER_ICONS[launcher.icon];
  const [v, hz] = launcher.position.split("-") as ["top" | "bottom", "left" | "right"];
  const scale = 0.5;
  const pill = launcher.shape === "pill" && !!launcher.label;
  const place: React.CSSProperties = {
    [v]: Math.round(launcher.offset.y * scale) + 6,
    [hz]: Math.round(launcher.offset.x * scale) + 6,
  };
  const modes = [config.modes.comment && "Comment", config.modes.bug && "Report a bug"].filter(Boolean);

  return (
    <div className="overflow-hidden rounded-xl border bg-background shadow-sm" data-testid="launcher-preview">
      <div className="flex items-center gap-1.5 border-b bg-muted/60 px-3 py-2">
        <span className="size-2.5 rounded-full bg-foreground/15" />
        <span className="size-2.5 rounded-full bg-foreground/15" />
        <span className="size-2.5 rounded-full bg-foreground/15" />
        <span className="ml-2 h-4 flex-1 truncate rounded bg-background/80 px-2 font-mono text-[10px] leading-4 text-muted-foreground">
          your-site.com
        </span>
      </div>
      <div className="relative h-80 p-4">
        <div className="space-y-2.5" aria-hidden>
          <div className="flex items-center justify-between">
            <div className="h-3 w-20 rounded bg-muted" />
            <div className="flex gap-2">
              <div className="h-2 w-8 rounded bg-muted" />
              <div className="h-2 w-8 rounded bg-muted" />
              <div className="h-2 w-8 rounded bg-muted" />
            </div>
          </div>
          <div className="h-20 rounded-md bg-muted/70" />
          <div className="grid grid-cols-3 gap-2">
            <div className="h-14 rounded bg-muted/60" />
            <div className="h-14 rounded bg-muted/60" />
            <div className="h-14 rounded bg-muted/60" />
          </div>
          <div className="h-2 w-2/3 rounded bg-muted" />
          <div className="h-2 w-1/2 rounded bg-muted" />
        </div>

        {consent.enabled && (
          <div className="absolute inset-x-6 top-1/2 -translate-y-1/2 rounded-lg border bg-popover p-3 text-xs shadow-md">
            <p className="font-medium">Before you send</p>
            <p className="mt-1 line-clamp-3 text-muted-foreground">{consent.text || DEFAULT_CONSENT}</p>
            {consent.privacyUrl && (
              <p className="mt-1 truncate underline underline-offset-2" style={{ color: launcher.accent }}>
                Privacy policy
              </p>
            )}
          </div>
        )}

        <div className="absolute" style={place}>
          <div className="relative">
            {launcher.tooltip && !launcher.hidden && (
              <span
                className={cn(
                  "pointer-events-none absolute rounded-md bg-foreground px-2 py-1 text-[11px] whitespace-nowrap text-background shadow",
                  v === "bottom" ? "bottom-full mb-2" : "top-full mt-2",
                  hz === "right" ? "right-0" : "left-0",
                )}
              >
                {launcher.tooltip}
              </span>
            )}
            <span
              role="img"
              aria-label={
                launcher.hidden ? "Launcher hidden" : `Launcher: ${pill ? launcher.label : launcher.icon}`
              }
              className={cn(
                "flex items-center justify-center gap-1.5 shadow-lg ring-1 ring-black/10 transition-all duration-150",
                pill ? "h-9 rounded-full px-3.5 text-[13px] font-medium" : "size-11 rounded-full",
                launcher.hidden &&
                  "opacity-25 outline-2 outline-offset-2 outline-foreground/40 outline-dashed",
              )}
              style={{ background: launcher.accent, color: onAccent(launcher.accent) }}
            >
              <Icon className={pill ? "size-4" : "size-5"} />
              {pill && <span>{launcher.label}</span>}
            </span>
          </div>
        </div>
        <p className="absolute inset-x-0 bottom-2 flex items-center justify-center gap-1.5 px-4 text-center text-[11px] text-muted-foreground">
          {launcher.hidden ? (
            <>
              <EyeOff className="size-3 shrink-0" /> Hidden — opened with a shortcut or{" "}
              <code className="font-mono">Pinwren.open()</code>
            </>
          ) : modes.length ? (
            <>Menu: {modes.join(" · ")}</>
          ) : (
            <>No modes on — visitors can only read pins</>
          )}
        </p>
      </div>
    </div>
  );
}
