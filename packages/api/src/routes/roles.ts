import { customRoleCreate, customRoleUpdate } from "@pinwren/core";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { SessionVars } from "../context";
import { accessOf, requireAnyPermission, requirePermission } from "../permissions";
import { audit } from "../services/audit";
import { createRole, deleteRole, listRoles, updateRole } from "../services/custom-roles";

/**
 * Custom roles (F-093, ADR 0045). Reading the list also serves the role picker on Users, so anyone who may
 * manage roles or users can read; only `roles.manage` (Admins, never grantable) writes. Creating and editing
 * need the Enterprise `custom_roles` feature; deleting does not, so a lapsed workspace can still tidy up.
 */
export const rolesRoutes = new Hono<{ Variables: SessionVars }>()
  .get("/roles", requireAnyPermission("roles.manage", "users.manage"), async (c) =>
    c.json(await listRoles(c.var.orgId)),
  )
  .post("/roles", requirePermission("roles.manage"), zValidator("json", customRoleCreate), async (c) => {
    const role = await createRole(accessOf(c), c.var.orgId, c.var.userId, c.req.valid("json"));
    await audit(
      c,
      "role.created",
      { type: "role", id: role.id },
      { name: role.name, permissions: role.permissions },
    );
    return c.json({ role }, 201);
  })
  .patch("/roles/:id", requirePermission("roles.manage"), zValidator("json", customRoleUpdate), async (c) => {
    const { role, before, beforeName } = await updateRole(
      accessOf(c),
      c.var.orgId,
      c.req.param("id"),
      c.req.valid("json"),
    );
    await audit(
      c,
      "role.updated",
      { type: "role", id: role.id },
      {
        name: role.name,
        ...(beforeName !== role.name && { renamedFrom: beforeName }),
        added: role.permissions.filter((p) => !before.includes(p)),
        removed: before.filter((p) => !role.permissions.includes(p)),
      },
    );
    return c.json({ role });
  })
  .delete("/roles/:id", requirePermission("roles.manage"), async (c) => {
    const role = await deleteRole(c.var.orgId, c.req.param("id"));
    await audit(c, "role.deleted", { type: "role", id: role.id }, { name: role.name });
    return c.body(null, 204);
  });
