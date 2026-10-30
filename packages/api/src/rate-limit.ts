import { identityDatabase } from "@pinwren/db/identity";
import { env } from "./env";
import { getDb, rateLimit } from "@pinwren/db";
import { sql } from "drizzle-orm";

/**
 * Fixed-window counter in Postgres (no Redis in self-host). Returns false once `limit` hits within
 * the window. One upsert per call; old rows are overwritten when their window has passed.
 */
export async function consume(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const [row] = await rateLimitDatabase()
    .insert(rateLimit)
    .values({ key, count: 1, resetAt: sql`now() + make_interval(secs => ${windowSeconds})` })
    .onConflictDoUpdate({
      target: rateLimit.key,
      set: {
        count: sql`case when ${rateLimit.resetAt} < now() then 1 else ${rateLimit.count} + 1 end`,
        resetAt: sql`case when ${rateLimit.resetAt} < now() then now() + make_interval(secs => ${windowSeconds}) else ${rateLimit.resetAt} end`,
      },
    })
    .returning({ count: rateLimit.count });
  return (row?.count ?? 0) <= limit;
}

/**
 * Like `consume`, but adds `amount` (e.g. bytes) instead of 1. Returns false once the window's total
 * passes `limit`. Values are stored as integers, so callers pass a unit that fits (KiB, not bytes).
 */
export async function consumeAmount(
  key: string,
  amount: number,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const n = Math.max(0, Math.ceil(amount));
  const [row] = await rateLimitDatabase()
    .insert(rateLimit)
    .values({ key, count: n, resetAt: sql`now() + make_interval(secs => ${windowSeconds})` })
    .onConflictDoUpdate({
      target: rateLimit.key,
      set: {
        count: sql`case when ${rateLimit.resetAt} < now() then ${n} else ${rateLimit.count} + ${n} end`,
        resetAt: sql`case when ${rateLimit.resetAt} < now() then now() + make_interval(secs => ${windowSeconds}) else ${rateLimit.resetAt} end`,
      },
    })
    .returning({ count: rateLimit.count });
  return (row?.count ?? 0) <= limit;
}

/** Has `key` already used up `limit` in its current window? Reads only. */
export async function exhausted(key: string, limit: number): Promise<boolean> {
  const [row] = await rateLimitDatabase()
    .select({ count: rateLimit.count })
    .from(rateLimit)
    .where(sql`${rateLimit.key} = ${key} and ${rateLimit.resetAt} >= now()`);
  return (row?.count ?? 0) >= limit;
}

// Fixed system-table repository; never returns tenant content.
const rateLimitDatabase = () => (env().PINWREN_MODE === "cloud" ? identityDatabase() : getDb());
