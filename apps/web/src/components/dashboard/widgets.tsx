"use client";

import type { DashboardStats, FeedbackKind, FeedbackStatus, Priority } from "@pinwren/core";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { type ReactNode } from "react";
import { KIND_META, PRIORITY_META, RelativeTime, STATUS_META } from "@/components/feedback-meta";
import { EmptyState } from "@/components/states";
import { WIDGETS, type WidgetId } from "@/lib/dashboard/catalog";
import type { Key } from "@/lib/i18n/en";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { AreaChart, BarList, Donut } from "./charts";
import { CircleCheck, FolderKanban, Inbox } from "lucide-react";

// Widget bodies. Each one is a pure view of the stats object (one request feeds the whole screen), so a
// widget can be added, moved or resized without anything refetching. `projectId` narrows the links.

export type WidgetProps = {
  stats: DashboardStats;
  projectId: string | undefined;
};

const inbox = (projectId: string | undefined, extra?: Record<string, string>): Route => {
  const sp = new URLSearchParams(extra);
  if (projectId) sp.set("project", projectId);
  const q = sp.toString();
  return q ? `/inbox?${q}` : "/inbox";
};

// --- Frames ------------------------------------------------------------------------------------------

function Tile({
  label,
  value,
  hint,
  href,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  href?: Route;
  tone?: string | undefined;
}) {
  const body = (
    <div className="flex h-full flex-col justify-between gap-0.5 px-3 py-2">
      <div className="truncate text-xs text-muted-foreground">{label}</div>
      <div className={cn("text-xl leading-none font-semibold tabular-nums", tone)}>{value}</div>
      <div className="truncate text-[11px] text-muted-foreground">{hint ?? " "}</div>
    </div>
  );
  return href ? (
    <Link
      href={href}
      className="block h-full rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {body}
    </Link>
  ) : (
    body
  );
}

function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="truncate text-xs font-medium text-muted-foreground">{title}</h3>
        {action}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

// --- KPI tiles ---------------------------------------------------------------------------------------

function useTitle(id: WidgetId) {
  const { t } = useI18n();
  return t(WIDGETS[id].title);
}

function Delta({ now, before, days }: { now: number; before: number; days: number }) {
  const { t } = useI18n();
  const diff = now - before;
  const Icon = diff > 0 ? ArrowUpRight : diff < 0 ? ArrowDownRight : Minus;
  return (
    <span className="inline-flex items-center gap-0.5">
      <Icon className="size-3" />
      {t("dash.vsPrevious", { delta: `${diff > 0 ? "+" : ""}${diff}`, days })}
    </span>
  );
}

export function KpiWidget({ id, stats, projectId }: WidgetProps & { id: WidgetId }) {
  const { t } = useI18n();
  const label = useTitle(id);
  const s = stats.totals;
  const days = stats.days;
  const range = t("dash.lastDays", { days });
  switch (id) {
    case "kpi.active":
      return <Tile label={label} value={s.active} hint={t("dash.activeHint2")} href={inbox(projectId)} />;
    case "kpi.created":
      return (
        <Tile
          label={label}
          value={s.created}
          hint={<Delta now={s.created} before={s.previousCreated} days={days} />}
          href={inbox(projectId, { status: "all" })}
        />
      );
    case "kpi.resolved":
      return (
        <Tile
          label={label}
          value={s.resolved}
          hint={range}
          tone="text-emerald-600 dark:text-emerald-400"
          href={inbox(projectId, { status: "resolved" })}
        />
      );
    case "kpi.unassigned":
      return <Tile label={label} value={s.unassigned} hint={t("dash.needsOwner")} href={inbox(projectId)} />;
    case "kpi.overdue":
      return (
        <Tile
          label={label}
          value={s.overdue}
          hint={t("dash.pastDue")}
          tone={s.overdue ? "text-destructive" : undefined}
          href={inbox(projectId)}
        />
      );
    case "kpi.mine":
      return (
        <Tile
          label={label}
          value={s.mine}
          hint={t("dash.assignedToYou")}
          href={inbox(projectId, { assignee: "me" })}
        />
      );
    case "kpi.urgent":
      return (
        <Tile
          label={label}
          value={s.urgent}
          hint={t("dash.highOrUrgent")}
          tone={s.urgent ? "text-orange-600 dark:text-orange-400" : undefined}
          href={inbox(projectId, { priority: "urgent" })}
        />
      );
    default:
      return (
        <Tile
          label={label}
          value={s.avgResolutionHours === null ? "—" : formatHours(s.avgResolutionHours, t)}
          hint={range}
        />
      );
  }
}

