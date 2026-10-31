import {
  authRateLimit,
  getDb,
  license,
  member,
  organization,
  rateLimit,
  setting,
  user,
  userPreference,
} from "@pinwren/db";
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

export async function organizationIds(): Promise<string[]> {
  const rows = await systemDatabase().select({ id: organization.id }).from(organization);
  return rows.map((row) => row.id);
}

export async function pruneSystemRateLimits(): Promise<void> {
  await systemDatabase()
    .delete(rateLimit)
    .where(sql`${rateLimit.resetAt} < now() - interval '1 hour'`);
  await systemDatabase()
    .delete(authRateLimit)
    .where(sql`${authRateLimit.lastRequest} < extract(epoch from now() - interval '1 day') * 1000`);
}

export async function digestRecipients(orgId: string) {
  return systemDatabase()
    .select({
      userId: userPreference.userId,
      freq: userPreference.emailDigest,
      last: userPreference.lastDigestAt,
      email: user.email,
    })
    .from(member)
    .innerJoin(userPreference, eq(userPreference.userId, member.userId))
    .innerJoin(user, eq(user.id, member.userId))
    .where(
      sql`${member.organizationId} = ${orgId} and ${userPreference.emailDigest} <> 'off' and ${userPreference.emailPaused} = false`,
    );
}

export async function markDigestSent(userId: string, at: Date): Promise<void> {
  await systemDatabase()
    .update(userPreference)
    .set({ lastDigestAt: at })
    .where(eq(userPreference.userId, userId));
}

export async function webhookAdminRecipients(orgId: string) {
  return systemDatabase()
    .select({
      userId: user.id,
      email: user.email,
      paused: sql<boolean>`coalesce(${userPreference.emailPaused}, false)`,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .leftJoin(userPreference, eq(userPreference.userId, member.userId))
    .where(sql`${member.organizationId} = ${orgId} and ${member.role} ~ '(^|,)\\s*(owner|admin)\\s*(,|$)'`);
}
