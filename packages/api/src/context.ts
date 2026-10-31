import { membershipFor } from "./db/identity";
import { tenantRequestScope } from "./tenant-scope";
import { createMiddleware } from "hono/factory";
import { getAuth } from "./auth";
import { env } from "./env";
import { ApiError, unauthorized } from "./errors";
import { isInstanceAdmin } from "./services/setup";

export type SessionVars = {
  userId: string;
  orgId: string;
  role: string;
};

/**
 * Dashboard auth: resolves the Better Auth session and the active organisation, and checks the
 * user is still a member of it. Every tenant query below scopes on `c.var.orgId`.
 */
export const requireSession = createMiddleware<{ Variables: SessionVars }>(async (c, next) => {
  const session = await getAuth().api.getSession({ headers: c.req.raw.headers });
  if (!session) throw unauthorized();
  if (env().PINWREN_MODE === "cloud" && !session.user.emailVerified) {
    throw new ApiError(403, "EMAIL_NOT_VERIFIED", "Confirm your email address to use your workspace");
  }
  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new ApiError(409, "NO_ACTIVE_ORG", "Create or select an organisation first");
  const m = await membershipFor(orgId, session.user.id);
  if (!m) throw new ApiError(403, "NOT_A_MEMBER", "You are not a member of this organisation");
  c.set("userId", session.user.id);
  c.set("orgId", orgId);
  c.set("role", m.role);
  await tenantRequestScope(c, next);
});

export const isOrgAdmin = (role: string) =>
  role.split(",").some((r) => r.trim() === "owner" || r.trim() === "admin");

/** Organisation owners/admins only (webhooks, deleting others' comments…). */
export const requireOrgAdmin = createMiddleware<{ Variables: SessionVars }>(async (c, next) => {
  if (!isOrgAdmin(c.var.role))
    throw new ApiError(403, "ADMIN_REQUIRED", "Only organisation admins can do this");
  await next();
});

/**
 * Instance admin (self-host settings such as SMTP): listed in PINWREN_ADMIN_EMAILS, or claimed with the
 * one-time setup token (services/setup.ts). The first user to sign up is no longer special (ADR 0021).
 */
export { isInstanceAdmin } from "./services/setup";

export const requireInstanceAdmin = createMiddleware<{ Variables: SessionVars }>(async (c, next) => {
  if (!(await isInstanceAdmin(c.var.userId))) {
    throw new ApiError(403, "INSTANCE_ADMIN_REQUIRED", "Only instance administrators can change this");
  }
  await next();
});
