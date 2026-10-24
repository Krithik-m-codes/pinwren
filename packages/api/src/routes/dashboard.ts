import { randomBytes } from "node:crypto";
import {
  captureConfig,
  commentCreate,
  commentUpdate,
  feedbackListQuery,
  feedbackUpdate,
  mergeConfig,
  parseCaptureConfig,
  parseWidgetBranding,
  panelActionsFor,
  parseWidgetConfig,
  appRoleOf,
  projectUpdate,
  roleCan,
  trimTrailingSlashes,
  widgetBranding,
  widgetConfig,
} from "@pinwren/core";
import { activity, comment, feedback, getDb, project, user } from "@pinwren/db";
import { zValidator } from "@hono/zod-validator";
import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { z } from "zod";
import { isInstanceAdmin, isOrgAdmin, requireOrgAdmin, requireSession, type SessionVars } from "../context";
import { ApiError, forbidden, notFound } from "../errors";
import { assertFeatureWritable, publicEntitlements, resolveEntitlements } from "../license";
import { env } from "../env";
import { audienceOf, forbidViewerWrites, requirePermission } from "../permissions";
import { ensureActionSecret, rotateActionSecret, runPanelAction } from "../services/actions";
import { assetResponse } from "../services/assets";
import { ensureIdentitySecret, rotateIdentitySecret } from "../services/identity";
import { presetValues, projectCreateWithPreset, pruneRejected } from "../services/project-setup";
import { emit } from "../events";
import { exportFeedback, feedbackExportQuery } from "../export/feedback";
import {
  addTeamComment,
  getFeedbackDetail,
  listFeedback,
  purgeTrashed,
  restoreFeedback,
  trashFeedback,
  updateFeedback,
} from "../services/feedback";
import { reproductionContext } from "../services/reproduction";
import { getSecuritySettings } from "../settings/instance";
import { resolveSmtp } from "../email/config";
import { setupNeeded, signupOpen } from "../services/setup";
import { admin } from "./admin";
import { branding } from "./branding";
import { integrations } from "./integrations";
import { labels } from "./labels";
import { notifications } from "./notifications";
import { projectNotifications } from "./project-notifications";
import { realtime } from "./realtime";
import { rounds } from "./rounds";
import { tokens } from "./tokens";
import { webhooks } from "./webhooks";

export { ACTIVE_STATUSES } from "../services/feedback";

/** Same refusal as `requirePermission`, for checks that depend on the request (e.g. `?trash=1`). */
const forbiddenRole = () =>
  new ApiError(403, "FORBIDDEN_ROLE", "Your role doesn't allow this. Ask a workspace Admin.");

/** `assigneeId=me` ("My work", `/inbox?assignee=me`) is the signed-in member. */
const forCaller = <Q extends { assigneeId?: string | undefined }>(q: Q, userId: string): Q =>
  q.assigneeId === "me" ? { ...q, assigneeId: userId } : q;

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
    // The configured public URL (PINWREN_URL): install snippets use it, not the browser's address.
    publicUrl: trimTrailingSlashes(env().PINWREN_URL),
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

