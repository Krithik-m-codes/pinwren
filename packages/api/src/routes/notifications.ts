import { preferencesFor, updateAccountPreferences } from "../db/accounts";
import {
  EMAIL_DIGEST_FREQUENCIES,
  notificationPreferenceInput,
  notificationsRead,
  userPreferenceUpdate,
} from "@pinwren/core";
import { feedback, getDb, notification, notificationPreference, project } from "@pinwren/db";
import { zValidator } from "@hono/zod-validator";
import { and, asc, count, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { SessionVars } from "../context";
import { resolveSmtp } from "../email/config";
import { notFound } from "../errors";
import { addWatchers, removeWatcher } from "../services/watchers";

// The bell, the notifications page, personal notification settings and following an item (wave-5
// contract §3.2). Mounted inside `dashboard` (session + viewer guard); every route here changes only the
// caller's own state, so viewers may use them (permissions.ts lists the writes).

const PREF_DEFAULTS = {
  newFeedback: true,
  assigned: true,
  replies: true,
  statusChanges: true,
  mentioned: true,
  priorityChanges: true,
  email: true,
};

/** Opaque cursor: the last row's `createdAt` and id, so rows created in the same millisecond still page. */
export const encodeCursor = (createdAt: Date, id: string) =>
  Buffer.from(`${createdAt.toISOString()}|${id}`).toString("base64url");

export function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const [iso, id, extra] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
    if (!iso || !id || extra !== undefined || !/^[0-9a-f-]{36}$/i.test(id)) return null;
    const createdAt = new Date(iso);
    return Number.isNaN(createdAt.getTime()) ? null : { createdAt, id };
  } catch {
    return null;
  }
}

const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1")
  .optional();

export const notificationListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  unread: bool,
  projectId: z.uuid().optional(),
  before: z.string().max(200).optional(),
});

/** Rows about items in the trash disappear, except the notice that an item was deleted. */
const notTrashed = or(
  isNull(notification.feedbackId),
  isNull(feedback.deletedAt),
  eq(notification.type, "feedback.deleted"),
);

export const notifications = new Hono<{ Variables: SessionVars }>()
  // --- Bell and notifications page -------------------------------------------------------------------
  .get("/notifications", zValidator("query", notificationListQuery), async (c) => {
    const { limit, unread, projectId, before } = c.req.valid("query");
    const db = getDb();
    const mine = and(eq(notification.userId, c.var.userId), eq(notification.orgId, c.var.orgId), notTrashed);
    const cursor = before ? decodeCursor(before) : null;
    const where = and(
      mine,
      unread ? isNull(notification.readAt) : undefined,
      projectId ? sql`${notification.data}->>'projectId' = ${projectId}` : undefined,
      cursor
        ? or(
            lt(notification.createdAt, cursor.createdAt),
            and(eq(notification.createdAt, cursor.createdAt), lt(notification.id, cursor.id)),
          )
        : undefined,
    );
    const [rows, [unreadRow]] = await Promise.all([
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
        .leftJoin(feedback, eq(feedback.id, notification.feedbackId))
        .where(where)
        .orderBy(desc(notification.createdAt), desc(notification.id))
        .limit(limit + 1),
      db
        .select({ n: count() })
        .from(notification)
        .leftJoin(feedback, eq(feedback.id, notification.feedbackId))
        .where(and(mine, isNull(notification.readAt))),
    ]);
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return c.json({
      items,
      unreadCount: unreadRow?.n ?? 0,
      nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null,
    });
  })

  .post("/notifications/read", zValidator("json", notificationsRead), async (c) => {
    const body = c.req.valid("json");
    // Scoped to the active workspace: "mark all read" must not clear another organisation's bell.
    const mine = and(
      eq(notification.userId, c.var.userId),
      eq(notification.orgId, c.var.orgId),
      isNull(notification.readAt),
    );
    const which =
      "ids" in body
        ? and(mine, inArray(notification.id, body.ids))
        : "feedbackId" in body
          ? and(mine, eq(notification.feedbackId, body.feedbackId))
          : mine;
    const rows = await getDb()
      .update(notification)
      .set({ readAt: new Date() })
      .where(which)
      .returning({ id: notification.id });
    return c.json({ updated: rows.length });
  })

  // --- Personal switches: per project (bell + email), and account-wide (digest, pause) ---------------
  .get("/notification-preferences", async (c) => {
    const [rows, smtp] = await Promise.all([
      getDb()
        .select({
          projectId: project.id,
          projectName: project.name,
          newFeedback: notificationPreference.newFeedback,
          assigned: notificationPreference.assigned,
          replies: notificationPreference.replies,
          statusChanges: notificationPreference.statusChanges,
          mentioned: notificationPreference.mentioned,
          priorityChanges: notificationPreference.priorityChanges,
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
        .orderBy(asc(project.name)),
      resolveSmtp(),
    ]);
    return c.json({
      preferences: rows.map((r) => ({
        projectId: r.projectId,
        projectName: r.projectName,
        newFeedback: r.newFeedback ?? PREF_DEFAULTS.newFeedback,
        assigned: r.assigned ?? PREF_DEFAULTS.assigned,
        replies: r.replies ?? PREF_DEFAULTS.replies,
        statusChanges: r.statusChanges ?? PREF_DEFAULTS.statusChanges,
        mentioned: r.mentioned ?? PREF_DEFAULTS.mentioned,
        priorityChanges: r.priorityChanges ?? PREF_DEFAULTS.priorityChanges,
        email: r.email ?? PREF_DEFAULTS.email,
      })),
      // "Email isn't set up on this server": the page says so instead of promising emails.
      emailConfigured: smtp !== null,
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
        mentioned: row.mentioned,
        priorityChanges: row.priorityChanges,
        email: row.email,
      },
    });
  })

  .get("/me/preferences", async (c) => {
    const row = await preferencesFor(c.var.userId);
    return c.json({
      preferences: {
        emailDigest: row?.emailDigest ?? EMAIL_DIGEST_FREQUENCIES[0],
        emailPaused: !!row?.emailPaused,
        locale: row?.locale ?? null,
      },
    });
  })

  .patch("/me/preferences", zValidator("json", userPreferenceUpdate), async (c) => {
    const patch = c.req.valid("json");
    const row = await updateAccountPreferences(c.var.userId, patch);
    if (!row) throw new Error("preference upsert failed");
    return c.json({ preferences: row });
  })

  // --- Follow an item (any member who can read it; viewers too) ------------------------------------
  .post("/feedback/:id/watch", async (c) => {
    const id = await liveItem(c.var.orgId, c.req.param("id"));
    await addWatchers(c.var.orgId, id, [c.var.userId]);
    return c.json({ watching: true });
  })

  .delete("/feedback/:id/watch", async (c) => {
    const id = await liveItem(c.var.orgId, c.req.param("id"));
    await removeWatcher(id, c.var.userId);
    return c.json({ watching: false });
  });

async function liveItem(orgId: string, id: string): Promise<string> {
  const [f] = await getDb()
    .select({ id: feedback.id })
    .from(feedback)
    .where(and(eq(feedback.id, id), eq(feedback.orgId, orgId), isNull(feedback.deletedAt)));
  if (!f) throw notFound("Feedback");
  return f.id;
}
