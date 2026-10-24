import { getDb, invitation, member, setting, user } from "@pinwren/db";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { env } from "../env";

// Instance administrators (ADR 0021, amended for wave 5: the BugPin model). The first account created on a
// fresh instance is its administrator, so a self-hoster reaches Settings › Email straight from the
// dashboard. PINWREN_ADMIN_EMAILS stays as an optional, env-locked extra; admins can name more in
// Settings › Security. There is no setup token any more.

const ADMINS_KEY = "instance.admins";
/** Pending setup tokens of the old claim flow; dropped once someone administers the instance. */
const LEGACY_SETUP_KEY = "instance.setup";
/** Serialises every change to the admin list (the same lock the old claim used). */
const LOCK = sql`select pg_advisory_xact_lock(hashtext('pinwren.setup'))`;

type StoredAdmins = { userIds?: string[] };

async function read<T>(key: string): Promise<T> {
  const [row] = await getDb().select().from(setting).where(eq(setting.key, key));
  return (row?.value ?? {}) as T;
}

/** PINWREN_ADMIN_EMAILS, lower-cased. */
export const listedEmails = () =>
  (env().PINWREN_ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

export async function claimedAdminIds(): Promise<string[]> {
  return (await read<StoredAdmins>(ADMINS_KEY)).userIds ?? [];
}

export async function isInstanceAdmin(userId: string): Promise<boolean> {
  const emails = listedEmails();
  if (emails.length) {
    const [u] = await getDb().select({ email: user.email }).from(user).where(eq(user.id, userId));
    if (u && emails.includes(u.email.toLowerCase())) return true;
  }
  return (await claimedAdminIds()).includes(userId);
}

/** True while nobody can administer the instance: no PINWREN_ADMIN_EMAILS and nobody named. */
export async function setupNeeded(): Promise<boolean> {
  if (listedEmails().length) return false;
  return (await claimedAdminIds()).length === 0;
}

export async function hasAnyUser(): Promise<boolean> {
  const [anyone] = await getDb().select({ id: user.id }).from(user).limit(1);
  return !!anyone;
}

/**
 * Who becomes the administrator while nobody administers the instance: the oldest account. Pure, so the
 * race rule is unit-tested; `promoteFirstAccount` feeds it under the lock.
 */
export function pickFirstAdmin(o: {
  listed: boolean;
  claimed: readonly string[];
  oldestUserId: string | null;
}): string | null {
  if (o.listed || o.claimed.length > 0) return null;
  return o.oldestUserId;
}

/**
 * BugPin: the first account on a fresh instance is its administrator. Runs after every new account (the
 * user-create hook in auth.ts) and once at start (an instance upgraded from the setup-token model whose
 * token was never claimed). The advisory lock serialises it: of two simultaneous first sign-ups the
 * older account wins, and the other finds the list taken. Returns the promoted user id, or null.
 */
export async function promoteFirstAccount(): Promise<string | null> {
  const listed = listedEmails().length > 0;
  if (listed) return null;
  return getDb().transaction(async (tx) => {
    await tx.execute(LOCK);
    const [row] = await tx.select().from(setting).where(eq(setting.key, ADMINS_KEY));
    const claimed = (row?.value as StoredAdmins | undefined)?.userIds ?? [];
    const [oldest] = await tx
      .select({ id: user.id })
      .from(user)
      .orderBy(asc(user.createdAt), asc(user.id))
      .limit(1);
    const pick = pickFirstAdmin({ listed, claimed, oldestUserId: oldest?.id ?? null });
    if (!pick) return null;
    const value = { userIds: [pick] };
    await tx
      .insert(setting)
      .values({ key: ADMINS_KEY, value, updatedBy: pick })
      .onConflictDoUpdate({ target: setting.key, set: { value, updatedBy: pick, updatedAt: new Date() } });
    await tx.delete(setting).where(eq(setting.key, LEGACY_SETUP_KEY));
    return pick;
  });
}

export type AdminChange = "ok" | "unknown_user" | "env_locked" | "last_admin" | "not_admin";

/** Pure rule for removing an administrator (Settings › Security): never the env-listed, never the last. */
export function removalVerdict(o: {
  userId: string;
  claimed: readonly string[];
  /** Accounts whose email is in PINWREN_ADMIN_EMAILS. */
  listedUserIds: readonly string[];
}): AdminChange {
  if (o.listedUserIds.includes(o.userId)) return "env_locked";
  if (!o.claimed.includes(o.userId)) return "not_admin";
  const remaining = new Set([...o.claimed.filter((id) => id !== o.userId), ...o.listedUserIds]);
  return remaining.size === 0 ? "last_admin" : "ok";
}

/** Accounts that are admins through PINWREN_ADMIN_EMAILS. */
export async function listedAdminUsers(): Promise<{ id: string; name: string; email: string }[]> {
  const emails = listedEmails();
  if (!emails.length) return [];
  return getDb()
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(inArray(sql`lower(${user.email})`, emails));
}

/** Name another account an instance administrator. */
export async function addInstanceAdmin(userId: string, by: string): Promise<AdminChange> {
  return getDb().transaction(async (tx) => {
    await tx.execute(LOCK);
    const [u] = await tx.select({ id: user.id }).from(user).where(eq(user.id, userId));
    if (!u) return "unknown_user";
    const [row] = await tx.select().from(setting).where(eq(setting.key, ADMINS_KEY));
    const claimed = (row?.value as StoredAdmins | undefined)?.userIds ?? [];
    if (claimed.includes(userId)) return "ok";
    const value = { userIds: [...claimed, userId] };
    await tx
      .insert(setting)
      .values({ key: ADMINS_KEY, value, updatedBy: by })
      .onConflictDoUpdate({ target: setting.key, set: { value, updatedBy: by, updatedAt: new Date() } });
    return "ok";
  });
}

/** Remove an administrator named in the dashboard. Never leaves the instance without one. */
export async function removeInstanceAdmin(userId: string, by: string): Promise<AdminChange> {
  const listedUserIds = (await listedAdminUsers()).map((u) => u.id);
  return getDb().transaction(async (tx) => {
    await tx.execute(LOCK);
    const [row] = await tx.select().from(setting).where(eq(setting.key, ADMINS_KEY));
    const claimed = (row?.value as StoredAdmins | undefined)?.userIds ?? [];
    const verdict = removalVerdict({ userId, claimed, listedUserIds });
    if (verdict !== "ok") return verdict;
    await tx
      .update(setting)
      .set({
        value: { userIds: claimed.filter((id) => id !== userId) },
        updatedBy: by,
        updatedAt: new Date(),
      })
      .where(eq(setting.key, ADMINS_KEY));
    return "ok";
  });
}

/**
 * An account is going away (account deletion): drop it from the list. If it was the last administrator,
 * the oldest remaining account takes over, as on a fresh instance.
 */
export async function forgetInstanceAdmin(userId: string): Promise<void> {
  await getDb().transaction(async (tx) => {
    await tx.execute(LOCK);
    const [row] = await tx.select().from(setting).where(eq(setting.key, ADMINS_KEY));
    const claimed = (row?.value as StoredAdmins | undefined)?.userIds ?? [];
    if (!claimed.includes(userId)) return;
    await tx
      .update(setting)
      .set({ value: { userIds: claimed.filter((id) => id !== userId) }, updatedAt: new Date() })
      .where(eq(setting.key, ADMINS_KEY));
  });
  await promoteFirstAccount();
}

/**
 * Sign-up policy: the first account can always be created (someone has to install the instance), and
 * an invited email can always sign up. Anyone else only when PINWREN_DISABLE_SIGNUP=false.
 */
export function decideSignup(o: {
  /** PINWREN_DISABLE_SIGNUP: undefined (default), true or false. */
  disableSignup: boolean | undefined;
  hasUsers: boolean;
  invited: boolean;
}): boolean {
  if (o.disableSignup === false) return true;
  return !o.hasUsers || o.invited;
}

/** Whether someone without an invitation could create an account now (the "Create an account" link). */
export async function signupOpen(): Promise<boolean> {
  const disableSignup = env().PINWREN_DISABLE_SIGNUP;
  if (decideSignup({ disableSignup, hasUsers: true, invited: false })) return true;
  return decideSignup({ disableSignup, hasUsers: await hasAnyUser(), invited: false });
}

export async function signupAllowed(email: string): Promise<boolean> {
  if (await signupOpen()) return true;
  const [invited] = await getDb()
    .select({ id: invitation.id })
    .from(invitation)
    .where(
      and(
        sql`lower(${invitation.email}) = ${email.trim().toLowerCase()}`,
        eq(invitation.status, "pending"),
        gt(invitation.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return !!invited;
}

/** Whether two accounts share a workspace (who may see whose avatar). */
export async function shareWorkspace(a: string, b: string): Promise<boolean> {
  if (a === b) return true;
  const [row] = await getDb()
    .select({ id: member.id })
    .from(member)
    .where(
      and(
        eq(member.userId, b),
        sql`${member.organizationId} in (select ${member.organizationId} from ${member} where ${member.userId} = ${a})`,
      ),
    )
    .limit(1);
  return !!row;
}