export const dashboard = new Hono<{ Variables: SessionVars }>()
  .use(requireSession)
  // Viewers (wave-4 contract §4) are refused every write before validation or any lookup runs.
  .use(forbidViewerWrites)

  // --- Me -----------------------------------------------------------------------------------------
  .get("/me", async (c) => {
    const [u] = await getDb()
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        emailVerified: user.emailVerified,
        twoFactorEnabled: user.twoFactorEnabled,
      })
      .from(user)
      .where(eq(user.id, c.var.userId));
    // Instance admins also learn whether a newer release exists ("Update available").
    const [instanceAdmin, needed, smtp, open] = await Promise.all([
      isInstanceAdmin(c.var.userId),
      setupNeeded(),
      resolveSmtp(),
      signupOpen(),
    ]);
    const update = instanceAdmin ? (await getSecuritySettings()).update : null;
    return c.json({
      user: u,
      orgId: c.var.orgId,
      role: c.var.role,
      // Wave-5 §3.1: the BugPin role (Admin / Editor / Viewer) for `roleCan` in the dashboard.
      appRole: appRoleOf(c.var.role),
      instanceAdmin,
      setupNeeded: needed,
      emailConfigured: smtp !== null,
      signupOpen: open,
      update: update?.available ? { latest: update.latest, url: update.url } : null,
    });
  })

  /** Licence state and the Enterprise features in force (F-098). Every member may read it. */
  .get("/me/entitlements", async (c) => c.json(publicEntitlements(await resolveEntitlements())))

  // Members and invitations: routes/members.ts (wave 5).

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

  // Creating a project is an Admin's job (wave-5 contract §3.7). `preset` answers "what is this site
  // for?" and picks the visibility defaults (services/project-setup.ts).
  .post(
    "/projects",
    requirePermission("projects.manage"),
    zValidator("json", projectCreateWithPreset),
    async (c) => {
      const { preset, ...body } = c.req.valid("json");
      const defaults = presetValues(preset);
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
          publicRead: defaults.publicRead,
          widgetConfig: defaults.widgetConfig,
        })
        .returning();
      if (!created) throw new Error("project insert failed");
      return c.json({ project: projectOut(created, c.var.role) }, 201);
    },
  )

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
      // "Allow" on a refused origin is this same PATCH: what the new list lets through leaves the list.
      if (rest.allowedOrigins) {
        const pruned = pruneRejected(current.rejectedOrigins, rest.allowedOrigins);
        if (pruned.length !== current.rejectedOrigins.length) set.rejectedOrigins = pruned;
      }
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
  // `?trash=1` lists the trash (Admins only, wave-5 contract §3.7).
  .get("/feedback", zValidator("query", feedbackListQuery), async (c) => {
    const q = c.req.valid("query");
    if (q.trash && !roleCan(c.var.role, "feedback.restore")) throw forbiddenRole();
    return c.json(await listFeedback(c.var.orgId, forCaller(q, c.var.userId)));
  })

  /** Every item matching the inbox filters (or `ids`), as CSV / JSON (streamed) or PDF. Before `/:id`. */
  .get("/feedback/export", zValidator("query", feedbackExportQuery), async (c) => {
    const q = c.req.valid("query");
    if (q.trash && !roleCan(c.var.role, "feedback.restore")) throw forbiddenRole();
    return exportFeedback(c.var.orgId, forCaller(q, c.var.userId));
  })

  .get("/feedback/:id", async (c) =>
    c.json(
      await getFeedbackDetail(c.var.orgId, c.req.param("id"), audienceOf(c.var.role), {
        userId: c.var.userId,
        // Admins can open an item in the trash (to restore it); for everyone else it's gone.
        includeDeleted: roleCan(c.var.role, "feedback.restore"),
      }),
    ),
  )

  /** "Copy as Markdown": the reproduction context the API and MCP serve, for the signed-in team. */
  .get("/feedback/:id/reproduction", async (c) =>
    c.json(await reproductionContext(c.var.orgId, c.req.param("id"))),
  )

  .patch(
    "/feedback/:id",
    requirePermission("feedback.update"),
    zValidator("json", feedbackUpdate),
    async (c) => {
      const updated = await updateFeedback(
        c.var.orgId,
        { kind: "user", userId: c.var.userId },
        c.req.param("id"),
        c.req.valid("json"),
      );
      return c.json({ feedback: updated });
    },
  )

  /** Move to the trash (Admins): activity row, `feedback.deleted` event, gone from open inboxes. */
  .delete("/feedback/:id", requirePermission("feedback.delete"), async (c) => {
    await trashFeedback(c.var.orgId, { kind: "user", userId: c.var.userId }, c.req.param("id"));
    return c.body(null, 204);
  })

  .post("/feedback/:id/restore", requirePermission("feedback.restore"), async (c) =>
    c.json({
      feedback: await restoreFeedback(c.var.orgId, { kind: "user", userId: c.var.userId }, c.req.param("id")),
    }),
  )

  /** Delete forever, with its files: only items already in the trash. */
  .delete("/feedback/:id/forever", requirePermission("feedback.delete"), async (c) => {
    await purgeTrashed(c.var.orgId, c.req.param("id"));
    return c.body(null, 204);
  })

  /** Run a webhook panel action (F-016): `{ ok, status, message, error }`, logged in the timeline. */
  .post("/feedback/:id/actions/:actionId", async (c) =>
    c.json(await runPanelAction(c.var.orgId, c.var.userId, c.req.param("id"), c.req.param("actionId"))),
  )

  .post(
    "/feedback/:id/comments",
    requirePermission("feedback.comment"),
    zValidator("json", commentCreate),
    async (c) => {
      const created = await addTeamComment(
        c.var.orgId,
        { kind: "user", userId: c.var.userId },
        c.req.param("id"),
        c.req.valid("json"),
      );
      return c.json({ comment: created }, 201);
    },
  )

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
    const body = c.req.valid("json").body;
    const [updated] = await db
      .update(comment)
      .set({ body, editedAt: new Date() })
      .where(eq(comment.id, id))
      .returning();
    // Webhooks, and open details elsewhere (stream `comment.updated`).
    if (body !== cm.body) {
      emit({
        type: "comment.updated",
        orgId: c.var.orgId,
        feedbackId: cm.feedbackId,
        commentId: id,
        actor: { kind: "user", id: c.var.userId },
        changes: { body: { from: cm.body, to: body } },
      });
    }
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
    // The row is gone, so the event carries what it was (wave-5 contract §3.4).
    emit({
      type: "comment.deleted",
      orgId: c.var.orgId,
      feedbackId: cm.feedbackId,
      commentId: id,
      actor: { kind: "user", id: c.var.userId },
      changes: { comment: { from: { id, body: cm.body, visibility: cm.visibility }, to: null } },
    });
    return c.body(null, 204);
  })

  // --- Assets (screenshots, attachments, replays: gzip JSON of rrweb events) ----------------------
  .get("/assets/:id", (c) => assetResponse(c.var.orgId, c.req.param("id")))

  .route("/", realtime)
  .route("/", notifications)
  .route("/", projectNotifications)
  .route("/", rounds)
  .route("/", labels)
  .route("/", webhooks)
  .route("/", tokens)
  .route("/", integrations)
  .route("/", branding)
  .route("/admin", admin);
