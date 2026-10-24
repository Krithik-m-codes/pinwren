import { labelCreate, labelUpdate, MAX_LABELS_PER_PROJECT } from "@pinwren/core";
import { feedback, feedbackLabel, getDb, label, project } from "@pinwren/db";
import { zValidator } from "@hono/zod-validator";
import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { SessionVars } from "../context";
import { ApiError, notFound } from "../errors";
import { requirePermission } from "../permissions";

// Per-project labels (F-051, wave-5 contract §3.4). Everyone reads them; Admins and Editors manage them
// (`labels.manage`). Items get labels through `PATCH /api/feedback/:id { labelIds }`. Mounted inside the
// dashboard router, so the session and the viewer guard apply.

const labelExists = () =>
  new ApiError(409, "LABEL_EXISTS", "This project already has a label with that name");

/** Postgres unique violation (the case-insensitive `label_project_name_uq`). */
const isUniqueViolation = (err: unknown) => {
  const e = err as { code?: string; cause?: { code?: string } };
  return (e.cause?.code ?? e.code) === "23505";
};

/** Normalise `#ABC` → `#aabbcc`, so equal colours compare equal. */
export function normalizeColor(hex: string): string {
  const h = hex.toLowerCase();
  return h.length === 4
    ? `#${h
        .slice(1)
        .split("")
        .map((c) => c + c)
        .join("")}`
    : h;
}

const labelOut = (l: typeof label.$inferSelect, n = 0) => ({
  id: l.id,
  name: l.name,
  color: l.color,
  count: n,
});

async function projectOf(orgId: string, id: string) {
  const [p] = await getDb()
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.id, id), eq(project.orgId, orgId)));
  if (!p) throw notFound("Project");
  return p;
}

async function labelOf(orgId: string, id: string) {
  const [l] = await getDb()
    .select()
    .from(label)
    .where(and(eq(label.id, id), eq(label.orgId, orgId)));
  if (!l) throw notFound("Label");
  return l;
}

export const labels = new Hono<{ Variables: SessionVars }>()
  /** `{ labels: { id, name, color, count }[] }`; `count` = live items carrying the label. */
  .get("/projects/:id/labels", async (c) => {
    const p = await projectOf(c.var.orgId, c.req.param("id"));
    const rows = await getDb()
      .select({ l: label, n: count(feedback.id) })
      .from(label)
      .leftJoin(feedbackLabel, eq(feedbackLabel.labelId, label.id))
      .leftJoin(feedback, and(eq(feedback.id, feedbackLabel.feedbackId), isNull(feedback.deletedAt)))
      .where(eq(label.projectId, p.id))
      .groupBy(label.id)
      .orderBy(asc(sql`lower(${label.name})`));
    return c.json({ labels: rows.map((r) => labelOut(r.l, r.n)) });
  })

  .post(
    "/projects/:id/labels",
    requirePermission("labels.manage"),
    zValidator("json", labelCreate),
    async (c) => {
      const p = await projectOf(c.var.orgId, c.req.param("id"));
      const body = c.req.valid("json");
      const db = getDb();
      const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(label).where(eq(label.projectId, p.id));
      if (n >= MAX_LABELS_PER_PROJECT) {
        throw new ApiError(
          400,
          "TOO_MANY_LABELS",
          `A project can have up to ${MAX_LABELS_PER_PROJECT} labels`,
        );
      }
      try {
        const [created] = await db
          .insert(label)
          .values({ orgId: c.var.orgId, projectId: p.id, name: body.name, color: normalizeColor(body.color) })
          .returning();
        if (!created) throw new Error("label insert failed");
        return c.json({ label: labelOut(created) }, 201);
      } catch (err) {
        if (isUniqueViolation(err)) throw labelExists();
        throw err;
      }
    },
  )

  .patch("/labels/:id", requirePermission("labels.manage"), zValidator("json", labelUpdate), async (c) => {
    const current = await labelOf(c.var.orgId, c.req.param("id"));
    const body = c.req.valid("json");
    const set: Partial<typeof label.$inferInsert> = {};
    if (body.name !== undefined) set.name = body.name;
    if (body.color !== undefined) set.color = normalizeColor(body.color);
    if (!Object.keys(set).length) return c.json({ label: labelOut(current) });
    try {
      const [updated] = await getDb().update(label).set(set).where(eq(label.id, current.id)).returning();
      if (!updated) throw notFound("Label");
      return c.json({ label: labelOut(updated) });
    } catch (err) {
      if (isUniqueViolation(err)) throw labelExists();
      throw err;
    }
  })

  /** Removes the label from every item too (cascade). */
  .delete("/labels/:id", requirePermission("labels.manage"), async (c) => {
    const current = await labelOf(c.var.orgId, c.req.param("id"));
    await getDb().delete(label).where(eq(label.id, current.id));
    return c.body(null, 204);
  });
