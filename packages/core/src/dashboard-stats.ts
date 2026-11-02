import { z } from "zod";
import { feedbackKind, feedbackStatus, priority } from "./schemas";

/** Date ranges the dashboards offer (days back from now). */
export const STATS_RANGES = [7, 14, 30, 90] as const;

/** `GET /api/stats`: workspace-wide numbers for the dashboards, optionally for one project. */
export const dashboardStatsQuery = z.object({
  projectId: z.uuid().optional(),
  days: z.coerce
    .number()
    .int()
    .refine((n) => (STATS_RANGES as readonly number[]).includes(n), "Unsupported range")
    .default(14),
});
export type DashboardStatsQuery = z.infer<typeof dashboardStatsQuery>;

const count = z.number().int().nonnegative();

/**
 * Aggregates over live (not trashed) items. `created`/`resolved` and the series cover the last `days` days;
 * `previousCreated` the same length of time before that, for the delta on a tile. The rest is "right now".
 */
export const dashboardStats = z.object({
  days: z.number().int(),
  totals: z.object({
    active: count,
    created: count,
    previousCreated: count,
    resolved: count,
    unassigned: count,
    overdue: count,
    mine: count,
    urgent: count,
    /** Mean hours from filed to resolved, over items resolved in the range; null when none. */
    avgResolutionHours: z.number().nullable(),
  }),
  byStatus: z.array(z.object({ key: feedbackStatus, count })),
  byKind: z.array(z.object({ key: feedbackKind, count })),
  byPriority: z.array(z.object({ key: priority, count })),
  /** Open work per project (only when the request was not for a single project). */
  byProject: z.array(z.object({ id: z.string(), name: z.string(), active: count, total: count })),
  /** One row per UTC day, oldest first, zero-filled. */
  series: z.array(z.object({ date: z.string(), created: count, resolved: count })),
  recent: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      at: z.string(),
      actor: z.string().nullable(),
      feedbackId: z.string(),
      projectId: z.string(),
      number: z.number().int(),
      title: z.string().nullable(),
    }),
  ),
});
export type DashboardStats = z.infer<typeof dashboardStats>;

/** Fill the days with no rows with zeros: `days` UTC dates ending at `now`, oldest first. */
export function fillSeries(
  rows: { date: string; created?: number; resolved?: number }[],
  days: number,
  now: Date,
): DashboardStats["series"] {
  const by = new Map(rows.map((r) => [r.date, r]));
  const out: DashboardStats["series"] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    const date = d.toISOString().slice(0, 10);
    const r = by.get(date);
    out.push({ date, created: r?.created ?? 0, resolved: r?.resolved ?? 0 });
  }
  return out;
}
