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
    await getDb().update(project).set({ lastSeenAt: new Date() }).where(eq(project.id, p.id));
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
        body: feedback.body,
        anchor: feedback.anchor,
        createdAt: feedback.createdAt,
        reporterName: sql<string | null>`${feedback.reporterGuest}->>'name'`,
        replyCount: sql<number>`(select count(*)::int from ${comment} cm where cm.feedback_id = ${feedback.id} and cm.visibility = 'public')`,
      })
      .from(feedback)
      .where(and(...where))
      .orderBy(desc(feedback.createdAt))
      .limit(200);
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

    const created = await db.transaction(async (tx) => {
      const [pg] = await tx
        .insert(page)
        .values({
          orgId: p.orgId,
          projectId: p.id,
          url: pageUrl,
          urlPattern: input.page.urlPattern,
          title: input.page.title,
        })
        .onConflictDoUpdate({
          target: [page.projectId, page.url],
          set: { lastSeenAt: new Date(), title: input.page.title ?? sql`${page.title}` },
        })
        .returning({ id: page.id });

      const [counter] = await tx
        .update(project)
        .set({ feedbackCounter: sql`${project.feedbackCounter} + 1` })
        .where(eq(project.id, p.id))
        .returning({ n: project.feedbackCounter });

      const [f] = await tx
        .insert(feedback)
        .values({
          orgId: p.orgId,
          projectId: p.id,
          pageId: pg?.id,
          number: counter?.n ?? 0,
          kind: input.kind,
          title: input.title,
          body: input.body,
          priority: input.priority ?? "none",
          clientId: input.clientId,
          anchor: input.anchor,
          environment: input.environment,
          metadata: input.metadata,
          reporterGuest: input.reporter,
        })
        .returning();
      if (!f) throw new Error("insert failed");

      if (input.diagnostics) {
        await tx.insert(diagnostics).values({
          feedbackId: f.id,
          console: input.diagnostics.console ?? null,
          network: input.diagnostics.network ?? null,
        });
      }
      if (shot) {
        const ext = shot.contentType.split("/")[1] === "jpeg" ? "jpg" : shot.contentType.split("/")[1];
        const key = `${p.id}/${crypto.randomUUID()}.${ext}`;
        await storage().put(key, shot.bytes, shot.contentType);
        await tx.insert(feedbackAsset).values({
          orgId: p.orgId,
          feedbackId: f.id,
          kind: "screenshot",
          storageKey: key,
          contentType: shot.contentType,
          bytes: shot.bytes.length,
        });
      }
      await tx.insert(activity).values({
        orgId: p.orgId,
        feedbackId: f.id,
        actorKind: "guest",
        type: "created",
        data: { source: "widget" },
      });
      return f;
    });

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
