import {
  type DashboardStats,
  type DashboardStatsQuery,
  DEVICE_CLASSES,
  fillBuckets,
  CLOSED_STATUSES,
  fillSeries,
  TIME_BUCKET_LIMITS_H,
} from "@pinwren/core";
import { activity, feedback, getDb, page, project, projectRelease, reviewRound, user } from "@pinwren/db";
import { and, desc, eq, gte, inArray, isNotNull, isNull, type SQL, sql } from "drizzle-orm";
import { ACTIVE_STATUSES } from "./feedback";

const DAY = 86_400_000;

/** SQL `case` mapping an hours expression to its bucket index (see TIME_BUCKETS). */
const bucketCase = (hours: SQL) =>
  sql`case ${sql.join(
    TIME_BUCKET_LIMITS_H.map(
      (limit, i) => sql`when ${hours} < ${sql.raw(String(limit))} then ${sql.raw(String(i))}`,
    ),
    sql` `,
  )} else ${sql.raw(String(TIME_BUCKET_LIMITS_H.length))} end`;

/** Browser family / OS names come from the widget; blank ones are grouped as "Unknown". */
const envText = (field: "browser" | "os") =>
  sql<string>`coalesce(nullif(trim(${feedback.environment}->>${sql.raw(`'${field}'`)}), ''), 'Unknown')`;

/** Device class from the captured viewport width; keep in step with `deviceClass()` in @pinwren/core. */
const deviceExpr = sql<string>`case when (${feedback.environment}#>>'{viewport,w}') ~ '^[0-9]{1,5}$' then case when (${feedback.environment}#>>'{viewport,w}')::int < 768 then 'mobile' when (${feedback.environment}#>>'{viewport,w}')::int < 1024 then 'tablet' else 'desktop' end else 'unknown' end`;

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
        // Due date missed: still open and past due, or resolved (in the range) after it.
        slaBreached: sql<number>`count(*) filter (where ${feedback.dueAt} is not null and ((${active} and ${feedback.dueAt} < ${now.toISOString()}::timestamptz) or (${gte(feedback.resolvedAt, since)} and ${feedback.resolvedAt} > ${feedback.dueAt})))::int`,
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

  const [topPages, browsers, systems, devices, timing, rounds, reporters] = await extras(
    orgId,
    q.projectId,
    since,
    scope,
    active,
  );

  const releaseData = await releaseStats(orgId, q.projectId, since, scope, active);

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
      slaBreached: t?.slaBreached ?? 0,
    },
    byStatus: byStatus.map((r) => ({ key: r.key, count: r.count })),
    byKind: byKind.map((r) => ({ key: r.key, count: r.count })),
    byPriority: byPriority.map((r) => ({ key: r.key, count: r.count })),
    byProject,
    series: fillSeries([...rows.values()], q.days, now),
    topPages,
    browsers,
    operatingSystems: systems,
    devices: DEVICE_CLASSES.map((key) => ({
      key,
      count: devices.find((d) => d.key === key)?.count ?? 0,
    })).filter((d) => d.count > 0),
    firstResponse: timing.response,
    resolveTime: timing.resolve,
    rounds,
    ...releaseData,
    reporters,
    recent: recent.map((r) => ({ ...r, at: r.at.toISOString(), actor: r.actor })),
  };
}

