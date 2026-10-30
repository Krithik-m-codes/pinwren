import { getDb, setting, license } from "@pinwren/db";
import { identityDatabase } from "@pinwren/db/identity";
import { eq, desc, sql } from "drizzle-orm";
import { env } from "../env";

const systemDatabase = () => (env().PINWREN_MODE === "cloud" ? identityDatabase() : getDb());

export const REALTIME_CHANNEL = "pinwren_events";

/** Fixed transport operation; no tenant rows or caller-provided SQL. */
export async function notifyRealtime(payload: string): Promise<void> {
  await systemDatabase().execute(sql`select pg_notify(${REALTIME_CHANNEL}, ${payload})`);
}

/** Fixed instance configuration, independent of any tenant transaction. */
export async function readInstanceSetting(key: string) {
  const [row] = await systemDatabase().select().from(setting).where(eq(setting.key, key));
  return row;
}

export async function saveInstanceSetting(record: typeof setting.$inferInsert) {
  const { key: _key, ...values } = record;
  await systemDatabase()
    .insert(setting)
    .values(record)
    .onConflictDoUpdate({
      target: setting.key,
      set: { ...values, updatedAt: new Date() },
    });
}

export async function latestInstanceLicense() {
  const [row] = await systemDatabase()
    .select({ raw: license.raw })
    .from(license)
    .orderBy(desc(license.installedAt))
    .limit(1);
  return row;
}

export async function saveInstanceLicense(record: typeof license.$inferInsert) {
  await systemDatabase().insert(license).values(record);
}

export async function removeInstanceLicenses() {
  await systemDatabase().delete(license);
}
