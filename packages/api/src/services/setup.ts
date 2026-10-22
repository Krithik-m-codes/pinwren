import { getDb, invitation, setting, user } from "@pinwren/db";
import { and, eq, gt, sql } from "drizzle-orm";
import { randomToken, safeEqualHex, sha256Hex } from "../crypto";
import { env } from "../env";

// Instance administrators and first-run setup (ADR 0021). An instance admin is either listed in
// PINWREN_ADMIN_EMAILS or has claimed the instance with the one-time setup token the server prints to
// its log on start while no admin exists. Signing up first no longer makes anyone an admin.

const ADMINS_KEY = "instance.admins";
const SETUP_KEY = "instance.setup";
/** Each server process prints its own token; the latest few stay valid until one is claimed. */
const MAX_PENDING_TOKENS = 16;
const TOKEN_TTL_MS = 7 * 24 * 3600 * 1000;

type StoredAdmins = { userIds?: string[] };
type StoredSetup = { tokens?: { hash: string; createdAt: string }[] };

async function read<T>(key: string): Promise<T> {
  const [row] = await getDb().select().from(setting).where(eq(setting.key, key));
  return (row?.value ?? {}) as T;
}

const listedEmails = () =>
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

/** True while nobody can administer the instance: no PINWREN_ADMIN_EMAILS and nothing claimed. */
export async function setupNeeded(): Promise<boolean> {
  if (listedEmails().length) return false;
  return (await claimedAdminIds()).length === 0;
}

/**
 * Called once per server process at start. While setup is needed, creates a fresh token, stores only
 * its hash and returns the token for the log. Returns null when there is nothing to set up.
 */
export async function issueSetupToken(): Promise<string | null> {
  if (!(await setupNeeded())) return null;
  const token = `pws_${randomToken(32)}`;
  const now = Date.now();
  const kept = ((await read<StoredSetup>(SETUP_KEY)).tokens ?? []).filter(
    (t) => now - Date.parse(t.createdAt) < TOKEN_TTL_MS,
  );
  const tokens = [...kept, { hash: sha256Hex(token), createdAt: new Date(now).toISOString() }].slice(
    -MAX_PENDING_TOKENS,
  );
  await getDb()
    .insert(setting)
    .values({ key: SETUP_KEY, value: { tokens } })
    .onConflictDoUpdate({ target: setting.key, set: { value: { tokens }, updatedAt: new Date() } });
  return token;
}

export type ClaimResult = "claimed" | "invalid" | "not_needed";

/** Make `userId` an instance admin with a setup token. Single use: every pending token is dropped. */
export async function claimSetup(userId: string, token: string): Promise<ClaimResult> {
  const db = getDb();
  return db.transaction(async (tx) => {
    // Serialise claims: two people racing with two printed tokens can't both become the first admin.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('pinwren.setup'))`);
    const [admins] = await tx.select().from(setting).where(eq(setting.key, ADMINS_KEY));
    if (listedEmails().length || ((admins?.value as StoredAdmins | undefined)?.userIds ?? []).length) {
      return "not_needed";
    }
    const [setup] = await tx.select().from(setting).where(eq(setting.key, SETUP_KEY));
    const hash = sha256Hex(token);
    const now = Date.now();
    const valid = ((setup?.value as StoredSetup | undefined)?.tokens ?? []).some(
      (t) => now - Date.parse(t.createdAt) < TOKEN_TTL_MS && safeEqualHex(t.hash, hash),
    );
    if (!valid) return "invalid";
    const value = { userIds: [userId] };
    await tx
      .insert(setting)
      .values({ key: ADMINS_KEY, value, updatedBy: userId })
      .onConflictDoUpdate({ target: setting.key, set: { value, updatedBy: userId, updatedAt: new Date() } });
    await tx.delete(setting).where(eq(setting.key, SETUP_KEY));
    return "claimed";
  });
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

export async function signupAllowed(email: string): Promise<boolean> {
  const db = getDb();
  const disableSignup = env().PINWREN_DISABLE_SIGNUP;
  if (decideSignup({ disableSignup, hasUsers: true, invited: false })) return true;
  const [anyone] = await db.select({ id: user.id }).from(user).limit(1);
  if (!anyone) return true;
  const [invited] = await db
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
