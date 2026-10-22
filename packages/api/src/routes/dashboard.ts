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
  parseWidgetBranding,
  panelActionsFor,
  parseWidgetConfig,
  projectCreate,
  projectUpdate,
  widgetBranding,
  widgetConfig,
} from "@pinwren/core";
import {
  activity,
  comment,
  feedback,
  getDb,
  invitation,
  member,
  notification,
  notificationPreference,
  project,
  user,
} from "@pinwren/db";
import { zValidator } from "@hono/zod-validator";
import { and, asc, count, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { z } from "zod";
import { isInstanceAdmin, isOrgAdmin, requireOrgAdmin, requireSession, type SessionVars } from "../context";
import { ApiError, forbidden, notFound } from "../errors";
import { assertFeatureWritable, publicEntitlements, resolveEntitlements } from "../license";
import { audienceOf, forbidViewerWrites } from "../permissions";
import { publishDeleted } from "../realtime/publish";
import { ensureActionSecret, rotateActionSecret, runPanelAction } from "../services/actions";
import { assetResponse } from "../services/assets";
import { ensureIdentitySecret, rotateIdentitySecret } from "../services/identity";
import { addTeamComment, getFeedbackDetail, listFeedback, updateFeedback } from "../services/feedback";
import { getSecuritySettings } from "../settings/instance";
import { admin } from "./admin";
import { branding } from "./branding";
import { integrations } from "./integrations";
import { realtime } from "./realtime";
import { rounds } from "./rounds";
import { tokens } from "./tokens";
import { webhooks } from "./webhooks";

export { ACTIVE_STATUSES } from "../services/feedback";

export function newPublicKey() {
  return `pk_${randomBytes(18).toString("base64url")}`;
}

/** Drop keys whose value is `undefined` (optional fields the request left out), so a patch names only real changes. */
function withoutUndefined<T extends object>(o: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };
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
/**
 * Projects always go out with complete configs (defaults filled), so forms never see gaps. The
 * action signing secret never does — only whether one exists.
 */
const projectOut = ({ actionSecret, identitySecret, ...p }: ProjectRow, role: string) => {
  const widget = parseWidgetConfig(p.widgetConfig);
  return {
    ...p,
    // Webhook action URLs only for org admins; team-only link URLs not for viewers (ADR 0021).
    widgetConfig: {
      ...widget,
      panelActions: panelActionsFor(widget.panelActions, audienceOf(role), "settings"),
    },
    captureConfig: parseCaptureConfig(p.captureConfig),
    widgetBranding: parseWidgetBranding(p.widgetBranding),
    hasActionSecret: actionSecret !== null,
    hasIdentitySecret: identitySecret !== null,
  };
};

/** Privacy mode shortens a "keep forever" retention to this (F-021). */
const PRIVACY_RETENTION_DAYS = 90;

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
  // Viewers (wave-4 contract §4) are refused every write before validation or any lookup runs.
  .use(forbidViewerWrites)

  // --- Me -----------------------------------------------------------------------------------------
  .get("/me", async (c) => {
    const [u] = await getDb()
      .select({ id: user.id, name: user.name, email: user.email, image: user.image })
      .from(user)
      .where(eq(user.id, c.var.userId));
    // Instance admins also learn whether a newer release exists ("Update available").
    const instanceAdmin = await isInstanceAdmin(c.var.userId);
    const update = instanceAdmin ? (await getSecuritySettings()).update : null;
    return c.json({
      user: u,
      orgId: c.var.orgId,
      role: c.var.role,
      instanceAdmin,
      update: update?.available ? { latest: update.latest, url: update.url } : null,
    });
  })

  /** Licence state and the Enterprise features in force (F-098). Every member may read it. */
  .get("/me/entitlements", async (c) => c.json(publicEntitlements(await resolveEntitlements())))

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
    return c.json({ project: projectOut(created, c.var.role) }, 201);
  })

  .get("/projects/:id", async (c) => {
    const [p] = await getDb()
      .select()
      .from(project)
      .where(and(eq(project.id, c.req.param("id")), eq(project.orgId, c.var.orgId)));
    if (!p) throw notFound("Project");
    return c.json({ project: projectOut(p, c.var.role) });
  })

  // Project settings (origins, widget config, panel actions, retention…) are configuration: org admins
  // only (ADR 0021) — a webhook panel action is an outbound request the server makes.
  .patch("/projects/:id", requireOrgAdmin, zValidator("json", projectUpdate), async (c) => {
    const db = getDb();
    const {
      widgetConfig: widgetPatch,
      captureConfig: capturePatch,
      widgetBranding: brandingPatch,
      archived,
      ...rest
    } = c.req.valid("json");
    const where = and(eq(project.id, c.req.param("id")), eq(project.orgId, c.var.orgId));
    // Read-merge-write under a row lock: two saves of different settings at the same moment (e.g. two
    // toggles in quick succession) must both land, not the last one overwrite the other's merge.
    const saved = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(project).where(where).for("update");
      if (!current) throw notFound("Project");
      const set: Partial<typeof project.$inferInsert> = withoutUndefined(rest);
      if (archived !== undefined) set.archivedAt = archived ? (current.archivedAt ?? new Date()) : null;
      if (widgetPatch) {
        const before = parseWidgetConfig(current.widgetConfig);
        const next = mergeAndValidate(widgetConfig, before, widgetPatch, "INVALID_WIDGET_CONFIG");
        set.widgetConfig = next;
        // Turning privacy mode on shortens "keep forever" to 90 days, unless this request sets it.
        if (
          next.privacyMode &&
          !before.privacyMode &&
          rest.retentionDays === undefined &&
          current.retentionDays === null
        ) {
          set.retentionDays = PRIVACY_RETENTION_DAYS;
        }
      }
      if (brandingPatch) {
        const before = parseWidgetBranding(current.widgetBranding);
        const next = mergeAndValidate(widgetBranding, before, brandingPatch, "INVALID_WIDGET_BRANDING");
        // "Hide Powered by" is white-label: stored either way (it only applies with the entitlement),
        // but frozen once an Enterprise licence is past its grace period.
        if (next.hidePoweredBy !== before.hidePoweredBy) await assertFeatureWritable("white_label");
        set.widgetBranding = next;
      }
      if (capturePatch) {
        set.captureConfig = mergeAndValidate(
          captureConfig,
          parseCaptureConfig(current.captureConfig),
          capturePatch,
          "INVALID_CAPTURE_CONFIG",
        );
      }
      if (!Object.keys(set).length) return current;
      const [p] = await tx.update(project).set(set).where(where).returning();
      if (!p) throw notFound("Project");
      return p;
    });
    return c.json({ project: projectOut(saved, c.var.role) });
  })

  .post("/projects/:id/rotate-key", requireOrgAdmin, async (c) => {
    const [p] = await getDb()
      .update(project)
      .set({ publicKey: newPublicKey() })
      .where(and(eq(project.id, c.req.param("id")), eq(project.orgId, c.var.orgId)))
      .returning();
    if (!p) throw notFound("Project");
    return c.json({ project: projectOut(p, c.var.role) });
  })

  /** The secret that signs webhook panel actions (created on first read). Org admins only. */
  .get("/projects/:id/action-secret", requireOrgAdmin, async (c) => {
    const [p] = await getDb()
      .select({ id: project.id, actionSecret: project.actionSecret })
      .from(project)
      .where(and(eq(project.id, c.req.param("id")), eq(project.orgId, c.var.orgId)));
    if (!p) throw notFound("Project");
    return c.json({ secret: await ensureActionSecret(p) });
  })

  .post("/projects/:id/action-secret/rotate", requireOrgAdmin, async (c) => {
    const [p] = await getDb()
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.id, c.req.param("id")), eq(project.orgId, c.var.orgId)));
    if (!p) throw notFound("Project");
    return c.json({ secret: await rotateActionSecret(p.id) });
  })

  /** Signed-identity secret (wave-4 contract §4), created on first read. Org admins only. */
  .get("/projects/:id/identity-secret", requireOrgAdmin, async (c) => {
    const [p] = await getDb()
      .select({ id: project.id, identitySecret: project.identitySecret })
      .from(project)
      .where(and(eq(project.id, c.req.param("id")), eq(project.orgId, c.var.orgId)));
    if (!p) throw notFound("Project");
    return c.json({ secret: await ensureIdentitySecret(p) });
  })

  /** New secret; signatures made with the old one stop verifying at once. */
  .post("/projects/:id/identity-secret/rotate", requireOrgAdmin, async (c) => {
    const [p] = await getDb()
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.id, c.req.param("id")), eq(project.orgId, c.var.orgId)));
    if (!p) throw notFound("Project");
    return c.json({ secret: await rotateIdentitySecret(p.id) });
  })

  // --- Feedback ------------------------------------------------------------------------------------
  .get("/feedback", zValidator("query", feedbackListQuery), async (c) =>
    c.json(await listFeedback(c.var.orgId, c.req.valid("query"))),
  )

  .get("/feedback/:id", async (c) =>
    c.json(await getFeedbackDetail(c.var.orgId, c.req.param("id"), audienceOf(c.var.role))),
  )

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
      .returning({ id: feedback.id, projectId: feedback.projectId });
    if (!f) throw notFound("Feedback");
    publishDeleted(c.var.orgId, f.projectId, f.id);
    return c.body(null, 204);
  })

  /** Run a webhook panel action (F-016): `{ ok, status, message, error }`, logged in the timeline. */
  .post("/feedback/:id/actions/:actionId", async (c) =>
    c.json(await runPanelAction(c.var.orgId, c.var.userId, c.req.param("id"), c.req.param("actionId"))),
  )

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

  // --- Assets (screenshots, attachments, replays: gzip JSON of rrweb events) ----------------------
  .get("/assets/:id", (c) => assetResponse(c.var.orgId, c.req.param("id")))

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

  .route("/", realtime)
  .route("/", rounds)
  .route("/", webhooks)
  .route("/", tokens)
  .route("/", integrations)
  .route("/", branding)
  .route("/admin", admin);
