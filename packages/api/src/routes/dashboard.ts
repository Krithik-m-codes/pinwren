import { randomBytes } from "node:crypto";
import {
  captureConfig,
  commentCreate,
  commentUpdate,
  feedbackListQuery,
  feedbackUpdate,
  mergeConfig,
  notificationPreferenceInput,
  notificationsRead,
  parseCaptureConfig,
  parseWidgetConfig,
  projectCreate,
  projectUpdate,
  widgetConfig,
} from "@annota/core";
import {
  activity,
  comment,
  feedback,
  feedbackAsset,
  getDb,
  invitation,
  member,
  notification,
  notificationPreference,
  project,
  user,
} from "@annota/db";
import { zValidator } from "@hono/zod-validator";
import { and, asc, count, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { z } from "zod";
import { isOrgAdmin, requireSession, type SessionVars } from "../context";
import { ApiError, forbidden, notFound } from "../errors";
import { addTeamComment, getFeedbackDetail, listFeedback, updateFeedback } from "../services/feedback";
import { storage } from "../storage";
import { admin } from "./admin";
import { tokens } from "./tokens";
import { webhooks } from "./webhooks";

export { ACTIVE_STATUSES } from "../services/feedback";

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

type ProjectRow = typeof project.$inferSelect;
/** Projects always go out with complete configs (defaults filled), so forms never see gaps. */
const projectOut = (p: ProjectRow) => ({
  ...p,
  widgetConfig: parseWidgetConfig(p.widgetConfig),
  captureConfig: parseCaptureConfig(p.captureConfig),
});

/** Merge a partial config onto the stored one and validate the result as a whole. */
function mergeAndValidate<S extends z.ZodType>(
  schema: S,
  current: unknown,
  patch: unknown,
  code: string,
): z.infer<S> {
  const parsed = schema.safeParse(mergeConfig(current, patch));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ApiError(
      400,
      code,
      issue ? `${issue.path.join(".") || "config"}: ${issue.message}` : "Invalid config",
    );
  }
  return parsed.data;
}