function formatHours(h: number, t: (k: Key, v?: Record<string, string | number>) => string) {
  return h < 48
    ? t("dash.hours", { n: Math.round(h * 10) / 10 })
    : t("dash.daysShort", { n: Math.round(h / 24) });
}

// --- Charts ------------------------------------------------------------------------------------------

export function TrendWidget({ stats }: WidgetProps) {
  const { t, locale } = useI18n();
  const fmt = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale, {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  const created = stats.series.map((d) => d.created);
  const resolved = stats.series.map((d) => d.resolved);
  const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);
  return (
    <Panel
      title={useTitle("chart.trend")}
      action={
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-blue-500" />
            {t("dash.trendCreated")}
          </span>
          <span className="flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            {t("dash.trendResolved")}
          </span>
        </div>
      }
    >
      <AreaChart
        labels={stats.series.map((d) => d.date)}
        formatLabel={fmt}
        summary={t("dash.trendSummary", { created: sum(created), resolved: sum(resolved), days: stats.days })}
        series={[
          { key: "created", label: t("dash.trendCreated"), className: "text-blue-500", values: created },
          {
            key: "resolved",
            label: t("dash.trendResolved"),
            className: "text-emerald-500",
            values: resolved,
          },
        ]}
      />
    </Panel>
  );
}

export function StatusWidget({ stats }: WidgetProps) {
  const { t } = useI18n();
  const by = new Map(stats.byStatus.map((r) => [r.key, r.count]));
  const order = Object.keys(STATUS_META) as FeedbackStatus[];
  const slices = order.map((k) => ({
    key: k,
    label: t(STATUS_META[k].labelKey),
    value: by.get(k) ?? 0,
    className: STATUS_META[k].className,
  }));
  const total = slices.reduce((a, s) => a + s.value, 0);
  return (
    <Panel title={useTitle("chart.status")}>
      {total === 0 ? (
        <Quiet icon={Inbox} text={t("dash.noItems")} />
      ) : (
        <Donut
          slices={slices}
          total={total}
          centre={t("dash.total")}
          summary={slices.map((s) => `${s.label} ${s.value}`).join(", ")}
        />
      )}
    </Panel>
  );
}

export function KindWidget({ stats }: WidgetProps) {
  const { t } = useI18n();
  const by = new Map(stats.byKind.map((r) => [r.key, r.count]));
  const bars = (Object.keys(KIND_META) as FeedbackKind[]).map((k) => {
    const Icon = KIND_META[k].icon;
    return {
      key: k,
      label: (
        <span className="flex items-center gap-1.5">
          <Icon className="size-3.5 text-muted-foreground" />
          {t(KIND_META[k].labelKey)}
        </span>
      ),
      value: by.get(k) ?? 0,
    };
  });
  return (
    <Panel title={useTitle("chart.kind")}>
      {bars.every((b) => b.value === 0) ? (
        <Quiet icon={Inbox} text={t("dash.noActive")} />
      ) : (
        <BarList bars={bars} />
      )}
    </Panel>
  );
}

export function PriorityWidget({ stats }: WidgetProps) {
  const { t } = useI18n();
  const by = new Map(stats.byPriority.map((r) => [r.key, r.count]));
  const bars = (["urgent", "high", "medium", "low", "none"] as Priority[]).map((k) => ({
    key: k,
    label: t(PRIORITY_META[k].labelKey),
    value: by.get(k) ?? 0,
    className: PRIORITY_META[k].className,
  }));
  return (
    <Panel title={useTitle("chart.priority")}>
      {bars.every((b) => b.value === 0) ? (
        <Quiet icon={Inbox} text={t("dash.noActive")} />
      ) : (
        <BarList bars={bars} />
      )}
    </Panel>
  );
}

export function ProjectBarsWidget({ stats }: WidgetProps) {
  const { t } = useI18n();
  const bars = stats.byProject
    .filter((p) => p.active > 0)
    .map((p) => ({ key: p.id, label: p.name, value: p.active, className: "text-blue-500" }));
  return (
    <Panel title={useTitle("chart.projects")}>
      {bars.length === 0 ? <Quiet icon={CircleCheck} text={t("dash.noActive")} /> : <BarList bars={bars} />}
    </Panel>
  );
}

// --- Lists -------------------------------------------------------------------------------------------

function Quiet({ icon, text }: { icon: typeof Inbox; text: string }) {
  return <EmptyState icon={icon} title={text} className="flex-1 gap-1 py-2 [&_p]:text-xs" />;
}

