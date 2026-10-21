import { getDb, rateLimit } from "@pinwren/db";
import { sql } from "drizzle-orm";

/**
 * Fixed-window counter in Postgres (no Redis in self-host). Returns false once `limit` hits within
 * the window. One upsert per call; old rows are overwritten when their window has passed.
 */
export async function consume(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const [row] = await getDb()
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
