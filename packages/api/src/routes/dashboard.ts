import { randomBytes } from "node:crypto";
import {
  commentCreate,
  feedbackListQuery,
  feedbackUpdate,
  isClosedStatus,
  projectCreate,
  projectUpdate,
} from "@annota/core";
import {
  activity,
  comment,
  diagnostics,
  feedback,
  feedbackAsset,
  getDb,
  member,
  page,
  project,
  user,
} from "@annota/db";
import { zValidator } from "@hono/zod-validator";
import { and, asc, count, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { Hono } from "hono";
import { requireSession, type SessionVars } from "../context";
import { notFound } from "../errors";
import { storage } from "../storage";

export const ACTIVE_STATUSES = ["open", "in_progress", "in_review"] as const;

export function newPublicKey() {
  return `pk_${randomBytes(18).toString("base64url")}`;
}

function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "project"
  );
}

export const dashboard = new Hono<{ Variables: SessionVars }>()
  .use(requireSession)

  // --- Me -----------------------------------------------------------------------------------------
  .get("/me", async (c) => {
    const [u] = await getDb()
      .select({ id: user.id, name: user.name, email: user.email, image: user.image })
      .from(user)
      .where(eq(user.id, c.var.userId));
    return c.json({ user: u, orgId: c.var.orgId, role: c.var.role });
  })

  .get("/members", async (c) => {
    const rows = await getDb()
      .select({ id: user.id, name: user.name, email: user.email, image: user.image, role: member.role })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(eq(member.organizationId, c.var.orgId))
      .orderBy(asc(user.name));
    return c.json({ members: rows });
  })

  // --- Projects ------------------------------------------------------------------------------------
  .get("/projects", async (c) => {
    const db = getDb();
    const rows = await db
      .select({
        id: project.id,
        name: project.name,
        slug: project.slug,
        publicKey: project.publicKey,
        allowedOrigins: project.allowedOrigins,
        publicRead: project.publicRead,
        lastSeenAt: project.lastSeenAt,
        createdAt: project.createdAt,
        openCount: sql<number>`(select count(*)::int from ${feedback} f where f.project_id = ${project.id}
          and f.deleted_at is null and f.status in ('open','in_progress','in_review'))`,
      })
      .from(project)
      .where(and(eq(project.orgId, c.var.orgId), isNull(project.archivedAt)))
      .orderBy(asc(project.name));
    return c.json({ projects: rows });
  })

  .post("/projects", zValidator("json", projectCreate), async (c) => {
    const body = c.req.valid("json");
    const db = getDb();
    const base = slugify(body.name);
    const [{ n } = { n: 0 }] = await db
      .select({ n: count() })
      .from(project)
      .where(and(eq(project.orgId, c.var.orgId), sql`${project.slug} like ${`${base}%`}`));
    const [created] = await db
      .insert(project)
      .values({
        orgId: c.var.orgId,
        name: body.name,
        slug: n ? `${base}-${n + 1}` : base,
        publicKey: newPublicKey(),
        allowedOrigins: body.allowedOrigins,
      })
      .returning();
    return c.json({ project: created }, 201);
  })

  .get("/projects/:id", async (c) => {
    const [p] = await getDb()
      .select()
      .from(project)
      .where(and(eq(project.id, c.req.param("id")), eq(project.orgId, c.var.orgId)));
    if (!p) throw notFound("Project");
    return c.json({ project: p });
  })

  .patch("/projects/:id", zValidator("json", projectUpdate), async (c) => {
    const [p] = await getDb()
      .update(project)
      .set(c.req.valid("json"))
      .where(and(eq(project.id, c.req.param("id")), eq(project.orgId, c.var.orgId)))
      .returning();
    if (!p) throw notFound("Project");
    return c.json({ project: p });
  })

  .post("/projects/:id/rotate-key", async (c) => {
    const [p] = await getDb()
      .update(project)
      .set({ publicKey: newPublicKey() })
      .where(and(eq(project.id, c.req.param("id")), eq(project.orgId, c.var.orgId)))
      .returning();
    if (!p) throw notFound("Project");
    return c.json({ project: p });
  })

  // --- Feedback ------------------------------------------------------------------------------------
  .get("/feedback", zValidator("query", feedbackListQuery), async (c) => {
    const q = c.req.valid("query");
    const where = [eq(feedback.orgId, c.var.orgId), isNull(feedback.deletedAt)];
    if (q.projectId) where.push(eq(feedback.projectId, q.projectId));
    if (q.status === "active") where.push(inArray(feedback.status, [...ACTIVE_STATUSES]));
    else if (q.status !== "all") where.push(eq(feedback.status, q.status));
    if (q.kind) where.push(eq(feedback.kind, q.kind));
    if (q.q) where.push(sql`${feedback.search} @@ plainto_tsquery('simple', ${q.q})`);
    if (q.cursor) where.push(lt(feedback.createdAt, new Date(q.cursor)));

    const rows = await getDb()
      .select({
        id: feedback.id,
        number: feedback.number,
        kind: feedback.kind,
        status: feedback.status,
        priority: feedback.priority,
        title: feedback.title,
        body: feedback.body,
        assigneeIds: feedback.assigneeIds,
        reporterGuest: feedback.reporterGuest,
        createdAt: feedback.createdAt,
        projectId: feedback.projectId,
        projectName: project.name,
        pageUrl: page.url,
        hasScreenshot: sql<boolean>`exists(select 1 from ${feedbackAsset} a where a.feedback_id = ${feedback.id})`,
        commentCount: sql<number>`(select count(*)::int from ${comment} cm where cm.feedback_id = ${feedback.id})`,
      })
      .from(feedback)
      .innerJoin(project, eq(project.id, feedback.projectId))
      .leftJoin(page, eq(page.id, feedback.pageId))
      .where(and(...where))
      .orderBy(desc(feedback.createdAt))
      .limit(q.limit + 1);

    const hasMore = rows.length > q.limit;
    const items = hasMore ? rows.slice(0, q.limit) : rows;
    const last = items.at(-1);
    return c.json({
      items,
      nextCursor: hasMore && last ? last.createdAt.toISOString() : null,
    });
  })

  .get("/feedback/:id", async (c) => {
    const db = getDb();
    const id = c.req.param("id");
    const [row] = await db
      .select({ f: feedback, projectName: project.name, pageUrl: page.url, pageTitle: page.title })
      .from(feedback)
      .innerJoin(project, eq(project.id, feedback.projectId))
      .leftJoin(page, eq(page.id, feedback.pageId))
      .where(and(eq(feedback.id, id), eq(feedback.orgId, c.var.orgId), isNull(feedback.deletedAt)));
    if (!row) throw notFound("Feedback");

    const [assets, comments, events, diag] = await Promise.all([
      db
        .select({ id: feedbackAsset.id, kind: feedbackAsset.kind, contentType: feedbackAsset.contentType })
        .from(feedbackAsset)
        .where(eq(feedbackAsset.feedbackId, id)),
      db
        .select({
          id: comment.id,
          body: comment.body,
          visibility: comment.visibility,
          createdAt: comment.createdAt,
          authorGuest: comment.authorGuest,
          author: { id: user.id, name: user.name, image: user.image },
        })
        .from(comment)
        .leftJoin(user, eq(user.id, comment.authorId))
        .where(eq(comment.feedbackId, id))
        .orderBy(asc(comment.createdAt)),
      db
        .select({
          id: activity.id,
          type: activity.type,
          data: activity.data,
          createdAt: activity.createdAt,
          actorName: user.name,
        })
        .from(activity)
        .leftJoin(user, eq(user.id, activity.actorId))
        .where(eq(activity.feedbackId, id))
        .orderBy(asc(activity.createdAt)),
      db.select().from(diagnostics).where(eq(diagnostics.feedbackId, id)),
    ]);

    return c.json({
      feedback: { ...row.f, projectName: row.projectName, pageUrl: row.pageUrl, pageTitle: row.pageTitle },
      assets,
      comments,
      activity: events,
      diagnostics: diag[0] ?? null,
    });
  })

  .patch("/feedback/:id", zValidator("json", feedbackUpdate), async (c) => {
    const db = getDb();
    const id = c.req.param("id");
    const patch = c.req.valid("json");
    const updated = await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(feedback)
        .where(and(eq(feedback.id, id), eq(feedback.orgId, c.var.orgId), isNull(feedback.deletedAt)))
        .for("update");
      if (!before) throw notFound("Feedback");

      const set: Partial<typeof feedback.$inferInsert> = { ...patch };
      if (patch.status && patch.status !== before.status) {
        set.resolvedAt = isClosedStatus(patch.status) ? new Date() : null;
      }
      const [after] = await tx.update(feedback).set(set).where(eq(feedback.id, id)).returning();

      const changes = Object.entries(patch).filter(
        ([k, v]) => JSON.stringify(before[k as keyof typeof before]) !== JSON.stringify(v),
      );
      if (changes.length) {
        await tx.insert(activity).values(
          changes.map(([field, to]) => ({
            orgId: c.var.orgId,
            feedbackId: id,
            actorId: c.var.userId,
            type: `${field}_changed`,
            data: { from: before[field as keyof typeof before] ?? null, to },
          })),
        );
      }
      return after;
    });
    return c.json({ feedback: updated });
  })

  .delete("/feedback/:id", async (c) => {
    const [f] = await getDb()
      .update(feedback)
      .set({ deletedAt: new Date() })
      .where(and(eq(feedback.id, c.req.param("id")), eq(feedback.orgId, c.var.orgId)))
      .returning({ id: feedback.id });
    if (!f) throw notFound("Feedback");
    return c.body(null, 204);
  })

  .post("/feedback/:id/comments", zValidator("json", commentCreate), async (c) => {
    const db = getDb();
    const id = c.req.param("id");
    const [f] = await db
      .select({ id: feedback.id })
      .from(feedback)
      .where(and(eq(feedback.id, id), eq(feedback.orgId, c.var.orgId)));
    if (!f) throw notFound("Feedback");
    const body = c.req.valid("json");
    const [created] = await db
      .insert(comment)
      .values({ orgId: c.var.orgId, feedbackId: id, authorId: c.var.userId, ...body })
      .returning();
    return c.json({ comment: created }, 201);
  })

  // --- Assets (screenshots) -------------------------------------------------------------------------
  .get("/assets/:id", async (c) => {
    const [a] = await getDb()
      .select()
      .from(feedbackAsset)
      .where(and(eq(feedbackAsset.id, c.req.param("id")), eq(feedbackAsset.orgId, c.var.orgId)));
    if (!a) throw notFound("Asset");
    const file = await storage().get(a.storageKey);
    if (!file) throw notFound("Asset file");
    return new Response(file.body, {
      headers: {
        "content-type": a.contentType,
        "content-length": String(file.bytes),
        "cache-control": "private, max-age=3600",
        "content-security-policy": "default-src 'none'; sandbox",
        "x-content-type-options": "nosniff",
      },
    });
  });
