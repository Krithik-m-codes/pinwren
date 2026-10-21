import type { FeedbackKind, FeedbackStatus, Priority } from "@annota/core";
import {
  Bug,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleSlash,
  Copy,
  Eye,
  HelpCircle,
  Lightbulb,
  type LucideIcon,
  MessageSquare,
  Timer,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const STATUS_META: Record<FeedbackStatus, { label: string; icon: LucideIcon; className: string }> = {
  open: { label: "Open", icon: CircleDot, className: "text-blue-500" },
  in_progress: { label: "In progress", icon: Timer, className: "text-amber-500" },
  in_review: { label: "In review", icon: Eye, className: "text-violet-500" },
  resolved: { label: "Resolved", icon: CircleCheck, className: "text-emerald-500" },
  wont_fix: { label: "Won't fix", icon: CircleSlash, className: "text-muted-foreground" },
  duplicate: { label: "Duplicate", icon: Copy, className: "text-muted-foreground" },
};

export const KIND_META: Record<FeedbackKind, { label: string; icon: LucideIcon }> = {
  comment: { label: "Comment", icon: MessageSquare },
  bug: { label: "Bug", icon: Bug },
  idea: { label: "Idea", icon: Lightbulb },
  question: { label: "Question", icon: HelpCircle },
};

export const PRIORITY_META: Record<Priority, { label: string; className: string; bars: number }> = {
  none: { label: "No priority", className: "text-muted-foreground", bars: 0 },
  low: { label: "Low", className: "text-slate-500", bars: 1 },
  medium: { label: "Medium", className: "text-yellow-500", bars: 2 },
  high: { label: "High", className: "text-orange-500", bars: 3 },
  urgent: { label: "Urgent", className: "text-red-500", bars: 4 },
};

export function StatusIcon({ status, className }: { status: FeedbackStatus; className?: string }) {
  const meta = STATUS_META[status] ?? { icon: CircleDashed, className: "" };
  const Icon = meta.icon;
  return (
    <Icon
      aria-label={STATUS_META[status]?.label}
      className={cn("size-4 shrink-0", meta.className, className)}
    />
  );
}

export function PriorityIcon({ priority, className }: { priority: Priority; className?: string }) {
  const meta = PRIORITY_META[priority];
  if (priority === "urgent") {
    return (
      <span
        role="img"
        aria-label={meta.label}
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
      aria-label={meta.label}
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

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
export function timeAgo(iso: string): string {
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, secs] of units) {
    if (Math.abs(diff) >= secs) return rtf.format(Math.round(diff / secs), unit);
  }
  return "just now";
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
