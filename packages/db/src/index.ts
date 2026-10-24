import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export * from "./schema";
export { schema };

function createDb(url: string) {
  const client = postgres(url, { max: Number(process.env.DATABASE_POOL_MAX ?? 10) });
  return drizzle(client, { schema, casing: "snake_case" });
}

export type Database = ReturnType<typeof createDb>;

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

// One pool per process. Next.js dev reloads modules, so keep it on globalThis.
const globalForDb = globalThis as unknown as { __pinwrenDb?: Database };

export function getDb(): Database {
  if (!globalForDb.__pinwrenDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    globalForDb.__pinwrenDb = createDb(url);
  }
  return globalForDb.__pinwrenDb;
}
