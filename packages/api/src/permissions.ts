import { type Permission, roleCan } from "@pinwren/core";
import { createMiddleware } from "hono/factory";
import type { SessionVars } from "./context";
import { ApiError } from "./errors";

// Viewer role (wave-4 contract §4): members with role `viewer` read everything and change nothing.
// Enforced once, in front of every dashboard route, so a new mutating route is read-only for viewers
// unless it is deliberately listed below (`permissions.test.ts` walks the whole route table).

export const VIEWER_ROLE = "viewer";

/** Better Auth stores roles comma-separated; any role besides `viewer` grants writes. */
export const isReadOnlyRole = (role: string): boolean => {
  const roles = role
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  return roles.length > 0 && roles.every((r) => r === VIEWER_ROLE);
};

/** Who is reading, for redacting configuration (panel-action URLs) in responses. */
export function audienceOf(role: string): "admin" | "member" | "viewer" {
  const roles = role.split(",").map((r) => r.trim());
  if (roles.some((r) => r === "owner" || r === "admin")) return "admin";
  return isReadOnlyRole(role) ? "viewer" : "member";
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Writes a viewer may still make. Each changes only the viewer's own state, never organisation
 * data, or is governed by a separate permission (instance administration).
 */
export const VIEWER_ALLOWED_MUTATIONS: readonly { method: string; path: string; why: string }[] = [
  { method: "POST", path: "/api/notifications/read", why: "own inbox" },
  { method: "PUT", path: "/api/notification-preferences", why: "own notification switches" },
  { method: "POST", path: "/api/presence", why: "who is looking at an item" },
  { method: "POST", path: "/api/tokens", why: "own API tokens (their writes are refused too)" },
  { method: "DELETE", path: "/api/tokens/:id", why: "own API tokens" },
  { method: "POST", path: "/api/views", why: "personal saved views (sharing is refused)" },
  { method: "PATCH", path: "/api/views/:id", why: "personal saved views" },
  { method: "DELETE", path: "/api/views/:id", why: "personal saved views" },
  // Wave 5 (docs/contracts/wave-5.md): personal state the owning areas add. Listed here up front so the
  // builders never edit this list concurrently; `permissions.test.ts` lists the exemptions that exist.
  { method: "POST", path: "/api/feedback/:id/watch", why: "follow an item (own subscription)" },
  { method: "DELETE", path: "/api/feedback/:id/watch", why: "unfollow an item" },
  { method: "POST", path: "/api/feedback/:id/page-link", why: "a signed link to read the item on its page" },
  { method: "PATCH", path: "/api/me/preferences", why: "own digest / pause switches" },
  { method: "PATCH", path: "/api/me/profile", why: "own name" },
  { method: "POST", path: "/api/me/avatar", why: "own avatar" },
  { method: "DELETE", path: "/api/me/avatar", why: "own avatar" },
  { method: "*", path: "/api/admin/*", why: "instance administration, checked separately" },
];

const toRegex = (path: string) =>
  new RegExp(
    `^${path
      .split("/")
      .map((seg) =>
        seg.startsWith(":") ? "[^/]+" : seg === "*" ? ".*" : seg.replace(/[.+?^${}()|[\]\\]/g, "\\$&"),
      )
      .join("/")}$`,
  );
const ALLOWED = VIEWER_ALLOWED_MUTATIONS.map((a) => ({ method: a.method, re: toRegex(a.path) }));

export function viewerMayCall(method: string, path: string): boolean {
  if (!MUTATING.has(method.toUpperCase())) return true;
  const p = path.replace(/\/+$/, "") || "/";
  return ALLOWED.some((a) => (a.method === "*" || a.method === method.toUpperCase()) && a.re.test(p));
}

export const readOnlyError = () =>
  new ApiError(403, "READ_ONLY_ROLE", "Your role (viewer) can read but not change anything");

/** Runs after `requireSession`. */
export const forbidViewerWrites = createMiddleware<{ Variables: SessionVars }>(async (c, next) => {
  if (isReadOnlyRole(c.var.role) && !viewerMayCall(c.req.method, c.req.path)) throw readOnlyError();
  await next();
});

/**
 * BugPin roles (wave-5 contract §2): Admin / Editor / Viewer over `member.role`. Put it in front of a route
 * whose permission is narrower than "not a viewer", e.g. `requirePermission("feedback.delete")` (Admins only).
 */
export const requirePermission = (permission: Permission) =>
  createMiddleware<{ Variables: SessionVars }>(async (c, next) => {
    if (!roleCan(c.var.role, permission)) {
      throw new ApiError(403, "FORBIDDEN_ROLE", "Your role doesn't allow this. Ask a workspace Admin.");
    }
    await next();
  });
