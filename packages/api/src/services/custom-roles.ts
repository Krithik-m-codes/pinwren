import {
  type Access,
  baseRoleForPermissions,
  type CustomRole,
  type CustomRoleCreate,
  type CustomRoleUpdate,
  CUSTOM_ROLE_MAX_PER_ORG,
  CUSTOM_ROLE_PERMISSIONS,
  holdsAll,
  isPermission,
  normalizePermissions,
  ORG_ROLE_FOR,
  type Permission,
} from "@pinwren/core";
import { customRole, getDb, member, withOrg } from "@pinwren/db";
import { and, asc, count, eq, sql } from "drizzle-orm";
import { ApiError, notFound } from "../errors";
import { assertFeatureWritable, hasFeature } from "../license";

// Custom roles (F-093, ADR 0045). The stored `member.role` is always a built-in one; a custom role is an extra
// association (`member.custom_role_id`) that narrows or reshapes permissions, resolved once per request here.
// Every failure mode falls back to the base role, so nobody is ever locked out and nothing is ever widened.

const ADMIN_BASE = sql`${member.role} ~ '(^|,)\\s*(owner|admin)\\s*(,|$)'`;
const isAdminBase = (role: string) =>
  role.split(",").some((r) => r.trim() === "owner" || r.trim() === "admin");

/** Only known, grantable keys survive: a key removed in a later version simply stops granting. */
const clean = (list: readonly string[]): Permission[] =>
  normalizePermissions(
    list.filter((p) => isPermission(p) && (CUSTOM_ROLE_PERMISSIONS as readonly string[]).includes(p)),
  );

/**
 * The access of a member: with no custom role, an Admin base, an unentitled workspace (licence lapsed) or a
 * deleted role, the stored role as is. Otherwise the custom role's permissions and the least privileged
 * matching base role (so every viewer/editor guard stays consistent with the permission list).
 */
export async function resolveAccess(
  orgId: string,
  customRoleId: string | null | undefined,
  baseRole: string,
): Promise<{ role: string; customPermissions: Permission[] | null }> {
  const fallback = { role: baseRole, customPermissions: null };
  if (!customRoleId || isAdminBase(baseRole)) return fallback;
  try {
    return await withOrg(orgId, async (db) => {
      if (!(await hasFeature("custom_roles"))) return fallback;
      const [row] = await db
        .select({ permissions: customRole.permissions })
        .from(customRole)
        .where(and(eq(customRole.id, customRoleId), eq(customRole.orgId, orgId)));
      if (!row) return fallback;
      const permissions = clean(row.permissions);
      return { role: ORG_ROLE_FOR[baseRoleForPermissions(permissions)], customPermissions: permissions };
    });
  } catch (err) {
    // Failing closed to the base role is safe; failing the request would lock people out of read access.
    console.warn("[pinwren] custom role could not be resolved; using the base role", err);
    return fallback;
  }
}

/** The 403 for a workspace without the feature (Enterprise licence; no Cloud plan includes it). */
export async function assertCustomRolesEntitled(): Promise<void> {
  if (!(await hasFeature("custom_roles"))) {
    throw new ApiError(
      403,
      "LICENSE_REQUIRED",
      "Custom roles need an Enterprise licence with the custom roles feature",
    );
  }
  await assertFeatureWritable("custom_roles");
}

export const escalation = () =>
  new ApiError(403, "PERMISSION_ESCALATION", "You can't grant or change permissions you don't hold yourself");

