import postgres from "postgres";
import { type Database, getRuntimeDb } from "./connection";
import { activeTenantDatabase, type TenantDatabase } from "./tenant-context";
import { deploymentMode } from "./deployment-mode";
import * as schema from "./schema";

export * from "./schema";
export { schema };
export type { Database } from "./connection";
export { withOrg, currentOrgId, type TenantDatabase } from "./tenant-context";

/**
 * Tests only: forget the sign-in / sign-up attempts the auth rate limiter has counted, so an end-to-end
 * suite can create many accounts from one address. Opens and closes its own connection (a pool would keep
 * the test runner alive).
 */
export async function clearAuthRateLimits(url: string): Promise<void> {
  const sql = postgres(url, { max: 1 });
  try {
    await sql`delete from auth_rate_limit`;
  } finally {
    await sql.end();
  }
}

export function getDb(): Database | TenantDatabase {
  const scoped = activeTenantDatabase();
  if (scoped) return scoped;
  if (deploymentMode() === "cloud") {
    throw new Error("Organization context is required for Cloud database access");
  }
  return getRuntimeDb();
}
