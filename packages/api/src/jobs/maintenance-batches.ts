import { currentOrgId, withOrg, type TenantDatabase } from "@pinwren/db";
import { sql } from "drizzle-orm";

export const MAINTENANCE_BATCH_SIZE = 500;
export const MAINTENANCE_MAX_BATCHES = 10;

/** A backlog gets another turn on the next scheduled run, without starving later workspaces. */
export async function runMaintenanceBatches(work: () => Promise<number>): Promise<number> {
  let total = 0;
  for (let batch = 0; batch < MAINTENANCE_MAX_BATCHES; batch++) {
    const removed = await work();
    total += removed;
    if (removed < MAINTENANCE_BATCH_SIZE) break;
  }
  return total;
}

export function assertGlobalMaintenance(): void {
  if (currentOrgId()) throw new Error("Global maintenance must run outside a tenant transaction");
}

/** Local settings cannot leak to pooled connections or later request transactions. */
export async function maintenanceTimeouts(db: TenantDatabase): Promise<void> {
  await db.execute(
    sql`select set_config('statement_timeout', '15s', true), set_config('lock_timeout', '2s', true)`,
  );
}

export function maintenanceBatch<T>(orgId: string, work: (db: TenantDatabase) => Promise<T>): Promise<T> {
  assertGlobalMaintenance();
  return withOrg(orgId, async (db) => {
    await maintenanceTimeouts(db);
    return work(db);
  });
}
