"use client";

import type { DashboardStats, FeedbackKind, FeedbackStatus, Priority } from "@pinwren/core";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { type ReactNode } from "react";
import { KIND_META, pathOf, PRIORITY_META, RelativeTime, STATUS_META } from "@/components/feedback-meta";
import { EmptyState } from "@/components/states";
import { WIDGETS, type WidgetId } from "@/lib/dashboard/catalog";
import type { Key } from "@/lib/i18n/en";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { AreaChart, BarList, Donut } from "./charts";
import { CircleCheck, FolderKanban, Inbox, Rocket, Target, TriangleAlert, Users } from "lucide-react";
import { SignoffBadge } from "@/components/round-signoffs";

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
    case "kpi.sla":
      return (
        <Tile
          label={label}
          value={s.slaBreached}
          hint={t("dash.slaHint")}
          tone={s.slaBreached ? "text-destructive" : undefined}
          href={inbox(projectId, { status: "all" })}
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

export function BrowsersWidget({ stats }: WidgetProps) {
  const { t } = useI18n();
  const bars = stats.browsers.map((b) => ({
    key: b.key,
    label: b.key === "Unknown" ? t("dash.unknown") : b.key,
    value: b.count,
    className: "text-blue-500",
  }));
  return (
    <Panel title={useTitle("chart.browsers")}>
      {bars.length === 0 ? <Quiet icon={Inbox} text={t("dash.noItems")} /> : <BarList bars={bars} />}
    </Panel>
  );
}

export function SystemsWidget({ stats }: WidgetProps) {
  const { t } = useI18n();
  const bars = stats.operatingSystems.map((b) => ({
    key: b.key,
    label: b.key === "Unknown" ? t("dash.unknown") : b.key,
    value: b.count,
    className: "text-violet-500",
  }));
  return (
    <Panel title={useTitle("chart.systems")}>
      {bars.length === 0 ? <Quiet icon={Inbox} text={t("dash.noItems")} /> : <BarList bars={bars} />}
    </Panel>
  );
}

const DEVICE_KEYS = {
  desktop: "dash.deviceDesktop",
  tablet: "dash.deviceTablet",
  mobile: "dash.deviceMobile",
  unknown: "dash.unknown",
} as const satisfies Record<DashboardStats["devices"][number]["key"], Key>;
const DEVICE_COLORS = {
  desktop: "text-blue-500",
  tablet: "text-violet-500",
  mobile: "text-emerald-500",
  unknown: "text-muted-foreground",
} as const;

export function DevicesWidget({ stats }: WidgetProps) {
  const { t } = useI18n();
  const slices = stats.devices.map((d) => ({
    key: d.key,
    label: t(DEVICE_KEYS[d.key]),
    value: d.count,
    className: DEVICE_COLORS[d.key],
  }));
  const total = slices.reduce((a, s) => a + s.value, 0);
  return (
    <Panel title={useTitle("chart.devices")}>
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

const BUCKET_KEYS = {
  "1h": "dash.bucket1h",
  "4h": "dash.bucket4h",
  "24h": "dash.bucket24h",
  "3d": "dash.bucket3d",
  "7d": "dash.bucket7d",
  over7d: "dash.bucketOver7d",
} as const satisfies Record<DashboardStats["firstResponse"]["buckets"][number]["key"], Key>;

/** A histogram as bars, with the median in the panel header. */
function TimeWidget({ id, dist }: { id: WidgetId; dist: DashboardStats["firstResponse"] }) {
  const { t } = useI18n();
  const title = useTitle(id);
  const bars = dist.buckets.map((b) => ({
    key: b.key,
    label: t(BUCKET_KEYS[b.key]),
    value: b.count,
    className: "text-blue-500",
  }));
  return (
    <Panel
      title={title}
      action={
        dist.medianHours === null ? undefined : (
          <span className="text-[11px] text-muted-foreground">
            {t("dash.median", { time: formatHours(dist.medianHours, t) })}
          </span>
        )
      }
    >
      {dist.sample === 0 ? <Quiet icon={Inbox} text={t("dash.noTiming")} /> : <BarList bars={bars} />}
    </Panel>
  );
}

export const FirstResponseWidget = ({ stats }: WidgetProps) => (
  <TimeWidget id="chart.firstResponse" dist={stats.firstResponse} />
);
export const ResolveTimeWidget = ({ stats }: WidgetProps) => (
  <TimeWidget id="chart.resolveTime" dist={stats.resolveTime} />
);

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
  fixedIn_changed: "releases.actReleaseFixed",
  regression_detected: "releases.actRegression",
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

export function PagesWidget({ stats }: WidgetProps) {
  const { t } = useI18n();
  const max = Math.max(1, ...stats.topPages.map((p) => p.count));
  return (
    <Panel title={useTitle("list.pages")}>
      {stats.topPages.length === 0 ? (
        <Quiet icon={Inbox} text={t("dash.noPages")} />
      ) : (
        <ul className="-mx-1 min-h-0 flex-1 space-y-1 overflow-hidden text-xs" data-testid="top-pages">
          {stats.topPages.map((p) => (
            <li key={p.url} className="grid grid-cols-[minmax(0,1fr)_2.5rem] items-center gap-2 px-1">
              <span className="min-w-0">
                <span className="block truncate" title={p.url}>
                  {pathOf(p.url)}
                </span>
                <span className="block h-1 rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full bg-blue-500"
                    style={{ width: `${(p.count / max) * 100}%` }}
                  />
                </span>
              </span>
              <span className="text-right tabular-nums">
                {p.count}
                <span className="sr-only"> ({t("dash.openCount", { n: p.active })})</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function RoundsWidget({ stats }: WidgetProps) {
  const { t } = useI18n();
  return (
    <Panel title={useTitle("list.rounds")}>
      {stats.rounds.length === 0 ? (
        <Quiet icon={Target} text={t("dash.noRounds")} />
      ) : (
        <ul className="-mx-1 min-h-0 flex-1 space-y-2 overflow-hidden text-xs" data-testid="round-progress">
          {stats.rounds.map((r) => {
            const pct = r.total ? Math.round((r.closed / r.total) * 100) : 0;
            return (
              <li key={r.id}>
                <Link
                  href={`/projects/${r.projectId}/rounds` as Route}
                  className="block rounded px-1 py-0.5 hover:bg-muted/60"
                >
                  <span className="flex items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
                    <SignoffBadge state={r.signoff} required={r.requireSignoff} />
                    <span className="shrink-0 text-muted-foreground tabular-nums">
                      {r.closed}/{r.total}
                    </span>
                  </span>
                  <span
                    className="mt-1 block h-1.5 overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-label={r.name}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={pct}
                  >
                    <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">{r.projectName}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export function ReportersWidget({ stats }: WidgetProps) {
  const { t } = useI18n();
  return (
    <Panel title={useTitle("list.reporters")}>
      {stats.reporters.length === 0 ? (
        <Quiet icon={Users} text={t("dash.noReporters")} />
      ) : (
        <table className="w-full min-w-0 text-xs" data-testid="reporter-board">
          <thead className="text-left text-[11px] text-muted-foreground">
            <tr>
              <th className="pb-1 font-normal">{t("dash.colReporter")}</th>
              <th className="pb-1 text-right font-normal">{t("dash.colFiled")}</th>
              <th className="pb-1 text-right font-normal">{t("dash.colResolved")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {stats.reporters.map((r) => (
              <tr key={r.id}>
                <td className="max-w-0 truncate py-1">{r.name}</td>
                <td className="py-1 text-right tabular-nums">{r.count}</td>
                <td className="py-1 text-right text-muted-foreground tabular-nums">{r.resolved}</td>
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

/** New reports that look like resolved items (ADR 0033): the open ones first in the count, each a link. */
export function RegressionsWidget({ stats, projectId }: WidgetProps) {
  const { t } = useI18n();
  const r = stats.regressions;
  return (
    <Panel
      title={useTitle("list.regressions")}
      action={
        <Link
          href={inbox(projectId, { regression: "true", status: "all" })}
          className="text-[11px] text-muted-foreground hover:text-foreground"
        >
          {t("dash.viewAll")}
        </Link>
      }
    >
      {r.items.length === 0 ? (
        <Quiet icon={CircleCheck} text={t("releases.wNoRegressions")} />
      ) : (
        <>
          <p className="mb-1 text-[11px] text-muted-foreground" data-testid="regression-counts">
            {t("releases.wOpenCount", { open: r.open, total: r.total })}
          </p>
          <ul
            className="-mx-1 min-h-0 flex-1 space-y-0.5 overflow-y-auto text-xs"
            data-testid="regression-list"
          >
            {r.items.map((i) => (
              <li key={i.id}>
                <Link
                  href={`/inbox?status=all&item=${i.id}` as Route}
                  className="flex items-center gap-1.5 rounded px-1 py-1 hover:bg-muted/60"
                >
                  <TriangleAlert
                    aria-hidden
                    className={cn(
                      "size-3 shrink-0",
                      i.confidence === "likely" ? "text-red-600" : "text-amber-600",
                    )}
                  />
                  <span className="shrink-0 text-muted-foreground">#{i.number}</span>
                  <span className="min-w-0 flex-1 truncate">{i.title ?? ""}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {t("releases.wOf", { number: i.ofNumber })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

/** Releases with the items fixed in them and the regressions reported from them, newest first. */
export function FixedPerReleaseWidget({ stats, projectId }: WidgetProps) {
  const { t } = useI18n();
  const most = Math.max(1, ...stats.releases.map((r) => r.fixed));
  return (
    <Panel title={useTitle("list.fixedPerRelease")}>
      {stats.releases.length === 0 ? (
        <Quiet icon={Rocket} text={t("releases.wNoReleases")} />
      ) : (
        <ul className="-mx-1 space-y-1 text-xs" data-testid="release-list">
          {stats.releases.map((r) => (
            <li key={r.id}>
              <Link
                href={inbox(projectId, { status: "all", fixedIn: r.id })}
                className="block rounded px-1 py-0.5 hover:bg-muted/60"
              >
                <span className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate font-medium">{r.version}</span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    {t("releases.wFixed", { count: r.fixed })}
                  </span>
                  {r.regressions > 0 && (
                    <span className="shrink-0 text-amber-700 tabular-nums dark:text-amber-400">
                      {t("releases.wRegressions", { count: r.regressions })}
                    </span>
                  )}
                </span>
                <span
                  className="mt-1 block h-1.5 overflow-hidden rounded-full bg-muted"
                  role="img"
                  aria-label={t("releases.wFixed", { count: r.fixed })}
                >
                  <span
                    className="block h-full rounded-full bg-emerald-500"
                    style={{ width: `${Math.round((r.fixed / most) * 100)}%` }}
                  />
                </span>
                {!projectId && (
                  <span className="block truncate text-[11px] text-muted-foreground">{r.projectName}</span>
                )}
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
    case "chart.browsers":
      return <BrowsersWidget {...props} />;
    case "chart.systems":
      return <SystemsWidget {...props} />;
    case "chart.devices":
      return <DevicesWidget {...props} />;
    case "chart.firstResponse":
      return <FirstResponseWidget {...props} />;
    case "chart.resolveTime":
      return <ResolveTimeWidget {...props} />;
    case "list.pages":
      return <PagesWidget {...props} />;
    case "list.rounds":
      return <RoundsWidget {...props} />;
    case "list.reporters":
      return <ReportersWidget {...props} />;
    case "list.recent":
      return <RecentWidget {...props} />;
    case "list.projects":
      return <ProjectsWidget {...props} />;
    case "list.attention":
      return <AttentionWidget {...props} />;
    case "list.regressions":
      return <RegressionsWidget {...props} />;
    case "list.fixedPerRelease":
      return <FixedPerReleaseWidget {...props} />;
    default:
      return <KpiWidget id={id} {...props} />;
  }
}
