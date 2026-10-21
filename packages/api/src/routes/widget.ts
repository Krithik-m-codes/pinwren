import { isOriginAllowed, normalizePageUrl, widgetCommentCreate, widgetFeedbackCreate } from "@annota/core";
import { activity, comment, diagnostics, feedback, feedbackAsset, getDb, page, project } from "@annota/db";
import { zValidator } from "@hono/zod-validator";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { env } from "../env";
import { ApiError, notFound } from "../errors";
import { consume } from "../rate-limit";
import { decodeImageDataUrl, storage } from "../storage";

const LAST_SEEN_INTERVAL_MS = 60_000;

type WidgetVars = { project: typeof project.$inferSelect; origin: string };

const corsHeaders = (origin: string) => ({
  "access-control-allow-origin": origin,
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-annota-key",
  "access-control-max-age": "600",
  vary: "Origin",
});

function clientIp(c: Context): string {
  if (env().ANNOTA_TRUST_PROXY) {
    const fwd = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    if (fwd) return fwd;
  }
  return c.req.header("x-real-ip") ?? "unknown";
}

/**
 * Public widget API (blueprint 04 §2). Authenticated by the public project key plus the browser's
 * Origin, which must be on the project's allowlist. No secret ever reaches the browser.
 */
export const widget = new Hono<{ Variables: WidgetVars }>()
  .options("*", (c) => {
    const origin = c.req.header("origin");
    return origin ? c.body(null, 204, corsHeaders(origin)) : c.body(null, 204);
  })
  .use("*", async (c, next) => {
    const key = c.req.header("x-annota-key") ?? c.req.query("key");
    const origin = c.req.header("origin");
    if (!key) throw new ApiError(401, "MISSING_PROJECT_KEY", "x-annota-key header is required");
    const [p] = await getDb()
      .select()
      .from(project)
      .where(and(eq(project.publicKey, key), isNull(project.archivedAt)));
    if (!p) throw new ApiError(401, "INVALID_PROJECT_KEY", "Unknown project key");
    if (!origin || !isOriginAllowed(origin, p.allowedOrigins)) {
      throw new ApiError(403, "ORIGIN_NOT_ALLOWED", "This site is not on the project's allowed origins");
    }
    c.set("project", p);
    c.set("origin", origin);
    await next();
    for (const [k, v] of Object.entries(corsHeaders(origin))) c.res.headers.set(k, v);
  })

  .get("/config", async (c) => {
    const p = c.var.project;
    // Mark the project as installed — powers the dashboard's live "verify install" check.
    // Only write when stale: an UPDATE on every widget load turns the project row into a lock hot
    // spot under traffic (found by the k6 load test).
    if (!p.lastSeenAt || Date.now() - p.lastSeenAt.getTime() > LAST_SEEN_INTERVAL_MS) {
      await getDb().update(project).set({ lastSeenAt: new Date() }).where(eq(project.id, p.id));
    }
    return c.json({
      project: { name: p.name, publicRead: p.publicRead },
      widget: p.widgetConfig,
      capture: p.captureConfig,
    });
  })

  .get("/feedback", async (c) => {
    const p = c.var.project;
    if (!p.publicRead) return c.json({ items: [] });
    const url = c.req.query("url");
    const where = [eq(feedback.projectId, p.id), isNull(feedback.deletedAt)];
    // Closed items stay off the page unless asked for; the widget only pins what is still open.
    if (c.req.query("include") !== "closed") {
      where.push(inArray(feedback.status, ["open", "in_progress", "in_review"]));
    }
    if (url) {
      const [pg] = await getDb()
        .select({ id: page.id })
        .from(page)
        .where(and(eq(page.projectId, p.id), eq(page.url, normalizePageUrl(url))));
      if (!pg) return c.json({ items: [] });
      where.push(eq(feedback.pageId, pg.id));
    }
    const items = await getDb()
      .select({
        id: feedback.id,
        number: feedback.number,
        kind: feedback.kind,
        status: feedback.status,
        body: sql<string>`left(${feedback.body}, 500)`,
        anchor: feedback.anchor,
        createdAt: feedback.createdAt,
        reporterName: sql<string | null>`${feedback.reporterGuest}->>'name'`,
        replyCount: sql<number>`(select count(*)::int from ${comment} cm where cm.feedback_id = ${feedback.id} and cm.visibility = 'public')`,
      })
      .from(feedback)
      .where(and(...where))
      .orderBy(desc(feedback.createdAt))
      .limit(100);
    return c.json({ items });
  })

  .get("/feedback/:id/comments", async (c) => {
    const p = c.var.project;
    if (!p.publicRead) throw notFound("Feedback");
    const items = await getDb()
      .select({
        id: comment.id,
        body: comment.body,
        createdAt: comment.createdAt,
        authorName: sql<
          string | null
        >`coalesce((select name from "user" u where u.id = ${comment.authorId}), ${comment.authorGuest}->>'name')`,
        team: sql<boolean>`${comment.authorId} is not null`,
      })
      .from(comment)
      .innerJoin(feedback, eq(feedback.id, comment.feedbackId))
      .where(
        and(
          eq(comment.feedbackId, c.req.param("id")),
          eq(feedback.projectId, p.id),
          eq(comment.visibility, "public"),
        ),
      )
      .orderBy(asc(comment.createdAt));
    return c.json({ items });
  })

  .post("/feedback", zValidator("json", widgetFeedbackCreate), async (c) => {
    const p = c.var.project;
    const input = c.req.valid("json");
    const ip = clientIp(c);
    if (!(await consume(`w:${p.id}:${ip}`, env().WIDGET_RATE_LIMIT_PER_MIN, 60))) {
      throw new ApiError(429, "RATE_LIMITED", "Too many reports — try again in a minute");
    }

    const db = getDb();
    // Idempotency: the widget retries with the same clientId after a network failure.
    const [existing] = await db
      .select()
      .from(feedback)
      .where(and(eq(feedback.projectId, p.id), eq(feedback.clientId, input.clientId)));
    if (existing) return c.json({ feedback: { id: existing.id, number: existing.number } }, 200);

    let shot: ReturnType<typeof decodeImageDataUrl> | null = null;
    if (input.screenshot) {
      try {
        shot = decodeImageDataUrl(input.screenshot);
      } catch (err) {
        throw new ApiError(
          400,
          "INVALID_SCREENSHOT",
          err instanceof Error ? err.message : "Invalid screenshot",
        );
      }
    }
    const pageUrl = normalizePageUrl(input.page.url);

    // Resolve the page outside the transaction and without touching an existing row: an upsert
    // that updates the row locks it, and every report on a busy page would queue behind it.
    const [inserted] = await db
      .insert(page)
      .values({
        orgId: p.orgId,
        projectId: p.id,
        url: pageUrl,
        urlPattern: input.page.urlPattern,
        title: input.page.title,
      })
      .onConflictDoNothing({ target: [page.projectId, page.url] })
      .returning({ id: page.id });
    const pageId =
      inserted?.id ??
      (
        await db
          .select({ id: page.id })
          .from(page)
          .where(and(eq(page.projectId, p.id), eq(page.url, pageUrl)))
      )[0]?.id;

    // Write the screenshot before opening the transaction, so the per-project counter row is
    // locked only for a few inserts, never for disk I/O.
    let asset: { key: string; contentType: string; bytes: number } | null = null;
    if (shot) {
      const ext = shot.contentType === "image/jpeg" ? "jpg" : shot.contentType.split("/")[1];
      asset = {
        key: `${p.id}/${crypto.randomUUID()}.${ext}`,
        contentType: shot.contentType,
        bytes: shot.bytes.length,
      };
      await storage().put(asset.key, shot.bytes, shot.contentType);
    }

    // One statement allocates the per-project number and writes the report with its diagnostics,
    // screenshot record and activity entry. The counter row is locked only for the length of this
    // statement; with separate round trips a busy event loop held it long enough for reports to
    // queue behind each other (k6 load test: ~30 connections waiting on that one row).
    const json = (v: unknown) => (v === undefined || v === null ? null : JSON.stringify(v));
    const diag = input.diagnostics;
    let created: { id: string; number: number } | undefined;
    try {
      const rows = await db.execute<{ id: string; number: number }>(sql`
        with counter as (
          update ${project} set feedback_counter = feedback_counter + 1
          where id = ${p.id}
          returning feedback_counter as n
        ), f as (
          insert into ${feedback}
            (org_id, project_id, page_id, number, kind, title, body, priority, client_id,
             anchor, environment, metadata, reporter_guest)
          select ${p.orgId}, ${p.id}, ${pageId ?? null}, counter.n, ${input.kind}::feedback_kind,
             ${input.title ?? null}, ${input.body}, ${input.priority ?? "none"}::priority, ${input.clientId},
             ${json(input.anchor)}::jsonb, ${json(input.environment)}::jsonb, ${json(input.metadata)}::jsonb,
             ${json(input.reporter)}::jsonb
          from counter
          returning id, number
        ), d as (
          insert into ${diagnostics} (feedback_id, console, network)
          select f.id, ${json(diag?.console)}::jsonb, ${json(diag?.network)}::jsonb
          from f where ${diag !== undefined}
        ), a as (
          insert into ${feedbackAsset} (org_id, feedback_id, kind, storage_key, content_type, bytes)
          select ${p.orgId}, f.id, 'screenshot', ${asset?.key ?? ""}, ${asset?.contentType ?? ""}, ${asset?.bytes ?? 0}
          from f where ${asset !== null}
        ), act as (
          insert into ${activity} (org_id, feedback_id, actor_kind, type, data)
          select ${p.orgId}, f.id, 'guest', 'created', '{"source":"widget"}'::jsonb from f
        )
        select id, number from f
      `);
      created = rows[0];
      if (!created) throw new Error("insert failed");
    } catch (err) {
      if (asset)
        await storage()
          .remove(asset.key)
          .catch(() => {});
      // Two retries of the same report racing each other: the unique (project, clientId) index
      // lets exactly one win; answer the other with the stored record.
      const [dup] = await db
        .select({ id: feedback.id, number: feedback.number })
        .from(feedback)
        .where(and(eq(feedback.projectId, p.id), eq(feedback.clientId, input.clientId)));
      if (dup) return c.json({ feedback: dup }, 200);
      throw err;
    }

    return c.json({ feedback: { id: created.id, number: created.number } }, 201);
  })

  .post("/feedback/:id/comments", zValidator("json", widgetCommentCreate), async (c) => {
    const p = c.var.project;
    if (!p.publicRead) throw notFound("Feedback");
    if (!(await consume(`wc:${p.id}:${clientIp(c)}`, env().WIDGET_RATE_LIMIT_PER_MIN, 60))) {
      throw new ApiError(429, "RATE_LIMITED", "Too many replies — try again in a minute");
    }
    const db = getDb();
    const [f] = await db
      .select({ id: feedback.id })
      .from(feedback)
      .where(and(eq(feedback.id, c.req.param("id")), inArray(feedback.projectId, [p.id])));
    if (!f) throw notFound("Feedback");
    const body = c.req.valid("json");
    const [created] = await db
      .insert(comment)
      .values({
        orgId: p.orgId,
        feedbackId: f.id,
        body: body.body,
        authorGuest: body.author ?? null,
        visibility: "public",
      })
      .returning({ id: comment.id, createdAt: comment.createdAt });
    return c.json({ comment: created }, 201);
  });
