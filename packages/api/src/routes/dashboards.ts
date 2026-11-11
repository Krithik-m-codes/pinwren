import {
  dashboardCreate,
  dashboardDuplicate,
  dashboardListQuery,
  dashboardUpdate,
  uiStateUpdate,
  workspacePreferenceUpdate,
} from "@pinwren/core";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { SessionVars } from "../context";
import { notFound } from "../errors";
import {
  createDashboard,
  deleteDashboard,
  duplicateDashboard,
  listDashboards,
  uiStateOf,
  updateDashboard,
  updateUiState,
  updateWorkspacePreferences,
  workspacePreferences,
} from "../services/dashboards";

// Named and shared dashboards (ADR 0033), plus the small per-person state that used to live in the browser.
// Mounted inside the dashboard router, so the session and the viewer guard apply; viewers keep personal
// dashboards (see VIEWER_ALLOWED_MUTATIONS) but cannot publish.

const uuid = z.uuid();
/** A malformed id is a missing dashboard, not a server error. */
const idOf = (raw: string) => {
  const parsed = uuid.safeParse(raw);
  if (!parsed.success) throw notFound("Dashboard");
  return parsed.data;
};

export const dashboards = new Hono<{ Variables: SessionVars }>()
  .get("/dashboards", zValidator("query", dashboardListQuery), async (c) =>
    c.json({ dashboards: await listDashboards(c.var.orgId, c.var.userId, c.req.valid("query").scope) }),
  )
  .post("/dashboards", zValidator("json", dashboardCreate), async (c) =>
    c.json({ dashboard: await createDashboard(c.var, c.req.valid("json")) }, 201),
  )
  .patch("/dashboards/:id", zValidator("json", dashboardUpdate), async (c) =>
    c.json({ dashboard: await updateDashboard(c.var, idOf(c.req.param("id")), c.req.valid("json")) }),
  )
  .delete("/dashboards/:id", async (c) => {
    await deleteDashboard(c.var, idOf(c.req.param("id")));
    return c.body(null, 204);
  })
  .post("/dashboards/:id/duplicate", zValidator("json", dashboardDuplicate), async (c) =>
    c.json(
      { dashboard: await duplicateDashboard(c.var, idOf(c.req.param("id")), c.req.valid("json").name) },
      201,
    ),
  )

  // The default dashboard per screen and the pinned projects, for this person in this workspace.
  .get("/me/workspace-preferences", async (c) =>
    c.json({ preferences: await workspacePreferences(c.var.orgId, c.var.userId) }),
  )
  .patch("/me/workspace-preferences", zValidator("json", workspacePreferenceUpdate), async (c) =>
    c.json({ preferences: await updateWorkspacePreferences(c.var, c.req.valid("json")) }),
  )

  // Start page and dismissed prompts: account-wide, so they follow the person to every browser.
  .get("/me/ui-state", async (c) => c.json({ uiState: await uiStateOf(c.var.userId) }))
  .patch("/me/ui-state", zValidator("json", uiStateUpdate), async (c) =>
    c.json({ uiState: await updateUiState(c.var.userId, c.req.valid("json")) }),
  );