const PREF_DEFAULTS = { newFeedback: true, assigned: true, replies: true, statusChanges: true, email: true };

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

  /** Pending, unexpired invitations of the active organisation. Create/cancel via Better Auth. */
  .get("/invitations", async (c) => {
    const rows = await getDb()
      .select({
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        status: invitation.status,
        expiresAt: invitation.expiresAt,
        createdAt: invitation.createdAt,
        inviter: { id: user.id, name: user.name, email: user.email },
      })
      .from(invitation)
      .leftJoin(user, eq(user.id, invitation.inviterId))
      .where(
        and(
          eq(invitation.organizationId, c.var.orgId),
          eq(invitation.status, "pending"),
          gt(invitation.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(invitation.createdAt));
    return c.json({ invitations: rows });
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
    if (!created) throw new Error("project insert failed");
    return c.json({ project: projectOut(created) }, 201);
  })

  .get("/projects/:id", async (c) => {
    const [p] = await getDb()
      .select()
      .from(project)
      .where(and(eq(project.id, c.req.param("id")), eq(project.orgId, c.var.orgId)));
    if (!p) throw notFound("Project");
    return c.json({ project: projectOut(p) });
  })

  .patch("/projects/:id", zValidator("json", projectUpdate), async (c) => {
    const db = getDb();
    const { widgetConfig: widgetPatch, captureConfig: capturePatch, archived, ...rest } = c.req.valid("json");
    const where = and(eq(project.id, c.req.param("id")), eq(project.orgId, c.var.orgId));
    const [current] = await db.select().from(project).where(where);
    if (!current) throw notFound("Project");
    const set: Partial<typeof project.$inferInsert> = { ...rest };
    if (archived !== undefined) set.archivedAt = archived ? (current.archivedAt ?? new Date()) : null;
    if (widgetPatch) {
      set.widgetConfig = mergeAndValidate(
        widgetConfig,
        parseWidgetConfig(current.widgetConfig),
        widgetPatch,
        "INVALID_WIDGET_CONFIG",
      );
    }
    if (capturePatch) {
      set.captureConfig = mergeAndValidate(
        captureConfig,
        parseCaptureConfig(current.captureConfig),
        capturePatch,
        "INVALID_CAPTURE_CONFIG",
      );
    }
    if (!Object.keys(set).length) return c.json({ project: projectOut(current) });
    const [p] = await db.update(project).set(set).where(where).returning();
    if (!p) throw notFound("Project");
    return c.json({ project: projectOut(p) });
  })

  .post("/projects/:id/rotate-key", async (c) => {
    const [p] = await getDb()
      .update(project)
      .set({ publicKey: newPublicKey() })
      .where(and(eq(project.id, c.req.param("id")), eq(project.orgId, c.var.orgId)))
      .returning();
    if (!p) throw notFound("Project");
    return c.json({ project: projectOut(p) });
  })

  // --- Feedback ------------------------------------------------------------------------------------
  .get("/feedback", zValidator("query", feedbackListQuery), async (c) =>
    c.json(await listFeedback(c.var.orgId, c.req.valid("query"))),
  )

  .get("/feedback/:id", async (c) => c.json(await getFeedbackDetail(c.var.orgId, c.req.param("id"))))

  .patch("/feedback/:id", zValidator("json", feedbackUpdate), async (c) => {
    const updated = await updateFeedback(
      c.var.orgId,
      { kind: "user", userId: c.var.userId },
      c.req.param("id"),
      c.req.valid("json"),
    );
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
    const created = await addTeamComment(
      c.var.orgId,
      { kind: "user", userId: c.var.userId },
      c.req.param("id"),
      c.req.valid("json"),
    );
    return c.json({ comment: created }, 201);
  })

  // --- Comments: edit (author only) / delete (author or org admin) ----------------------------------
  .patch("/comments/:id", zValidator("json", commentUpdate), async (c) => {
    const db = getDb();
    const id = c.req.param("id");
    const [cm] = await db
      .select()
      .from(comment)
      .where(and(eq(comment.id, id), eq(comment.orgId, c.var.orgId)));
    if (!cm) throw notFound("Comment");
    if (cm.authorId !== c.var.userId) throw forbidden("Only the author can edit a comment");
    const [updated] = await db
      .update(comment)
      .set({ body: c.req.valid("json").body, editedAt: new Date() })
      .where(eq(comment.id, id))
      .returning();
    return c.json({ comment: updated });
  })

  .delete("/comments/:id", async (c) => {
    const db = getDb();
    const id = c.req.param("id");
    const [cm] = await db
      .select()
      .from(comment)
      .where(and(eq(comment.id, id), eq(comment.orgId, c.var.orgId)));
    if (!cm) throw notFound("Comment");
    if (cm.authorId !== c.var.userId && !isOrgAdmin(c.var.role)) {
      throw forbidden("Only the author or an admin can delete a comment");
    }
    await db.transaction(async (tx) => {
      await tx.delete(comment).where(eq(comment.id, id));
      await tx.insert(activity).values({
        orgId: c.var.orgId,
        feedbackId: cm.feedbackId,
        actorId: c.var.userId,
        type: "comment_deleted",
        data: { commentId: id, visibility: cm.visibility },
      });
    });
    return c.body(null, 204);
  })

  // --- Assets (screenshots, attachments) -----------------------------------------------------------
  .get("/assets/:id", async (c) => {
    const [a] = await getDb()
      .select()
      .from(feedbackAsset)
      .where(and(eq(feedbackAsset.id, c.req.param("id")), eq(feedbackAsset.orgId, c.var.orgId)));
    if (!a) throw notFound("Asset");
    const file = await storage().get(a.storageKey);
    if (!file) throw notFound("Asset file");
    const headers: Record<string, string> = {
      "content-type": a.contentType,
      "cache-control": "private, max-age=3600",
      "content-security-policy": "default-src 'none'; sandbox",
      "x-content-type-options": "nosniff",
    };
    if (file.bytes) headers["content-length"] = String(file.bytes);
    if (a.kind === "attachment") {
      // Non-images download rather than render (blueprint 09: Content-Disposition for non-images).
      const safe = (a.name ?? "attachment").replace(/[^\w.-]+/g, "_").slice(0, 120) || "attachment";
      const disposition = a.contentType.startsWith("image/") ? "inline" : "attachment";
      headers["content-disposition"] =
        `${disposition}; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(a.name ?? safe)}`;
    }
    return new Response(file.body, { headers });
  })

  // --- Notifications -------------------------------------------------------------------------------
  .get("/notifications", async (c) => {
    const db = getDb();
    const unreadOnly = c.req.query("unread") === "1" || c.req.query("unread") === "true";
    const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 50) || 50, 1), 100);
    const mine = and(eq(notification.userId, c.var.userId), eq(notification.orgId, c.var.orgId));
    const [items, [unread]] = await Promise.all([
      db
        .select({
          id: notification.id,
          type: notification.type,
          feedbackId: notification.feedbackId,
          data: notification.data,
          readAt: notification.readAt,
          createdAt: notification.createdAt,
        })
        .from(notification)
        .where(unreadOnly ? and(mine, isNull(notification.readAt)) : mine)
        .orderBy(desc(notification.createdAt))
        .limit(limit),
      db
        .select({ n: count() })
        .from(notification)
        .where(and(mine, isNull(notification.readAt))),
    ]);
    return c.json({ items, unreadCount: unread?.n ?? 0 });
  })

  .post("/notifications/read", zValidator("json", notificationsRead), async (c) => {
    const body = c.req.valid("json");
    const mine = and(eq(notification.userId, c.var.userId), isNull(notification.readAt));
    const rows = await getDb()
      .update(notification)
      .set({ readAt: new Date() })
      .where("ids" in body ? and(mine, inArray(notification.id, body.ids)) : mine)
      .returning({ id: notification.id });
    return c.json({ updated: rows.length });
  })

  .get("/notification-preferences", async (c) => {
    const rows = await getDb()
      .select({
        projectId: project.id,
        projectName: project.name,
        newFeedback: notificationPreference.newFeedback,
        assigned: notificationPreference.assigned,
        replies: notificationPreference.replies,
        statusChanges: notificationPreference.statusChanges,
        email: notificationPreference.email,
      })
      .from(project)
      .leftJoin(
        notificationPreference,
        and(
          eq(notificationPreference.projectId, project.id),
          eq(notificationPreference.userId, c.var.userId),
        ),
      )
      .where(and(eq(project.orgId, c.var.orgId), isNull(project.archivedAt)))
      .orderBy(asc(project.name));
    return c.json({
      preferences: rows.map((r) => ({
        projectId: r.projectId,
        projectName: r.projectName,
        newFeedback: r.newFeedback ?? PREF_DEFAULTS.newFeedback,
        assigned: r.assigned ?? PREF_DEFAULTS.assigned,
        replies: r.replies ?? PREF_DEFAULTS.replies,
        statusChanges: r.statusChanges ?? PREF_DEFAULTS.statusChanges,
        email: r.email ?? PREF_DEFAULTS.email,
      })),
    });
  })

  .put("/notification-preferences", zValidator("json", notificationPreferenceInput), async (c) => {
    const { projectId, ...patch } = c.req.valid("json");
    const db = getDb();
    const [p] = await db
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.id, projectId), eq(project.orgId, c.var.orgId)));
    if (!p) throw notFound("Project");
    const set = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    const [row] = await db
      .insert(notificationPreference)
      .values({ orgId: c.var.orgId, userId: c.var.userId, projectId, ...PREF_DEFAULTS, ...set })
      .onConflictDoUpdate({
        target: [notificationPreference.userId, notificationPreference.projectId],
        set: Object.keys(set).length ? set : { updatedAt: new Date() },
      })
      .returning();
    if (!row) throw new Error("preference upsert failed");
    return c.json({
      preference: {
        projectId: row.projectId,
        newFeedback: row.newFeedback,
        assigned: row.assigned,
        replies: row.replies,
        statusChanges: row.statusChanges,
        email: row.email,
      },
    });
  })

  .route("/", webhooks)
  .route("/", tokens)
  .route("/admin", admin);
