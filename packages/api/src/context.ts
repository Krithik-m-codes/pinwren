import { getDb, member } from "@annota/db";
import { and, eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { getAuth } from "./auth";
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
