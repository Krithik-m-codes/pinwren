import { type DashboardStats, type DashboardStatsQuery, fillSeries } from "@pinwren/core";
import { activity, feedback, getDb, project, user } from "@pinwren/db";
import { and, desc, eq, gte, inArray, isNull, type SQL, sql } from "drizzle-orm";
import { ACTIVE_STATUSES } from "./feedback";

const DAY = 86_400_000;

/**
 * The numbers behind the dashboards (`GET /api/stats`). Every query is filtered by the caller's org id on
 * `feedback` (and `project`/`activity`), so a `projectId` from another workspace simply matches nothing.
 */
export async function dashboardStats(
  orgId: string,
  userId: string,
  q: DashboardStatsQuery,
  now = new Date(),
): Promise<DashboardStats> {
  const db = getDb();
  const since = new Date(now.getTime() - q.days * DAY);
  const before = new Date(since.getTime() - q.days * DAY);
  const live: SQL[] = [eq(feedback.orgId, orgId), isNull(feedback.deletedAt)];
  if (q.projectId) live.push(eq(feedback.projectId, q.projectId));
  const scope = and(...live);
  const active = inArray(feedback.status, [...ACTIVE_STATUSES]);

  const [totalRow, byStatus, byKind, byPriority, created, resolved, byProject, recent] = await Promise.all([
    db
      .select({
        active: sql<number>`count(*) filter (where ${active})::int`,
        created: sql<number>`count(*) filter (where ${gte(feedback.createdAt, since)})::int`,
        previousCreated: sql<number>`count(*) filter (where ${gte(feedback.createdAt, before)} and ${feedback.createdAt} < ${since.toISOString()}::timestamptz)::int`,
        resolved: sql<number>`count(*) filter (where ${gte(feedback.resolvedAt, since)})::int`,
        unassigned: sql<number>`count(*) filter (where ${active} and cardinality(${feedback.assigneeIds}) = 0)::int`,
        overdue: sql<number>`count(*) filter (where ${active} and ${feedback.dueAt} < ${now.toISOString()}::timestamptz)::int`,
        mine: sql<number>`count(*) filter (where ${active} and ${userId} = any(${feedback.assigneeIds}))::int`,
        urgent: sql<number>`count(*) filter (where ${active} and ${feedback.priority} in ('urgent','high'))::int`,
        avgHours: sql<
          string | null
        >`avg(extract(epoch from (${feedback.resolvedAt} - ${feedback.createdAt})) / 3600) filter (where ${gte(feedback.resolvedAt, since)})`,
      })
      .from(feedback)
      .where(scope),
    db
      .select({ key: feedback.status, count: sql<number>`count(*)::int` })
      .from(feedback)
      .where(scope)
      .groupBy(feedback.status),
    db
      .select({ key: feedback.kind, count: sql<number>`count(*)::int` })
      .from(feedback)
      .where(and(scope, active))
      .groupBy(feedback.kind),
    db
      .select({ key: feedback.priority, count: sql<number>`count(*)::int` })
      .from(feedback)
      .where(and(scope, active))
      .groupBy(feedback.priority),
    db
      .select({
        date: sql<string>`to_char(date_trunc('day', ${feedback.createdAt} at time zone 'UTC'), 'YYYY-MM-DD')`,
        n: sql<number>`count(*)::int`,
      })
      .from(feedback)
      .where(and(scope, gte(feedback.createdAt, since)))
      .groupBy(sql`1`),
    db
      .select({
        date: sql<string>`to_char(date_trunc('day', ${feedback.resolvedAt} at time zone 'UTC'), 'YYYY-MM-DD')`,
        n: sql<number>`count(*)::int`,
      })
      .from(feedback)
      .where(and(scope, gte(feedback.resolvedAt, since)))
      .groupBy(sql`1`),
    q.projectId
      ? Promise.resolve([])
      : db
          .select({
            id: project.id,
            name: project.name,
            active: sql<number>`count(*) filter (where ${active})::int`,
            total: sql<number>`count(${feedback.id})::int`,
          })
          .from(project)
          .leftJoin(feedback, and(eq(feedback.projectId, project.id), isNull(feedback.deletedAt)))
          .where(and(eq(project.orgId, orgId), isNull(project.archivedAt)))
          .groupBy(project.id, project.name)
          .orderBy(desc(sql`3`), project.name)
          .limit(8),
    db
      .select({
        id: activity.id,
        type: activity.type,
        at: activity.createdAt,
        actor: user.name,
        feedbackId: feedback.id,
        projectId: feedback.projectId,
        number: feedback.number,
        title: feedback.title,
      })
      .from(activity)
      .innerJoin(feedback, and(eq(feedback.id, activity.feedbackId), eq(feedback.orgId, orgId)))
      .leftJoin(user, eq(user.id, activity.actorId))
      .where(and(eq(activity.orgId, orgId), scope))
      .orderBy(desc(activity.createdAt))
      .limit(10),
  ]);

  const t = totalRow[0];
  const rows = new Map<string, { date: string; created?: number; resolved?: number }>();
  for (const r of created) rows.set(r.date, { date: r.date, created: r.n });
  for (const r of resolved) rows.set(r.date, { ...rows.get(r.date), date: r.date, resolved: r.n });
  const avg = t?.avgHours == null ? null : Number(t.avgHours);

  return {
    days: q.days,
    totals: {
      active: t?.active ?? 0,
      created: t?.created ?? 0,
      previousCreated: t?.previousCreated ?? 0,
      resolved: t?.resolved ?? 0,
      unassigned: t?.unassigned ?? 0,
      overdue: t?.overdue ?? 0,
      mine: t?.mine ?? 0,
      urgent: t?.urgent ?? 0,
      avgResolutionHours: avg === null || Number.isNaN(avg) ? null : Math.round(avg * 10) / 10,
    },
    byStatus: byStatus.map((r) => ({ key: r.key, count: r.count })),
    byKind: byKind.map((r) => ({ key: r.key, count: r.count })),
    byPriority: byPriority.map((r) => ({ key: r.key, count: r.count })),
    byProject,
    series: fillSeries([...rows.values()], q.days, now),
    recent: recent.map((r) => ({ ...r, at: r.at.toISOString(), actor: r.actor })),
  };
}
