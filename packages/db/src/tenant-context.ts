import { AsyncLocalStorage } from "node:async_hooks";
import { sql } from "drizzle-orm";
import { type Database, getRuntimeDb } from "./connection";

export type TenantDatabase = Parameters<Parameters<Database["transaction"]>[0]>[0];

type CommitEffect = () => void | Promise<void>;
type TenantScope = { orgId: string; db: TenantDatabase; active: boolean; effects: CommitEffect[] };

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

function runEffect(effect: CommitEffect): void {
  try {
    void Promise.resolve(effect()).catch((error: unknown) =>
      console.warn("[pinwren] post-commit effect failed", error),
    );
  } catch (error) {
    console.warn("[pinwren] post-commit effect failed", error);
  }
}

/** Queue broadcasts/jobs after a successful commit; a failed transaction discards them. */
export function afterOrgCommit(effect: CommitEffect): void {
  const scope = currentScope();
  if (scope) scope.effects.push(effect);
  else runEffect(effect);
}

function transactionScope(orgId: string, db: TenantDatabase): TenantScope {
  const scope: TenantScope = { orgId, db, active: true, effects: [] };
  const nestedTransaction = db.transaction.bind(db);
  // Drizzle creates a transaction object per savepoint. Nested services must use that same object,
  // and effects from a rolled-back savepoint must never reach its enclosing transaction.
  db.transaction = async <T>(callback: (nested: TenantDatabase) => Promise<T>): Promise<T> => {
    let effects: CommitEffect[] = [];
    const result = await nestedTransaction(async (nested) => {
      const child = transactionScope(orgId, nested);
      effects = child.effects;
      try {
        return await context.run(child, () => callback(nested));
      } finally {
        child.active = false;
      }
    });
    scope.effects.push(...effects);
    return result;
  };
  return scope;
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
  let effects: CommitEffect[] = [];
  try {
    const result = await getRuntimeDb().transaction(async (db) => {
      await db.execute(sql`select set_config('pinwren.org_id', ${orgId}, true)`);
      const scope = transactionScope(orgId, db);
      effects = scope.effects;
      try {
        return await context.run(scope, () => callback(db));
      } finally {
        scope.active = false;
      }
    });
    for (const effect of effects.splice(0)) runEffect(effect);
    return result;
  } catch (error) {
    effects.length = 0;
    throw error;
  }
}