type Row = typeof customRole.$inferSelect;
const out = (r: Row, memberCount: number): CustomRole => ({
  id: r.id,
  name: r.name,
  description: r.description,
  permissions: clean(r.permissions),
  memberCount,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

export async function listRoles(orgId: string): Promise<{ roles: CustomRole[]; entitled: boolean }> {
  const [rows, counts, entitled] = await Promise.all([
    getDb()
      .select()
      .from(customRole)
      .where(eq(customRole.orgId, orgId))
      .orderBy(asc(sql`lower(${customRole.name})`)),
    getDb()
      .select({ id: member.customRoleId, n: count() })
      .from(member)
      .where(eq(member.organizationId, orgId))
      .groupBy(member.customRoleId),
    hasFeature("custom_roles"),
  ]);
  const byId = new Map(counts.map((c) => [c.id, c.n]));
  return { roles: rows.map((r) => out(r, byId.get(r.id) ?? 0)), entitled };
}

export async function getRole(orgId: string, id: string): Promise<Row | null> {
  const [row] = await getDb()
    .select()
    .from(customRole)
    .where(and(eq(customRole.id, id), eq(customRole.orgId, orgId)));
  return row ?? null;
}

async function assertNameFree(orgId: string, name: string, exceptId?: string) {
  const rows = await getDb()
    .select({ id: customRole.id })
    .from(customRole)
    .where(and(eq(customRole.orgId, orgId), sql`lower(${customRole.name}) = lower(${name})`));
  if (rows.some((r) => r.id !== exceptId)) {
    throw new ApiError(409, "ROLE_NAME_TAKEN", "A role with that name already exists");
  }
}

export async function createRole(actor: Access, orgId: string, userId: string, input: CustomRoleCreate) {
  await assertCustomRolesEntitled();
  if (!holdsAll(actor, input.permissions)) throw escalation();
  const db = getDb();
  const [total] = await db.select({ n: count() }).from(customRole).where(eq(customRole.orgId, orgId));
  if ((total?.n ?? 0) >= CUSTOM_ROLE_MAX_PER_ORG) {
    throw new ApiError(
      409,
      "ROLE_LIMIT",
      `A workspace can have up to ${CUSTOM_ROLE_MAX_PER_ORG} custom roles`,
    );
  }
  await assertNameFree(orgId, input.name);
  const [row] = await db
    .insert(customRole)
    .values({
      orgId,
      name: input.name,
      description: input.description,
      permissions: input.permissions,
      createdBy: userId,
    })
    .returning();
  if (!row) throw new Error("custom role insert failed");
  return out(row, 0);
}

export async function updateRole(actor: Access, orgId: string, id: string, patch: CustomRoleUpdate) {
  await assertCustomRolesEntitled();
  const current = await getRole(orgId, id);
  if (!current) throw notFound("Role");
  const permissions = patch.permissions ?? clean(current.permissions);
  if (!holdsAll(actor, permissions)) throw escalation();
  if (patch.name !== undefined) await assertNameFree(orgId, patch.name, id);
  const db = getDb();
  const [row] = await db
    .update(customRole)
    .set({
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.description !== undefined && { description: patch.description }),
      ...(patch.permissions !== undefined && { permissions: patch.permissions }),
      updatedAt: new Date(),
    })
    .where(and(eq(customRole.id, id), eq(customRole.orgId, orgId)))
    .returning();
  if (!row) throw notFound("Role");
  // Keep the stored base role matching the permissions (Admins never hold a custom role's base).
  await db
    .update(member)
    .set({ role: ORG_ROLE_FOR[baseRoleForPermissions(permissions)] })
    .where(and(eq(member.organizationId, orgId), eq(member.customRoleId, id), sql`not ${ADMIN_BASE}`));
  const [counted] = await db
    .select({ n: count() })
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.customRoleId, id)));
  return { role: out(row, counted?.n ?? 0), before: clean(current.permissions), beforeName: current.name };
}

export async function deleteRole(orgId: string, id: string) {
  const current = await getRole(orgId, id);
  if (!current) throw notFound("Role");
  const [used] = await getDb()
    .select({ n: count() })
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.customRoleId, id)));
  if (used && used.n > 0) {
    throw new ApiError(
      409,
      "ROLE_IN_USE",
      `${used.n} member(s) still hold this role. Give them another role first.`,
    );
  }
  await getDb()
    .delete(customRole)
    .where(and(eq(customRole.id, id), eq(customRole.orgId, orgId)));
  return current;
}

/** The caller's custom role (id and name), for `/api/me`. */
export async function customRoleOf(
  orgId: string,
  userId: string,
): Promise<{ id: string; name: string } | null> {
  const [row] = await getDb()
    .select({ id: customRole.id, name: customRole.name })
    .from(member)
    .innerJoin(
      customRole,
      and(eq(customRole.id, member.customRoleId), eq(customRole.orgId, member.organizationId)),
    )
    .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)));
  return row ?? null;
}
