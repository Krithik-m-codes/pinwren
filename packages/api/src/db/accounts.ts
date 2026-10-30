import { account as authAccount, getDb, invitation, organization, user, userPreference } from "@pinwren/db";
import { identityDatabase } from "@pinwren/db/identity";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { env } from "../env";
const accountDatabase = () => (env().PINWREN_MODE === "cloud" ? identityDatabase() : getDb());
const profileColumns = { id: user.id, name: user.name, email: user.email, image: user.image };

export async function avatarKeyOf(userId: string): Promise<string | null> {
  const [pref] = await accountDatabase()
    .select({ avatarKey: userPreference.avatarKey })
    .from(userPreference)
    .where(eq(userPreference.userId, userId));
  return pref?.avatarKey ?? null;
}

export async function invitationsFor(email: string) {
  const rows = await accountDatabase()
    .select({
      id: invitation.id,
      organizationId: invitation.organizationId,
      organizationName: organization.name,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
      inviterName: user.name,
    })
    .from(invitation)
    .innerJoin(organization, eq(organization.id, invitation.organizationId))
    .leftJoin(user, eq(user.id, invitation.inviterId))
    .where(
      and(
        sql`lower(${invitation.email}) = ${email.toLowerCase()}`,
        eq(invitation.status, "pending"),
        gt(invitation.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(invitation.createdAt));
  return rows;
}

export async function updateAccountName(userId: string, name: string) {
  const [u] = await accountDatabase()
    .update(user)
    .set({ name: name, updatedAt: new Date() })
    .where(eq(user.id, userId))
    .returning(profileColumns);
  return u;
}

export async function saveAccountAvatar(userId: string, key: string, image: string) {
  const db = accountDatabase();
  await db
    .insert(userPreference)
    .values({ userId: userId, avatarKey: key })
    .onConflictDoUpdate({
      target: userPreference.userId,
      set: { avatarKey: key, updatedAt: new Date() },
    });
  await db.update(user).set({ image, updatedAt: new Date() }).where(eq(user.id, userId));
}

export async function clearAccountAvatar(userId: string) {
  const db = accountDatabase();
  await db
    .update(userPreference)
    .set({ avatarKey: null, updatedAt: new Date() })
    .where(eq(userPreference.userId, userId));
  await db.update(user).set({ image: null, updatedAt: new Date() }).where(eq(user.id, userId));
}

export async function accountPassword(userId: string) {
  const db = accountDatabase();
  const [cred] = await db
    .select({ password: authAccount.password })
    .from(authAccount)
    .where(and(eq(authAccount.userId, userId), eq(authAccount.providerId, "credential")));
  return cred?.password;
}

export async function accountEmailTaken(next: string) {
  const [taken] = await accountDatabase()
    .select({ id: user.id })
    .from(user)
    .where(sql`lower(${user.email}) = ${next}`);
  return !!taken;
}

export async function updateAccountEmail(userId: string, next: string) {
  const [u] = await accountDatabase()
    .update(user)
    .set({ email: next, emailVerified: false, updatedAt: new Date() })
    .where(eq(user.id, userId))
    .returning(profileColumns);
  return u;
}
