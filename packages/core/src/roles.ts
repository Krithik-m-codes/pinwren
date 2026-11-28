import { z } from "zod";

// Workspace roles as people see them (BugPin model, wave-5 contract §2): Admin, Editor, Viewer. They map
// onto the Better Auth organisation roles stored in `member.role`, so no data changes: `owner` and `admin`
// are Admins (the owner is the Admin who created the workspace and can't be removed), `member` is an
// Editor and `viewer` a Viewer. The API enforces the matrix below server-side; the dashboard only hides
// what a role can't do.

export const APP_ROLES = ["admin", "editor", "viewer"] as const;
export type AppRole = (typeof APP_ROLES)[number];

/** The Better Auth organisation roles (`member.role`; comma-separated when someone holds several). */
export const ORG_ROLES = ["owner", "admin", "member", "viewer"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

/** The role stored for an app role: Admin → `admin`, Editor → `member`, Viewer → `viewer`. */
export const ORG_ROLE_FOR: Record<AppRole, Exclude<OrgRole, "owner">> = {
  admin: "admin",
  editor: "member",
  viewer: "viewer",
};

/** The app role of a stored `member.role` (the strongest one when several are listed). */
export function appRoleOf(role: string): AppRole {
  const roles = role
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  if (roles.some((r) => r === "owner" || r === "admin")) return "admin";
  if (roles.length > 0 && roles.every((r) => r === "viewer")) return "viewer";
  return "editor";
}

/**
 * What each role may do. Admin: everything, including projects, users, integrations and settings.
 * Editor: view, edit, assign and bulk-update reports and create manual ones; no deleting, no settings.
 * Viewer: read-only (plus their own profile, preferences and notifications, which every role has).
 */
export const PERMISSIONS = {
  "feedback.read": ["admin", "editor", "viewer"],
  "feedback.create": ["admin", "editor"],
  "feedback.update": ["admin", "editor"],
  "feedback.comment": ["admin", "editor"],
  "feedback.delete": ["admin"],
  "feedback.restore": ["admin"],
  "projects.manage": ["admin"],
  "labels.manage": ["admin", "editor"],
  "users.manage": ["admin"],
  "integrations.manage": ["admin"],
  "settings.manage": ["admin"],
  // Finer keys (F-093, ADR 0045). Built-in roles hold them exactly as the Admin-only checks they replace did.
  "audit.read": ["admin"],
  "branding.manage": ["admin"],
  "billing.manage": ["admin"],
  /** Creating, editing and deleting custom roles. Never grantable to a custom role (see below). */
  "roles.manage": ["admin"],
} as const satisfies Record<string, readonly AppRole[]>;
export type Permission = keyof typeof PERMISSIONS;
export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as Permission[];

/** Whether `value` names a permission this version knows (unknown keys are never granted). */
export const isPermission = (value: unknown): value is Permission =>
  typeof value === "string" && Object.hasOwn(PERMISSIONS, value);

/**
 * What a custom role may be built from. `roles.manage` is left out on purpose: whoever can edit roles could
 * otherwise mint themselves any permission. Instance administration (`/api/admin/*`) is not a permission key
 * at all, so no role of any kind can grant it.
 */
export const CUSTOM_ROLE_PERMISSIONS = PERMISSION_KEYS.filter((k) => k !== "roles.manage");
/** Every member reads feedback; a custom role always includes it. */
export const CUSTOM_ROLE_BASELINE: readonly Permission[] = ["feedback.read"];

/** The permission groups the Roles page shows, in order. */
export const PERMISSION_GROUPS = [
  {
    id: "feedback",
    permissions: [
      "feedback.read",
      "feedback.create",
      "feedback.update",
      "feedback.comment",
      "feedback.delete",
      "feedback.restore",
    ],
  },
  {
    id: "workspace",
    permissions: [
      "projects.manage",
      "labels.manage",
      "integrations.manage",
      "settings.manage",
      "branding.manage",
    ],
  },
  { id: "access", permissions: ["users.manage", "audit.read", "billing.manage"] },
] as const satisfies readonly { id: string; permissions: readonly Permission[] }[];

/** Whether a stored `member.role` grants `permission` (built-in roles only; use `can` when a custom role may apply). */
export const roleCan = (role: string, permission: Permission): boolean =>
  isPermission(permission) && (PERMISSIONS[permission] as readonly AppRole[]).includes(appRoleOf(role));

/**
 * A member as the permission resolver sees them: the stored base role plus, when they hold a custom role the
 * workspace is entitled to, that role's permissions. `customPermissions` absent/null means "built-in role".
 */
export type Access = { role: string; customPermissions?: readonly string[] | null | undefined };

/**
 * The one place a permission is decided (F-093). Fail closed: an unknown permission is denied; a custom role
 * grants only what it lists; Admins (owner/admin) always use the built-in matrix, so nobody who administers
 * the workspace can be locked out by a role edit.
 */
export function can(access: Access, permission: Permission): boolean {
  if (!isPermission(permission)) return false;
  if (!access.customPermissions || appRoleOf(access.role) === "admin")
    return roleCan(access.role, permission);
  return permission !== "roles.manage" && access.customPermissions.includes(permission);
}

/** Every permission `access` holds (the dashboard hides what is not in this list). */
export const permissionsOf = (access: Access): Permission[] => PERMISSION_KEYS.filter((p) => can(access, p));

/** Whether `holder` has every permission in `needed` (nobody may hand out what they don't hold themselves). */
export const holdsAll = (holder: Access, needed: readonly Permission[]): boolean =>
  needed.every((p) => can(holder, p));

/** The permissions a built-in app role holds. */
export const permissionsOfAppRole = (role: AppRole): Permission[] =>
  PERMISSION_KEYS.filter((p) => (PERMISSIONS[p] as readonly AppRole[]).includes(role));

/**
 * The Better Auth base role stored next to a custom role: the least privileged one that still works.
 * A role that only reads is a Viewer (every viewer guard then applies); any write permission needs the
 * Editor base. It is also what a member falls back to if the licence lapses (ADR 0045).
 */
const READ_ONLY_PERMISSIONS: readonly Permission[] = ["feedback.read", "audit.read"];
export const baseRoleForPermissions = (permissions: readonly string[]): Exclude<AppRole, "admin"> =>
  permissions.every((p) => READ_ONLY_PERMISSIONS.includes(p as Permission)) ? "viewer" : "editor";

export const MIN_PASSWORD_LENGTH = 8;

/** Users › Add User: an Admin creates the account directly (no email needed). */
export const memberCreate = z.object({
  name: z.string().trim().min(1, "Enter a name").max(100),
  email: z.email("Enter a valid email address").max(254),
  password: z.string().min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters`).max(128),
  role: z.enum(APP_ROLES),
  /** A custom role (F-093); when set, `role` is only the label sent along and the custom role applies. */
  customRoleId: z.uuid().optional(),
});
export type MemberCreate = z.infer<typeof memberCreate>;

/**
 * Users › change someone's role: a built-in role, or a custom role by id (F-093). Setting a built-in role
 * clears any custom one.
 */
export const memberUpdate = z.union([
  z.strictObject({ role: z.enum(APP_ROLES) }),
  z.strictObject({ customRoleId: z.uuid() }),
]);
export type MemberUpdate = z.infer<typeof memberUpdate>;

/** Users › invite by email (the second option): the same three roles. */
export const memberInvite = z.object({
  email: z.email("Enter a valid email address").max(254),
  role: z.enum(APP_ROLES),
});
export type MemberInvite = z.infer<typeof memberInvite>;
