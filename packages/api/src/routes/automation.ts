import { zValidator } from "@hono/zod-validator";
import { automationRuleCreate, automationRuleUpdate, automationTestRequest } from "@pinwren/core";
import { Hono } from "hono";
import { z } from "zod";
import type { SessionVars } from "../context";
import { unauthorized } from "../errors";
import { requirePermission } from "../permissions";
import {
  createRule,
  deleteRule,
  getRule,
  listRules,
  listRuns,
  testRule,
  updateRule,
} from "../services/automation";

// Per-project automation rules (WP-28). Everyone who can see the project reads them and the run log;
// Admins (`projects.manage`) create, edit, delete and dry-run them. Mounted after the dashboard router,
// so the session and viewer guards apply.

const runsQuery = z.object({
  ruleId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const automationRoutes = new Hono<{ Variables: SessionVars }>()
  .use(async (c, next) => {
    if (!c.var.userId || !c.var.orgId) throw unauthorized();
    await next();
  })

  .get("/projects/:id/automations", async (c) =>
    c.json({ rules: await listRules(c.var.orgId, c.req.param("id")) }),
  )

  .post(
    "/projects/:id/automations",
    requirePermission("projects.manage"),
    zValidator("json", automationRuleCreate),
    async (c) => {
      const rule = await createRule(c.var.orgId, c.var.userId, c.req.param("id"), c.req.valid("json"));
      return c.json({ rule }, 201);
    },
  )

  .get("/projects/:id/automation-runs", zValidator("query", runsQuery), async (c) => {
    const { ruleId, limit } = c.req.valid("query");
    return c.json({ runs: await listRuns(c.var.orgId, c.req.param("id"), ruleId, limit) });
  })

  .get("/automations/:id", async (c) => c.json({ rule: await getRule(c.var.orgId, c.req.param("id")) }))

  .patch(
    "/automations/:id",
    requirePermission("projects.manage"),
    zValidator("json", automationRuleUpdate),
    async (c) => c.json({ rule: await updateRule(c.var.orgId, c.req.param("id"), c.req.valid("json")) }),
  )

  .delete("/automations/:id", requirePermission("projects.manage"), async (c) => {
    await deleteRule(c.var.orgId, c.req.param("id"));
    return c.body(null, 204);
  })

  .post(
    "/automations/:id/test",
    requirePermission("projects.manage"),
    zValidator("json", automationTestRequest),
    async (c) => c.json(await testRule(c.var.orgId, c.req.param("id"), c.req.valid("json"))),
  );
