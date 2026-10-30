import { withOrg } from "@pinwren/db";
import type { Context, Next, Env, Input } from "hono";
import { matchedRoutes } from "hono/route";
import { env } from "./env";
import routeInventory from "./tenant-route-inventory.json";

const inventory: Record<string, { boundary: string; databaseLifetime: string }> = routeInventory;
class RollbackResponse extends Error {}

/** The first concrete Hono handler determines the transaction lifetime. */
// Preserve Hono middleware variables, path and input without narrowing its invariant context.
export function requestBoundary<E extends Env, P extends string, I extends Input>(c: Context<E, P, I>) {
  const method = c.req.method === "HEAD" ? "GET" : c.req.method;
  const route = matchedRoutes(c).find((value) => value.method === method);
  if (!route) return undefined;
  const entry = inventory[`${method} ${route.path}`];
  if (!entry) throw new Error("Cloud tenant route is missing its boundary classification");
  return entry;
}

/** Called only after session/token validation. Mixed I/O handlers enter finite scopes explicitly. */
// Hono Context is invariant in its variables; retain the caller's complete variable type.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export async function tenantRequestScope<V extends { orgId: string }>(
  c: Context<{ Variables: V }>,
  next: Next,
) {
  if (env().PINWREN_MODE !== "cloud") return next();
  const entry = requestBoundary(c);
  if (!entry) return next();
  if (entry.boundary !== "tenant" || entry.databaseLifetime !== "finite") return next();
  if (!c.var.orgId) throw new Error("Verified organization context is required");
  await withOrgResponse(c.var.orgId, c, next);
}

/** Call only with an organization derived from validated session/token/capability authority. */
export async function withOrgResponse(
  orgId: string,
  c: { readonly error: Error | undefined; readonly res: Response },
  next: Next,
) {
  try {
    await withOrg(orgId, async () => {
      await next();
      // Hono catches route errors before unwinding middleware. Its translated response is still
      // a failed unit of work; otherwise the surrounding transaction would silently commit.
      if (c.error || c.res.status >= 400) throw new RollbackResponse();
    });
  } catch (error) {
    if (!(error instanceof RollbackResponse)) throw error;
  }
}