const ACTIVITY_KEYS: Record<string, Key> = {
  created: "dash.act.created",
  status_changed: "dash.act.status",
  priority_changed: "dash.act.priority",
  assigneeIds_changed: "dash.act.assignees",
  kind_changed: "dash.act.kind",
  title_changed: "dash.act.title",
  dueAt_changed: "dash.act.due",
  comment: "dash.act.comment",
  deleted: "dash.act.deleted",
  restored: "dash.act.restored",
};

export function RecentWidget({ stats }: WidgetProps) {
  const { t } = useI18n();
  return (
    <Panel title={useTitle("list.recent")}>
      {stats.recent.length === 0 ? (
        <Quiet icon={Inbox} text={t("dash.recentEmpty")} />
      ) : (
        <ul className="-mx-1 min-h-0 flex-1 divide-y divide-border/60 overflow-hidden text-xs">
          {stats.recent.map((r) => (
            <li key={r.id}>
              <Link
                href={`/inbox?status=all&item=${r.feedbackId}` as Route}
                className="flex items-baseline gap-1.5 rounded px-1 py-1 hover:bg-muted/60"
              >
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{r.actor ?? t("dash.someone")}</span>{" "}
                  <span className="text-muted-foreground">
                    {t(ACTIVITY_KEYS[r.type] ?? "dash.act.other")}
                  </span>{" "}
                  <span className="text-muted-foreground">#{r.number}</span> {r.title ?? ""}
                </span>
                <RelativeTime iso={r.at} className="shrink-0 text-[11px] text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function ProjectsWidget({ stats }: WidgetProps) {
  const { t } = useI18n();
  return (
    <Panel
      title={useTitle("list.projects")}
      action={
        <Link href="/projects" className="text-[11px] text-muted-foreground hover:text-foreground">
          {t("dash.viewAll")}
        </Link>
      }
    >
      {stats.byProject.length === 0 ? (
        <Quiet icon={FolderKanban} text={t("dash.projectsEmpty")} />
      ) : (
        <table className="w-full min-w-0 text-xs">
          <thead className="text-left text-[11px] text-muted-foreground">
            <tr>
              <th className="pb-1 font-normal">{t("dash.colProject")}</th>
              <th className="pb-1 text-right font-normal">{t("dash.colActive")}</th>
              <th className="pb-1 text-right font-normal">{t("dash.colTotal")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {stats.byProject.map((p) => (
              <tr key={p.id}>
                <td className="max-w-0 truncate py-1">
                  <Link href={`/projects/${p.id}` as Route} className="hover:underline">
                    {p.name}
                  </Link>
                </td>
                <td className="py-1 text-right tabular-nums">{p.active}</td>
                <td className="py-1 text-right text-muted-foreground tabular-nums">{p.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

/** "What needs you": the counts that mean someone should act, each a link into the inbox. */
export function AttentionWidget({ stats, projectId }: WidgetProps) {
  const { t } = useI18n();
  const s = stats.totals;
  const rows: { key: string; label: string; n: number; href: Route }[] = [
    { key: "overdue", label: t("dash.w.overdue"), n: s.overdue, href: inbox(projectId) },
    { key: "urgent", label: t("dash.w.urgent"), n: s.urgent, href: inbox(projectId, { priority: "urgent" }) },
    { key: "unassigned", label: t("dash.w.unassigned"), n: s.unassigned, href: inbox(projectId) },
    { key: "mine", label: t("dash.w.mine"), n: s.mine, href: inbox(projectId, { assignee: "me" }) },
  ].filter((r) => r.n > 0);
  return (
    <Panel title={useTitle("list.attention")}>
      {rows.length === 0 ? (
        <Quiet icon={CircleCheck} text={t("dash.allClear")} />
      ) : (
        <ul className="-mx-1 space-y-0.5 text-xs">
          {rows.map((r) => (
            <li key={r.key}>
              <Link
                href={r.href}
                className="flex items-center justify-between rounded px-1 py-1 hover:bg-muted/60"
              >
                <span>{r.label}</span>
                <span className="font-medium tabular-nums">{r.n}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** Renders the widget named by a layout slot. */
export function WidgetBody({ id, ...props }: WidgetProps & { id: WidgetId }) {
  switch (id) {
    case "chart.trend":
      return <TrendWidget {...props} />;
    case "chart.status":
      return <StatusWidget {...props} />;
    case "chart.kind":
      return <KindWidget {...props} />;
    case "chart.priority":
      return <PriorityWidget {...props} />;
    case "chart.projects":
      return <ProjectBarsWidget {...props} />;
    case "list.recent":
      return <RecentWidget {...props} />;
    case "list.projects":
      return <ProjectsWidget {...props} />;
    case "list.attention":
      return <AttentionWidget {...props} />;
    default:
      return <KpiWidget id={id} {...props} />;
  }
}
