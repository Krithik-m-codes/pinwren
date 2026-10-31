import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export function createDb(url: string) {
  const client = postgres(url, { max: Number(process.env.DATABASE_POOL_MAX ?? 10) });
  return drizzle(client, { schema, casing: "snake_case" });
}

export type Database = ReturnType<typeof createDb>;

// Internal infrastructure access. Tenant services use getDb()/withOrg() from the package entry point.
const globalForDb = globalThis as unknown as { __pinwrenDb?: Database };

export function getRuntimeDb(): Database {
  if (!globalForDb.__pinwrenDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    globalForDb.__pinwrenDb = createDb(url);
  }
  return globalForDb.__pinwrenDb;
}
