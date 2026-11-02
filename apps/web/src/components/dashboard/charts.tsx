"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/utils";

// Dependency-free SVG charts for the dashboards (no chart library: three shapes cover every widget).
// Colours come from Tailwind text classes through `currentColor`, so dark mode follows the theme, and
// every chart has a text equivalent (aria-label, a title per mark, or a visible legend/value).

export type Series = { key: string; label: string; className: string; values: number[] };

const W = 320;
const H = 100;
const PAD = { t: 6, r: 4, b: 14, l: 4 };

function path(values: number[], max: number, close = false) {
  const n = values.length;
  const x = (i: number) => PAD.l + (n <= 1 ? 0 : (i / (n - 1)) * (W - PAD.l - PAD.r));
  const y = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b);
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  return close ? `${line} L${x(n - 1).toFixed(1)} ${H - PAD.b} L${x(0).toFixed(1)} ${H - PAD.b} Z` : line;
}

/** Lines over days with a soft fill under the first series; hover or focus a day to read its values. */
export function AreaChart({
  labels,
  series,
  formatLabel,
  summary,
  className,
}: {
  labels: string[];
  series: Series[];
  formatLabel: (label: string) => string;
  summary: string;
  className?: string;
}) {
  const id = useId();
  const [at, setAt] = useState<number | null>(null);
  const n = labels.length;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const step = n <= 1 ? 0 : (W - PAD.l - PAD.r) / (n - 1);
  const x = (i: number) => PAD.l + i * step;
  return (
    <div className={cn("relative flex min-h-0 flex-1 flex-col", className)}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={summary}
        className="h-full min-h-0 w-full flex-1 overflow-visible"
        onPointerLeave={() => setAt(null)}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const f = (e.clientX - r.left) / r.width;
          setAt(Math.min(n - 1, Math.max(0, Math.round(((f * W - PAD.l) / (W - PAD.l - PAD.r)) * (n - 1)))));
        }}
      >
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`${id}-${s.key}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="currentColor" stopOpacity="0.28" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {[0.5, 1].map((f) => (
          <line
            key={f}
            x1={PAD.l}
            x2={W - PAD.r}
            y1={PAD.t + (1 - f) * (H - PAD.t - PAD.b)}
            y2={PAD.t + (1 - f) * (H - PAD.t - PAD.b)}
            className="stroke-border"
            strokeDasharray="2 3"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {series.map((s) => (
          <g key={s.key} className={s.className}>
            <path d={path(s.values, max, true)} fill={`url(#${id}-${s.key})`} />
            <path
              d={path(s.values, max)}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ))}
        {at !== null && (
          <line
            x1={x(at)}
            x2={x(at)}
            y1={PAD.t}
            y2={H - PAD.b}
            className="stroke-foreground/30"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <div className="mt-0.5 flex items-center justify-between text-[10px] text-muted-foreground tabular-nums">
        <span>{n ? formatLabel(labels[0] ?? "") : ""}</span>
        <span>{n ? formatLabel(labels[n - 1] ?? "") : ""}</span>
      </div>
      {at !== null && (
        <div
          role="status"
          className="pointer-events-none absolute top-0 z-10 rounded-md bg-popover px-2 py-1 text-[11px] text-popover-foreground shadow ring-1 ring-foreground/10"
          style={{ left: `${(x(at) / W) * 100}%`, transform: `translateX(${at > n / 2 ? "-105%" : "5%"})` }}
        >
          <div className="font-medium">{formatLabel(labels[at] ?? "")}</div>
          {series.map((s) => (
            <div key={s.key} className="flex items-center gap-1.5">
              <span className={cn("size-1.5 rounded-full bg-current", s.className)} />
              {s.label}: <span className="tabular-nums">{s.values[at] ?? 0}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export type Slice = { key: string; label: string; value: number; className: string };

/** A ring split by share with the total in the middle; the legend beside it carries the numbers. */
export function Donut({
  slices,
  total,
  centre,
  summary,
}: {
  slices: Slice[];
  total: number;
  centre: string;
  summary: string;
}) {
  const r = 15.9155; // circumference 100: dash lengths are percentages
  let offset = 25;
  return (
    <div className="flex min-h-0 flex-1 items-center gap-3">
      <div className="relative aspect-square h-full max-h-28 min-h-16 shrink-0">
        <svg viewBox="0 0 40 40" role="img" aria-label={summary} className="size-full -rotate-90">
          <circle cx="20" cy="20" r={r} fill="none" strokeWidth="5" className="stroke-muted" />
          {total > 0 &&
            slices
              .filter((s) => s.value > 0)
              .map((s) => {
                const share = (s.value / total) * 100;
                const el = (
                  <circle
                    key={s.key}
                    cx="20"
                    cy="20"
                    r={r}
                    fill="none"
                    strokeWidth="5"
                    stroke="currentColor"
                    className={s.className}
                    strokeDasharray={`${Math.max(share - 0.6, 0.1)} ${100 - Math.max(share - 0.6, 0.1)}`}
                    strokeDashoffset={offset}
                  >
                    <title>{`${s.label}: ${s.value}`}</title>
                  </circle>
                );
                offset -= share;
                return el;
              })}
        </svg>
        <div className="absolute inset-0 grid place-items-center text-center">
          <div>
            <div className="text-lg leading-none font-semibold tabular-nums">{total}</div>
            <div className="text-[10px] text-muted-foreground">{centre}</div>
          </div>
        </div>
      </div>
      <ul className="min-w-0 flex-1 space-y-0.5 text-xs">
        {slices.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span className={cn("size-2 shrink-0 rounded-full bg-current", s.className)} />
            <span className="min-w-0 flex-1 truncate">{s.label}</span>
            <span className="text-muted-foreground tabular-nums">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export type Bar = { key: string; label: React.ReactNode; value: number; className?: string };

/** Horizontal bars scaled to the largest value, label left, number right. */
export function BarList({ bars, className }: { bars: Bar[]; className?: string }) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <ul className={cn("min-h-0 flex-1 space-y-1.5 overflow-hidden text-xs", className)}>
      {bars.map((b) => (
        <li key={b.key} className="grid grid-cols-[minmax(0,7rem)_1fr_2rem] items-center gap-2">
          <span className="truncate">{b.label}</span>
          <span className="h-1.5 rounded-full bg-muted">
            <span
              className={cn("block h-full rounded-full bg-current", b.className ?? "text-foreground/70")}
              style={{ width: `${(b.value / max) * 100}%` }}
            />
          </span>
          <span className="text-right text-muted-foreground tabular-nums">{b.value}</span>
        </li>
      ))}
    </ul>
  );
}
