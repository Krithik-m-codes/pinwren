"use client";

import "react-day-picker/style.css";
import { CalendarDays, Link2, X } from "lucide-react";
import { useState } from "react";
import { type DateRange, DayPicker } from "react-day-picker";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Range } from "@/lib/dashboard/catalog";
import { dateToDay, type DashFilters, dayToDate, hasFilters } from "@/lib/dashboard/filters";
import { useI18n } from "@/lib/i18n/provider";
import { useLabelsQuery, useProjectsQuery } from "@/lib/store/api";
import { cn } from "@/lib/utils";
import { useMounted } from "@/lib/use-synced-state";
import { useMembers } from "@/lib/viewer";

// The home dashboard's filter bar: project, label, assignee and date range. It only reports changes; the
// parent keeps them in the URL and feeds them to every widget (`/api/stats`).

const ALL = "__all";
const RANGES: Range[] = [7, 14, 30, 90];
const dateText = (day: string, local: boolean) =>
  local ? dayToDate(day).toLocaleDateString(undefined, { dateStyle: "medium" }) : day;

export function FilterBar({
  filters,
  days,
  onChange,
  onDays,
}: {
  filters: DashFilters;
  days: Range;
  onChange: (patch: { [K in keyof DashFilters]?: string | null }) => void;
  onDays: (days: Range) => void;
}) {
  const { t } = useI18n();
  const projects = useProjectsQuery(undefined).data?.projects ?? [];
  const labels = useLabelsQuery(filters.projectId ?? "", { skip: !filters.projectId }).data?.labels ?? [];
  const members = useMembers();

  const projectItems = [
    { value: ALL, label: t("dashx.allProjects") },
    ...projects.map((p) => ({ value: p.id, label: p.name })),
  ];
  const labelItems = [
    { value: ALL, label: t("dashx.allLabels") },
    ...labels.map((l) => ({ value: l.id, label: l.name })),
  ];
  const assigneeItems = [
    { value: ALL, label: t("dashx.anyone") },
    { value: "me", label: t("dashx.me") },
    { value: "none", label: t("dashx.unassigned") },
    ...members.map((m) => ({ value: m.userId ?? m.id, label: m.name })),
  ];

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success(t("dashx.linkCopied"));
    } catch {
      toast.error(t("dashx.linkCopyFailed"));
    }
  };

  return (
    <div
      role="group"
      aria-label={t("dashx.filters")}
      data-testid="dashboard-filters"
      className="flex flex-wrap items-center gap-1.5"
    >
      <Select
        items={projectItems}
        value={filters.projectId ?? ALL}
        onValueChange={(v) => onChange({ projectId: v === ALL ? null : v })}
      >
        <SelectTrigger size="sm" className="w-40" aria-label={t("dashx.project")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {projectItems.map((i) => (
            <SelectItem key={i.value} value={i.value}>
              {i.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        items={labelItems}
        value={filters.labelId ?? ALL}
        disabled={!filters.projectId}
        onValueChange={(v) => onChange({ labelId: v === ALL ? null : v })}
      >
        <SelectTrigger
          size="sm"
          className="w-36"
          aria-label={t("dashx.label")}
          title={filters.projectId ? undefined : t("dashx.pickProjectForLabel")}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {labelItems.map((i) => (
            <SelectItem key={i.value} value={i.value}>
              {i.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        items={assigneeItems}
        value={filters.assigneeId ?? ALL}
        onValueChange={(v) => onChange({ assigneeId: v === ALL ? null : v })}
      >
        <SelectTrigger size="sm" className="w-40" aria-label={t("dashx.assignee")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {assigneeItems.map((i) => (
            <SelectItem key={i.value} value={i.value}>
              {i.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <RangePicker filters={filters} days={days} onChange={onChange} onDays={onDays} />
      {hasFilters(filters) && (
        <Button
          variant="ghost"
          size="sm"
          data-testid="dashboard-filters-clear"
          onClick={() => onChange(CLEAR)}
        >
          <X /> {t("dashx.clearFilters")}
        </Button>
      )}
      <Button variant="ghost" size="sm" className="ml-auto" onClick={() => void copyLink()}>
        <Link2 /> {t("dashx.copyLink")}
      </Button>
    </div>
  );
}

const CLEAR = { projectId: null, labelId: null, assigneeId: null, from: null, to: null } as const;

/** Presets (the layout's own range) and a custom span from the calendar. */
function RangePicker({
  filters,
  days,
  onChange,
  onDays,
}: {
  filters: DashFilters;
  days: Range;
  onChange: (patch: { [K in keyof DashFilters]?: string | null }) => void;
  onDays: (days: Range) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  // Dates are written in the person's locale, which the server cannot know: ISO until mounted.
  const local = useMounted();
  const custom = !!filters.from;
  const start = filters.from ? dayToDate(filters.from) : undefined;
  const selected: DateRange | undefined =
    filters.from && start ? { from: start, to: dayToDate(filters.to ?? filters.from) } : undefined;
  const label = !filters.from
    ? t(`dash.range${days}` as "dash.range7")
    : filters.to
      ? t("dashx.rangeBetween", { from: dateText(filters.from, local), to: dateText(filters.to, local) })
      : t("dashx.rangeSince", { from: dateText(filters.from, local) });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            aria-label={t("dash.range")}
            className={cn(custom && "border-primary/50")}
          />
        }
      >
        <CalendarDays /> {label}
      </PopoverTrigger>
      <PopoverContent align="start" className="pinwren-calendar w-auto p-2">
        <div className="flex flex-wrap gap-1 pb-2" role="group" aria-label={t("dash.range")}>
          {RANGES.map((d) => (
            <Button
              key={d}
              size="xs"
              variant={!custom && days === d ? "secondary" : "ghost"}
              aria-pressed={!custom && days === d}
              onClick={() => {
                onChange({ from: null, to: null });
                onDays(d);
                setOpen(false);
              }}
            >
              {t(`dash.range${d}` as "dash.range7")}
            </Button>
          ))}
        </div>
        <p className="px-1 pb-1 text-xs text-muted-foreground">{t("dashx.customRange")}</p>
        <DayPicker
          mode="range"
          {...(selected && start ? { selected, defaultMonth: start } : {})}
          max={366}
          disabled={{ after: new Date() }}
          onSelect={(range) => {
            if (!range?.from) return;
            if (range.to) {
              onChange({ from: dateToDay(range.from), to: dateToDay(range.to) });
              setOpen(false);
            }
          }}
          showOutsideDays
        />
      </PopoverContent>
    </Popover>
  );
}
