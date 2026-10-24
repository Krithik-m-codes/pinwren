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
} as const satisfies Record<string, readonly AppRole[]>;
export type Permission = keyof typeof PERMISSIONS;

/** Whether a stored `member.role` grants `permission`. */
export const roleCan = (role: string, permission: Permission): boolean =>
  (PERMISSIONS[permission] as readonly AppRole[]).includes(appRoleOf(role));

export const MIN_PASSWORD_LENGTH = 8;

/** Users › Add User: an Admin creates the account directly (no email needed). */
export const memberCreate = z.object({
  name: z.string().trim().min(1, "Enter a name").max(100),
  email: z.email("Enter a valid email address").max(254),
  password: z.string().min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters`).max(128),
  role: z.enum(APP_ROLES),
});
export type MemberCreate = z.infer<typeof memberCreate>;

/** Users › change someone's role. */
export const memberUpdate = z.object({ role: z.enum(APP_ROLES) });
export type MemberUpdate = z.infer<typeof memberUpdate>;

/** Users › invite by email (the second option): the same three roles. */
export const memberInvite = z.object({
  email: z.email("Enter a valid email address").max(254),
  role: z.enum(APP_ROLES),
});
export type MemberInvite = z.infer<typeof memberInvite>;
