import { auditExportQuery, auditListQuery } from "@pinwren/core";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { SessionVars } from "../context";
import { requirePermission } from "../permissions";
import { audit, exportAudit, listAudit } from "../services/audit";

/** Audit log (F-092, ADR 0044): workspace Admins only, and only with the feature (Business / Enterprise). */
export const auditRoutes = new Hono<{ Variables: SessionVars }>()
  .get("/audit", requirePermission("audit.read"), zValidator("query", auditListQuery), async (c) =>
    c.json(await listAudit(c.var.orgId, c.req.valid("query"))),
  )
  .get("/audit/export", requirePermission("audit.read"), zValidator("query", auditExportQuery), async (c) => {
    const q = c.req.valid("query");
    const res = await exportAudit(c.var.orgId, q);
    // Reading the history in bulk is itself a security-relevant act.
    await audit(
      c,
      "audit.exported",
      { type: "audit" },
      { format: q.format, filters: { ...q, format: undefined } },
    );
    return res;
  });
