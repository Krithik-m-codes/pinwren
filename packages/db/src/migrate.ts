import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const MIGRATION_LOCK = 72_000_001; // arbitrary, constant advisory-lock id

/**
 * Apply pending migrations under a Postgres advisory lock, so several replicas starting at once
 * never race (blueprint 02 §4). The caller passes the folder: bundlers can't follow a path computed
 * from import.meta.url, so it is resolved at runtime by whoever runs this.
 */
export async function runMigrations(url: string, migrationsFolder: string): Promise<void> {
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await client`select pg_advisory_lock(${MIGRATION_LOCK})`;
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client`select pg_advisory_unlock(${MIGRATION_LOCK})`.catch(() => {});
    await client.end();
  }
}
