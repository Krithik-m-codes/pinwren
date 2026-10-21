import { getDb, member, user } from "@annota/db";
import { and, asc, eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { getAuth } from "./auth";
import { env } from "./env";
import { ApiError, unauthorized } from "./errors";

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
  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new ApiError(409, "NO_ACTIVE_ORG", "Create or select an organisation first");
  const [m] = await getDb()
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.userId, session.user.id)))
    .limit(1);
  if (!m) throw new ApiError(403, "NOT_A_MEMBER", "You are not a member of this organisation");
  c.set("userId", session.user.id);
  c.set("orgId", orgId);
  c.set("role", m.role);
  await next();
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
 * Instance admin (self-host settings such as SMTP): listed in ANNOTA_ADMIN_EMAILS, or — when that
 * is unset — the first user who signed up (the operator who installed the instance).
 */
export async function isInstanceAdmin(userId: string): Promise<boolean> {
  const listed = env().ANNOTA_ADMIN_EMAILS;
  const db = getDb();
  if (listed) {
    const [u] = await db.select({ email: user.email }).from(user).where(eq(user.id, userId));
    const emails = listed.split(",").map((s) => s.trim().toLowerCase());
    return !!u && emails.includes(u.email.toLowerCase());
  }
  const [first] = await db
    .select({ id: user.id })
    .from(user)
    .orderBy(asc(user.createdAt), asc(user.id))
    .limit(1);
  return first?.id === userId;
}

export const requireInstanceAdmin = createMiddleware<{ Variables: SessionVars }>(async (c, next) => {
  if (!(await isInstanceAdmin(c.var.userId))) {
    throw new ApiError(403, "INSTANCE_ADMIN_REQUIRED", "Only instance administrators can change this");
  }
  await next();
});
