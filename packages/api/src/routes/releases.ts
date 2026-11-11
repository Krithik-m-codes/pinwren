import { zValidator } from "@hono/zod-validator";
import { releaseCreate, releaseUpdate } from "@pinwren/core";
import { Hono } from "hono";
import type { SessionVars } from "../context";
import { unauthorized } from "../errors";
import { requirePermission } from "../permissions";
import { deleteRelease, listReleases, recordRelease, updateRelease } from "../services/releases";

// Releases of a project (ADR 0033). Everyone who can see the project reads them; Admins (`projects.manage`)
// record, correct and delete them. CI records them through `POST /api/v1/projects/:id/releases`. Mounted after
// the dashboard router, so the session and viewer guards apply.

export const releaseRoutes = new Hono<{ Variables: SessionVars }>()
  .use(async (c, next) => {
    if (!c.var.userId || !c.var.orgId) throw unauthorized();
    await next();
  })

  .get("/projects/:id/releases", async (c) =>
    c.json({ releases: await listReleases(c.var.orgId, c.req.param("id")) }),
  )

  .post(
    "/projects/:id/releases",
    requirePermission("projects.manage"),
    zValidator("json", releaseCreate),
    async (c) => {
      const out = await recordRelease(c.var.orgId, c.var.userId, c.req.param("id"), c.req.valid("json"));
      return c.json(out, out.created ? 201 : 200);
    },
  )

  .patch(
    "/releases/:id",
    requirePermission("projects.manage"),
    zValidator("json", releaseUpdate),
    async (c) =>
      c.json({ release: await updateRelease(c.var.orgId, c.req.param("id"), c.req.valid("json")) }),
  )

  .delete("/releases/:id", requirePermission("projects.manage"), async (c) => {
    await deleteRelease(c.var.orgId, c.req.param("id"));
    return c.body(null, 204);
  });
