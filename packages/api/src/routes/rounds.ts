import {
  reviewRoundCreate,
  reviewRoundUpdate,
  roundExportQuery,
  savedViewCreate,
  savedViewUpdate,
} from "@pinwren/core";
import { getDb, savedView, user } from "@pinwren/db";
import { zValidator } from "@hono/zod-validator";
import { and, asc, eq, or } from "drizzle-orm";
import { Hono } from "hono";
import { isOrgAdmin, type SessionVars } from "../context";
import { forbidden, notFound } from "../errors";
import { isReadOnlyRole, readOnlyError, requirePermission } from "../permissions";
import { createRound, deleteRound, exportRound, getRound, listRounds, updateRound } from "../services/rounds";

type ViewRow = typeof savedView.$inferSelect;
const viewOut = (v: ViewRow, me: string, ownerName: string | null) => ({
  id: v.id,
  name: v.name,
  filters: v.filters,
  layout: v.layout,
  shared: v.shared,
  ownerId: v.ownerId,
  owner: { id: v.ownerId, name: ownerName },
  mine: v.ownerId === me,
  createdAt: v.createdAt,
  updatedAt: v.updatedAt,
});

/** Review rounds (F-055) and saved views — wave-4 contract §2. */
export const rounds = new Hono<{ Variables: SessionVars }>()
  .get("/projects/:id/rounds", async (c) =>
    c.json({ rounds: await listRounds(c.var.orgId, c.req.param("id")) }),
  )
  .post("/projects/:id/rounds", zValidator("json", reviewRoundCreate), async (c) =>
    c.json(
      { round: await createRound(c.var.orgId, c.req.param("id"), c.var.userId, c.req.valid("json")) },
      201,
    ),
  )
  .get("/rounds/:id", async (c) => c.json({ round: await getRound(c.var.orgId, c.req.param("id")) }))
  .patch("/rounds/:id", zValidator("json", reviewRoundUpdate), async (c) =>
    c.json({ round: await updateRound(c.var.orgId, c.req.param("id"), c.req.valid("json")) }),
  )
  // Deleting is Admin-only (wave-5 contract §3.7); the round's items stay, outside any round.
  .delete("/rounds/:id", requirePermission("feedback.delete"), async (c) => {
    await deleteRound(c.var.orgId, c.req.param("id"));
    return c.body(null, 204);
  })
  .get("/rounds/:id/export", zValidator("query", roundExportQuery), async (c) => {
    const out = await exportRound(c.var.orgId, c.req.param("id"), c.req.valid("query").format);
    return new Response(out.body, {
      headers: {
        "content-type": out.contentType,
        "content-disposition": `attachment; filename="${out.filename}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  })

  // --- Saved views ----------------------------------------------------------------------------------
  .get("/views", async (c) => {
    const rows = await getDb()
      .select({ v: savedView, ownerName: user.name })
      .from(savedView)
      .leftJoin(user, eq(user.id, savedView.ownerId))
      .where(
        and(
          eq(savedView.orgId, c.var.orgId),
          or(eq(savedView.shared, true), eq(savedView.ownerId, c.var.userId)),
        ),
      )
      .orderBy(asc(savedView.name));
    return c.json({ views: rows.map((r) => viewOut(r.v, c.var.userId, r.ownerName)) });
  })
  .post("/views", zValidator("json", savedViewCreate), async (c) => {
    const body = c.req.valid("json");
    // Viewers keep personal views; sharing one would change what the whole team sees.
    if (body.shared && isReadOnlyRole(c.var.role)) throw readOnlyError();
    const [v] = await getDb()
      .insert(savedView)
      .values({ orgId: c.var.orgId, ownerId: c.var.userId, ...body })
      .returning();
    if (!v) throw new Error("view insert failed");
    return c.json({ view: viewOut(v, c.var.userId, null) }, 201);
  })
  .patch("/views/:id", zValidator("json", savedViewUpdate), async (c) => {
    const db = getDb();
    const where = and(eq(savedView.id, c.req.param("id")), eq(savedView.orgId, c.var.orgId));
    const [current] = await db.select().from(savedView).where(where);
    if (!current || (!current.shared && current.ownerId !== c.var.userId)) throw notFound("View");
    const viewer = isReadOnlyRole(c.var.role);
    if (current.ownerId !== c.var.userId && (viewer || !isOrgAdmin(c.var.role))) {
      throw forbidden("Only the owner or an admin can change a shared view");
    }
    const patch = c.req.valid("json");
    if (viewer && patch.shared) throw readOnlyError();
    const set = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    const [v] = Object.keys(set).length
      ? await db.update(savedView).set(set).where(where).returning()
      : [current];
    if (!v) throw notFound("View");
    return c.json({ view: viewOut(v, c.var.userId, null) });
  })
  .delete("/views/:id", async (c) => {
    const db = getDb();
    const where = and(eq(savedView.id, c.req.param("id")), eq(savedView.orgId, c.var.orgId));
    const [current] = await db.select().from(savedView).where(where);
    if (!current || (!current.shared && current.ownerId !== c.var.userId)) throw notFound("View");
    if (current.ownerId !== c.var.userId && (isReadOnlyRole(c.var.role) || !isOrgAdmin(c.var.role))) {
      throw forbidden("Only the owner or an admin can delete a shared view");
    }
    await db.delete(savedView).where(where);
    return c.body(null, 204);
  });
