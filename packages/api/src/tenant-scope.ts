import { withOrg } from "@pinwren/db";
import { createMiddleware } from "hono/factory";
import { matchedRoutes } from "hono/route";
import { env } from "./env";
import routeInventory from "./tenant-route-inventory.json";

const inventory: Record<string, { boundary: string; databaseLifetime: string }> = routeInventory;
class RollbackResponse extends Error {}

/** Called only after session/token validation. Mixed I/O handlers enter finite scopes explicitly. */
export const tenantRequestScope = createMiddleware<{ Variables: { orgId: string } }>(async (c, next) => {
  if (env().PINWREN_MODE !== "cloud") return next();
  const method = c.req.method === "HEAD" ? "GET" : c.req.method;
  // Hono may match both a literal route and a later :id route; the first handler wins.
  const route = matchedRoutes(c).find((value) => value.method === method);
  if (!route) return next();
  const entry = inventory[`${method} ${route.path}`];
  if (!entry) throw new Error("Cloud tenant route is missing its boundary classification");
  if (entry.boundary !== "tenant" || entry.databaseLifetime !== "finite") return next();
  if (!c.var.orgId) throw new Error("Verified organization context is required");
  try {
    await withOrg(c.var.orgId, async () => {
      await next();
      // Hono catches route errors before unwinding middleware. Its translated response is still
      // a failed unit of work; otherwise the surrounding transaction would silently commit.
      if (c.error || c.res.status >= 400) throw new RollbackResponse();
    });
  } catch (error) {
    if (!(error instanceof RollbackResponse)) throw error;
  }
});
