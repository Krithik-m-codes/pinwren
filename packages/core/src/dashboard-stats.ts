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

export const DEVICE_CLASSES = ["desktop", "tablet", "mobile", "unknown"] as const;
/** Upper bounds (hours) of the time-distribution buckets; the last bucket is everything above. */
export const TIME_BUCKETS = ["1h", "4h", "24h", "3d", "7d", "over7d"] as const;
export const TIME_BUCKET_LIMITS_H = [1, 4, 24, 72, 168] as const;

const timeDistribution = z.object({
  /** Items measured. */
  sample: count,
  medianHours: z.number().nullable(),
  buckets: z.array(z.object({ key: z.enum(TIME_BUCKETS), count })),
});
export type TimeDistribution = z.infer<typeof timeDistribution>;

/** Bucket index for a duration in hours (see TIME_BUCKETS). */
export function timeBucketIndex(hours: number): number {
  const i = TIME_BUCKET_LIMITS_H.findIndex((limit) => hours < limit);
  return i === -1 ? TIME_BUCKET_LIMITS_H.length : i;
}

/** Zero-filled buckets from sparse `{ index, count }` rows, in order. */
export function fillBuckets(rows: { index: number; count: number }[]): TimeDistribution["buckets"] {
  const by = new Map(rows.map((r) => [r.index, r.count]));
  return TIME_BUCKETS.map((key, i) => ({ key, count: by.get(i) ?? 0 }));
}

/** Viewport width (CSS px) to a device class, matching the SQL in the API. */
export function deviceClass(width: number | null | undefined): (typeof DEVICE_CLASSES)[number] {
  if (width == null || !Number.isFinite(width)) return "unknown";
  return width < 768 ? "mobile" : width < 1024 ? "tablet" : "desktop";
}

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
    /**
     * Items with a due date that missed it: still open and past due, or resolved after it (resolved in the
     * range). The workspace's SLA clock is the due date set in triage.
     */
    slaBreached: count,
  }),
  byStatus: z.array(z.object({ key: feedbackStatus, count })),
  byKind: z.array(z.object({ key: feedbackKind, count })),
  byPriority: z.array(z.object({ key: priority, count })),
  /** Open work per project (only when the request was not for a single project). */
  byProject: z.array(z.object({ id: z.string(), name: z.string(), active: count, total: count })),
  /** One row per UTC day, oldest first, zero-filled. */
  series: z.array(z.object({ date: z.string(), created: count, resolved: count })),
  /** Most-reported pages (items filed in the range), busiest first. */
  topPages: z.array(z.object({ url: z.string(), count, active: count })),
  /** Browser families, operating systems and device classes of the items filed in the range. */
  browsers: z.array(z.object({ key: z.string(), count })),
  operatingSystems: z.array(z.object({ key: z.string(), count })),
  devices: z.array(z.object({ key: z.enum(DEVICE_CLASSES), count })),
  /** Hours from filed to the first teammate action, for items filed in the range. */
  firstResponse: timeDistribution,
  /** Hours from filed to resolved, for items resolved in the range. */
  resolveTime: timeDistribution,
  /** Active review rounds, most urgent first. */
  rounds: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      projectId: z.string(),
      projectName: z.string(),
      dueAt: z.string().nullable(),
      total: count,
      closed: count,
      requireSignoff: z.boolean(),
      signoff: z.enum(["none", "approved", "changes_requested"]),
    }),
  ),
  /**
   * Possible regressions: new reports that look like a resolved item (ADR 0029). `total` is the ones filed in the
   * range, `open` those still being worked on; `items` the newest.
   */
  regressions: z.object({
    total: count,
    open: count,
    items: z.array(
      z.object({
        id: z.string(),
        number: z.number().int(),
        title: z.string().nullable(),
        status: feedbackStatus,
        projectId: z.string(),
        projectName: z.string(),
        confidence: z.enum(["possible", "likely"]),
        /** The resolved item it may be a regression of. */
        ofId: z.string(),
        ofNumber: z.number().int(),
        createdAt: z.string(),
      }),
    ),
  }),
  /** Releases with the items fixed in them and the regressions reported from them, newest release first. */
  releases: z.array(
    z.object({
      id: z.string(),
      version: z.string(),
      projectId: z.string(),
      projectName: z.string(),
      deployedAt: z.string(),
      fixed: count,
      regressions: count,
    }),
  ),
  /** Who filed the most (items filed in the range). */
  reporters: z.array(z.object({ id: z.string(), name: z.string(), count, resolved: count })),
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
