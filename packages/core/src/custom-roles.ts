import { z } from "zod";
import { CUSTOM_ROLE_BASELINE, CUSTOM_ROLE_PERMISSIONS, type Permission } from "./roles";

// Custom roles (F-093, ADR 0045): workspace-defined bundles of permissions on top of the three built-in
// roles. Wire types for `/api/roles` live here so the API and the dashboard agree.

export const CUSTOM_ROLE_MAX_PER_ORG = 50;

export const customRoleName = z.string().trim().min(1, "Enter a name").max(60);

const permissionList = z
  .array(z.enum(CUSTOM_ROLE_PERMISSIONS as [Permission, ...Permission[]]))
  .max(CUSTOM_ROLE_PERMISSIONS.length)
  .transform((list) => normalizePermissions(list));

/** Unique, in catalogue order, always including the baseline every member has (reading feedback). */
export function normalizePermissions(list: readonly string[]): Permission[] {
  const wanted = new Set<string>([...CUSTOM_ROLE_BASELINE, ...list]);
  return CUSTOM_ROLE_PERMISSIONS.filter((p) => wanted.has(p));
}

export const customRoleCreate = z.object({
  name: customRoleName,
  description: z.string().trim().max(300).default(""),
  permissions: permissionList,
});
export type CustomRoleCreate = z.infer<typeof customRoleCreate>;

export const customRoleUpdate = z
  .object({
    name: customRoleName.optional(),
    description: z.string().trim().max(300).optional(),
    permissions: permissionList.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Nothing to change");
export type CustomRoleUpdate = z.infer<typeof customRoleUpdate>;

export type CustomRole = {
  id: string;
  name: string;
  description: string;
  permissions: Permission[];
  /** Members holding the role. */
  memberCount: number;
  createdAt: string;
  updatedAt: string;
};
export type CustomRoleList = {
  roles: CustomRole[];
  /** False when the workspace isn't entitled: roles are listed read-only and no longer apply. */
  entitled: boolean;
};
