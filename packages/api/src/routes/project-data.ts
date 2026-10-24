import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { SessionVars } from "../context";
import { enqueue, QUEUES } from "../jobs/boss";
import { requirePermission } from "../permissions";
import { eraseReporter, erasureLog, privacyErase } from "../services/privacy-erase";
import { exportDownload, getExport, requestExport } from "../services/project-export";
import { setupChecklist } from "../services/project-setup";

// Install and onboarding endpoints that don't fit the project handler block of routes/dashboard.ts
// (wave-5 contract §3.5). Mounted under /api after the dashboard, whose session and viewer guards cover
// these routes too (Hono runs a mounted router's `use` for every later route under the same prefix).

export const projectData = new Hono<{ Variables: SessionVars }>()
  /** First-run checklist on the inbox: every role may read it; the dashboard shows it to Admins. */
  .get("/setup-checklist", async (c) => c.json({ checklist: await setupChecklist(c.var.orgId) }))

  // --- Project data export (Admins) ------------------------------------------------------------------
  .get("/projects/:id/export", requirePermission("projects.manage"), async (c) =>
    c.json({ export: await getExport(c.var.orgId, c.req.param("id")) }),
  )
  .post("/projects/:id/export", requirePermission("projects.manage"), async (c) => {
    const projectId = c.req.param("id");
    const view = await requestExport(c.var.orgId, projectId, c.var.userId);
    await enqueue(QUEUES.projectExport, { orgId: c.var.orgId, projectId });
    return c.json({ export: view }, 202);
  })
  .get("/projects/:id/export/download", requirePermission("projects.manage"), async (c) =>
    exportDownload(c.var.orgId, c.req.param("id")),
  )

  // --- Erase a reporter's data (Admins) ---------------------------------------------------------------
  .post("/privacy/erase", requirePermission("settings.manage"), zValidator("json", privacyErase), async (c) =>
    c.json({ result: await eraseReporter(c.var.orgId, c.var.userId, c.req.valid("json")) }),
  )
  .get("/privacy/erasures", requirePermission("settings.manage"), async (c) =>
    c.json({ erasures: await erasureLog(c.var.orgId) }),
  );