/** The "Regressions" and "Fixed per release" widgets (ADR 0036); every query is filtered by the org id. */
async function releaseStats(
  orgId: string,
  projectId: string | undefined,
  since: Date,
  scope: SQL | undefined,
  active: SQL,
): Promise<Pick<DashboardStats, "regressions" | "releases">> {
  const db = getDb();
  const regressed = and(scope, isNotNull(feedback.regressionOfId));
  const rid = sql.raw(`"project_release"."id"`);
  const rorg = sql.raw(`"project_release"."org_id"`);
  const rproject = sql.raw(`"project_release"."project_id"`);
  const rversion = sql.raw(`"project_release"."version"`);
  const [totals, items, releases] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*) filter (where ${gte(feedback.createdAt, since)})::int`,
        open: sql<number>`count(*) filter (where ${active})::int`,
      })
      .from(feedback)
      .where(regressed),
    db
      .select({
        id: feedback.id,
        number: feedback.number,
        title: feedback.title,
        status: feedback.status,
        projectId: feedback.projectId,
        projectName: project.name,
        confidence: feedback.regressionConfidence,
        ofId: feedback.regressionOfId,
        ofNumber: sql<number>`(select o.number from feedback o where o.id = ${feedback.regressionOfId} and o.org_id = ${feedback.orgId})`,
        createdAt: feedback.createdAt,
      })
      .from(feedback)
      .innerJoin(project, and(eq(project.id, feedback.projectId), eq(project.orgId, feedback.orgId)))
      .where(regressed)
      .orderBy(desc(feedback.createdAt))
      .limit(8),
    db
      .select({
        id: projectRelease.id,
        version: projectRelease.version,
        projectId: projectRelease.projectId,
        projectName: project.name,
        deployedAt: projectRelease.deployedAt,
        fixed: sql<number>`(select count(*)::int from feedback f where f.fixed_in_release_id = ${rid} and f.org_id = ${rorg} and f.deleted_at is null)`,
        regressions: sql<number>`(select count(*)::int from feedback f where f.project_id = ${rproject} and f.org_id = ${rorg} and f.deleted_at is null and f.regression_of_id is not null and lower(f.metadata->>'release') = lower(${rversion}))`,
      })
      .from(projectRelease)
      .innerJoin(
        project,
        and(eq(project.id, projectRelease.projectId), eq(project.orgId, projectRelease.orgId)),
      )
      .where(
        and(
          eq(projectRelease.orgId, orgId),
          isNull(project.archivedAt),
          projectId ? eq(projectRelease.projectId, projectId) : undefined,
        ),
      )
      .orderBy(desc(projectRelease.deployedAt))
      .limit(8),
  ]);
  return {
    regressions: {
      total: totals[0]?.total ?? 0,
      open: totals[0]?.open ?? 0,
      items: items.flatMap((r) =>
        r.ofId && r.confidence
          ? [
              {
                id: r.id,
                number: r.number,
                title: r.title,
                status: r.status,
                projectId: r.projectId,
                projectName: r.projectName,
                confidence: r.confidence,
                ofId: r.ofId,
                ofNumber: r.ofNumber,
                createdAt: r.createdAt.toISOString(),
              },
            ]
          : [],
      ),
    },
    releases: releases.map((r) => ({ ...r, deployedAt: r.deployedAt.toISOString() })),
  };
}

type TimingRow = { metric: string; b: number | null; n: number; median: number | null };

/** The widgets that need their own queries (distributions, pages, rounds, reporters); all org-scoped. */
async function extras(
  orgId: string,
  projectId: string | undefined,
  since: Date,
  scope: SQL | undefined,
  active: SQL,
) {
  const db = getDb();
  const inRange = and(scope, gte(feedback.createdAt, since));
  const sinceIso = since.toISOString();
  const onProject = projectId ? sql`and f.project_id = ${projectId}` : sql``;
  const roundProject = projectId ? eq(reviewRound.projectId, projectId) : undefined;
  const closedList = sql.raw(CLOSED_STATUSES.map((x) => `'${x}'`).join(","));
  const who = sql<string>`coalesce(${feedback.reporterId}, lower(${feedback.reporterGuest}->>'email'), ${feedback.reporterGuest}->>'externalId')`;
  const rid = sql.raw(`"review_round"."id"`);
  const roundOrg = sql.raw(`"review_round"."org_id"`);
  const count = sql<number>`count(*)::int`;

  return Promise.all([
    db
      .select({
        url: page.url,
        count,
        active: sql<number>`count(*) filter (where ${active})::int`,
      })
      .from(feedback)
      .innerJoin(page, and(eq(page.id, feedback.pageId), eq(page.orgId, feedback.orgId)))
      .where(inRange)
      .groupBy(page.url)
      .orderBy(desc(count), page.url)
      .limit(8),
    db
      .select({ key: envText("browser"), count })
      .from(feedback)
      .where(inRange)
      .groupBy(sql`1`)
      .orderBy(desc(count))
      .limit(6),
    db
      .select({ key: envText("os"), count })
      .from(feedback)
      .where(inRange)
      .groupBy(sql`1`)
      .orderBy(desc(count))
      .limit(6),
    db
      .select({ key: deviceExpr, count })
      .from(feedback)
      .where(inRange)
      .groupBy(sql`1`)
      .then((rows) =>
        rows.filter((r): r is { key: (typeof DEVICE_CLASSES)[number]; count: number } =>
          (DEVICE_CLASSES as readonly string[]).includes(r.key),
        ),
      ),
    // First response = the first thing a teammate did with the item (any activity but its creation).
    db
      .execute<TimingRow>(
        sql`
          with base as (
            select f.created_at, f.resolved_at,
              (select min(a.created_at) from activity a
                where a.feedback_id = f.id and a.org_id = f.org_id and a.actor_id is not null and a.type <> 'created') as first_at
            from feedback f
            where f.org_id = ${orgId} and f.deleted_at is null ${onProject}
              and (f.created_at >= ${sinceIso}::timestamptz or f.resolved_at >= ${sinceIso}::timestamptz)
          ),
          resp as (
            select greatest(extract(epoch from (first_at - created_at)) / 3600, 0)::float8 as h
            from base where first_at is not null and created_at >= ${sinceIso}::timestamptz
          ),
          res as (
            select greatest(extract(epoch from (resolved_at - created_at)) / 3600, 0)::float8 as h
            from base where resolved_at is not null and resolved_at >= ${sinceIso}::timestamptz
          )
          select 'response' as metric, ${bucketCase(sql`h`)} as b, count(*)::int as n, null::float8 as median from resp group by 2
          union all
          select 'response_median', null, count(*)::int, percentile_cont(0.5) within group (order by h) from resp
          union all
          select 'resolve', ${bucketCase(sql`h`)}, count(*)::int, null from res group by 2
          union all
          select 'resolve_median', null, count(*)::int, percentile_cont(0.5) within group (order by h) from res`,
      )
      .then((rows) => timingOf(Array.from(rows))),
    db
      .select({
        id: reviewRound.id,
        name: reviewRound.name,
        projectId: reviewRound.projectId,
        projectName: project.name,
        dueAt: reviewRound.dueAt,
        requireSignoff: reviewRound.requireSignoff,
        total: sql<number>`(select count(*)::int from feedback f where f.round_id = ${rid} and f.org_id = ${roundOrg} and f.deleted_at is null)`,
        closed: sql<number>`(select count(*)::int from feedback f where f.round_id = ${rid} and f.org_id = ${roundOrg} and f.deleted_at is null and f.status in (${closedList}))`,
        signoff: sql<
          "none" | "approved" | "changes_requested"
        >`coalesce((select s.decision from round_signoff s where s.round_id = ${rid} and s.org_id = ${roundOrg} order by s.created_at desc limit 1), 'none')`,
      })
      .from(reviewRound)
      .innerJoin(project, and(eq(project.id, reviewRound.projectId), eq(project.orgId, reviewRound.orgId)))
      .where(
        and(
          eq(reviewRound.orgId, orgId),
          eq(reviewRound.status, "active"),
          isNull(project.archivedAt),
          roundProject,
        ),
      )
      .orderBy(sql`${reviewRound.dueAt} asc nulls last`, desc(reviewRound.createdAt))
      .limit(6)
      .then((rows) => rows.map((r) => ({ ...r, dueAt: r.dueAt?.toISOString() ?? null }))),
    db
      .select({
        id: who,
        name: sql<
          string | null
        >`max(coalesce(${user.name}, ${feedback.reporterGuest}->>'name', ${feedback.reporterGuest}->>'email'))`,
        count,
        resolved: sql<number>`count(*) filter (where ${feedback.resolvedAt} is not null)::int`,
      })
      .from(feedback)
      .leftJoin(user, eq(user.id, feedback.reporterId))
      .where(and(inRange, sql`${who} is not null`))
      .groupBy(who)
      .orderBy(desc(count))
      .limit(8)
      .then((rows) => rows.map((r) => ({ ...r, name: r.name ?? "Anonymous" }))),
  ]);
}

/** Rows of the timing query to the two distributions. */
function timingOf(rows: TimingRow[]) {
  const dist = (metric: "response" | "resolve") => {
    const median = rows.find((r) => r.metric === `${metric}_median`);
    return {
      sample: median?.n ?? 0,
      medianHours: median?.median == null ? null : Math.round(median.median * 10) / 10,
      buckets: fillBuckets(
        rows
          .filter((r) => r.metric === metric && r.b !== null)
          .map((r) => ({ index: Number(r.b), count: r.n })),
      ),
    };
  };
  return { response: dist("response"), resolve: dist("resolve") };
}
