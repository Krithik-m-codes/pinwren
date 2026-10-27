import type { FeedbackKind, FeedbackStatus, Priority } from "@pinwren/core";
import {
  Bug,
  CircleCheck,
  CircleDot,
  CircleSlash,
  Copy,
  Ellipsis,
  Eye,
  HelpCircle,
  type LucideIcon,
  PencilLine,
  Timer,
} from "lucide-react";
import type { Key } from "@/lib/i18n/en";
import type { TFn } from "@/lib/i18n/english";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

export const STATUS_META: Record<FeedbackStatus, { labelKey: Key; icon: LucideIcon; className: string }> = {
  open: { labelKey: "meta.statusOpen", icon: CircleDot, className: "text-blue-500" },
  in_progress: { labelKey: "meta.statusInProgress", icon: Timer, className: "text-amber-500" },
  in_review: { labelKey: "meta.statusInReview", icon: Eye, className: "text-violet-500" },
  resolved: { labelKey: "meta.statusResolved", icon: CircleCheck, className: "text-emerald-500" },
  wont_fix: { labelKey: "meta.statusWontFix", icon: CircleSlash, className: "text-muted-foreground" },
  duplicate: { labelKey: "meta.statusDuplicate", icon: Copy, className: "text-muted-foreground" },
};

// Labels match core's KIND_LABELS so the dashboard reads like the widget: `idea` is "Change", `comment` is "Other".
// Each entry holds a translation key; readers call t(meta.labelKey).
export const KIND_META: Record<FeedbackKind, { labelKey: Key; icon: LucideIcon }> = {
  comment: { labelKey: "meta.kindComment", icon: Ellipsis },
  bug: { labelKey: "meta.kindBug", icon: Bug },
  idea: { labelKey: "meta.kindIdea", icon: PencilLine },
  question: { labelKey: "meta.kindQuestion", icon: HelpCircle },
};

export const PRIORITY_META: Record<Priority, { labelKey: Key; className: string; bars: number }> = {
  none: { labelKey: "meta.priorityNone", className: "text-muted-foreground", bars: 0 },
  low: { labelKey: "meta.priorityLow", className: "text-slate-500", bars: 1 },
  medium: { labelKey: "meta.priorityMedium", className: "text-yellow-500", bars: 2 },
  high: { labelKey: "meta.priorityHigh", className: "text-orange-500", bars: 3 },
  urgent: { labelKey: "meta.priorityUrgent", className: "text-red-500", bars: 4 },
};

export function StatusIcon({ status, className }: { status: FeedbackStatus; className?: string }) {
  const t = useI18n().t;
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return <Icon aria-label={t(meta.labelKey)} className={cn("size-4 shrink-0", meta.className, className)} />;
}

export function PriorityIcon({ priority, className }: { priority: Priority; className?: string }) {
  const t = useI18n().t;
  const meta = PRIORITY_META[priority];
  if (priority === "urgent") {
    return (
      <span
        role="img"
        aria-label={t(meta.labelKey)}
        className={cn(
          "grid size-4 place-items-center rounded-[4px] bg-red-500 text-[10px] font-bold text-white",
          className,
        )}
      >
        !
      </span>
    );
  }
  return (
    <span
      role="img"
      aria-label={t(meta.labelKey)}
      className={cn("flex h-4 w-4 items-end gap-[2px] p-[1px]", meta.className, className)}
    >
      {[1, 2, 3].map((b) => (
        <span
          key={b}
          className={cn("w-[3px] rounded-[1px] bg-current", b > meta.bars && "opacity-25")}
          style={{ height: `${b * 4}px` }}
        />
      ))}
    </span>
  );
}

type TnFn = (stem: string, n: number) => string;

/** "3 minutes ago", "yesterday", "in 2 weeks": the same wording as Intl's `numeric: "auto"`, from the catalogue. */
export function timeAgo(iso: string, i18n: { t: TFn; tn: TnFn }): string {
  const { t, tn } = i18n;
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const units: [string, number, [Key, Key] | null][] = [
    ["Year", 31_536_000, ["meta.lastYear", "meta.nextYear"]],
    ["Month", 2_592_000, ["meta.lastMonth", "meta.nextMonth"]],
    ["Week", 604_800, ["meta.lastWeek", "meta.nextWeek"]],
    ["Day", 86_400, ["meta.yesterday", "meta.tomorrow"]],
    ["Hour", 3_600, null],
    ["Minute", 60, null],
  ];
  for (const [unit, secs, single] of units) {
    if (Math.abs(diff) >= secs) {
      const n = Math.round(diff / secs);
      if (single && Math.abs(n) === 1) return t(single[n < 0 ? 0 : 1]);
      return tn(`meta.${n < 0 ? "ago" : "in"}${unit}`, Math.abs(n));
    }
  }
  return t("meta.justNow");
}

/** `timeAgo` bound to the reader's language, for client components. */
export function useTimeAgo(): (iso: string) => string {
  const i18n = useI18n();
  return (iso) => timeAgo(iso, i18n);
}

export function pathOf(url: string | null): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    return u.pathname + u.search || "/";
  } catch {
    return url;
  }
}

/**
 * "3 minutes ago" for a server-rendered screen. The text depends on the clock, so it may differ by a tick
 * between the server's HTML and hydration; React is told that is expected for this one element.
 */
export function RelativeTime({ iso, className }: { iso: string; className?: string }) {
  const timeAgo = useTimeAgo();
  return (
    <time dateTime={iso} className={className} suppressHydrationWarning>
      {timeAgo(iso)}
    </time>
  );
}

/** A date (optionally with the time) in the reader's locale; the server may format it differently. */
export function LocalDate({
  iso,
  time = false,
  className,
}: {
  iso: string;
  time?: boolean;
  className?: string;
}) {
  const d = new Date(iso);
  return (
    <time dateTime={iso} className={className} suppressHydrationWarning>
      {time
        ? d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
        : d.toLocaleDateString(undefined, { dateStyle: "medium" })}
    </time>
  );
}
