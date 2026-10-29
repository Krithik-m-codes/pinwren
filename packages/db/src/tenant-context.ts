import { AsyncLocalStorage } from "node:async_hooks";
import { sql } from "drizzle-orm";
import { type Database, getRuntimeDb } from "./connection";

export type TenantDatabase = Parameters<Parameters<Database["transaction"]>[0]>[0];

type TenantScope = { orgId: string; db: TenantDatabase; active: boolean };

// Next dev reloads modules; one store must serve both pre-reload and post-reload consumers.
const contextGlobal = globalThis as unknown as { __pinwrenTenantContext?: AsyncLocalStorage<TenantScope> };
const context = (contextGlobal.__pinwrenTenantContext ??= new AsyncLocalStorage<TenantScope>());

function currentScope(): TenantScope | undefined {
  const scope = context.getStore();
  if (scope && !scope.active) throw new Error("Organization transaction scope has finished");
  return scope;
}

export function currentOrgId(): string | undefined {
  return currentScope()?.orgId;
}

/** Internal resolver; missing context is handled by the package's public getDb(). */
export function activeTenantDatabase(): TenantDatabase | undefined {
  return currentScope()?.db;
}

/** Run finite database work in one organization, never network I/O or a response stream. */
export async function withOrg<T>(orgId: string, callback: (db: TenantDatabase) => Promise<T>): Promise<T> {
  if (orgId.length === 0 || orgId.trim() !== orgId || orgId.includes("\0")) {
    throw new Error("A valid organization identifier is required");
  }
  const parent = currentScope();
  if (parent) {
    if (parent.orgId !== orgId) throw new Error("Cannot switch organization inside a tenant transaction");
    return callback(parent.db);
  }
  return getRuntimeDb().transaction(async (db) => {
    await db.execute(sql`select set_config('pinwren.org_id', ${orgId}, true)`);
    const scope: TenantScope = { orgId, db, active: true };
    try {
      return await context.run(scope, () => callback(db));
    } finally {
      scope.active = false;
    }
  });
}
