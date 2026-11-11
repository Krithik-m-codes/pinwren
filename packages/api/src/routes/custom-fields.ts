import { zValidator } from "@hono/zod-validator";
import { customFieldsReplace } from "@pinwren/core";
import { Hono } from "hono";
import type { SessionVars } from "../context";
import { unauthorized } from "../errors";
import { requirePermission } from "../permissions";
import { listFieldsOfProject, replaceFields } from "../services/custom-fields";

// Per-project custom fields and the form builder (ADR 0029). Everyone who can see the project reads the
// fields; Admins (`projects.manage`) save the whole form. Mounted after the dashboard router, so the
// session and viewer guards apply.
export const customFieldRoutes = new Hono<{ Variables: SessionVars }>()
  .use(async (c, next) => {
    if (!c.var.userId || !c.var.orgId) throw unauthorized();
    await next();
  })

  .get("/projects/:id/custom-fields", async (c) =>
    c.json({ fields: await listFieldsOfProject(c.var.orgId, c.req.param("id")) }),
  )

  .put(
    "/projects/:id/custom-fields",
    requirePermission("projects.manage"),
    zValidator("json", customFieldsReplace),
    async (c) => {
      const projectId = c.req.param("id");
      await listFieldsOfProject(c.var.orgId, projectId); // 404 for a project of another workspace
      return c.json({ fields: await replaceFields(c.var.orgId, projectId, c.req.valid("json").fields) });
    },
  );
