import { apiToken, member, user } from "@pinwren/db";
import { identityDatabase } from "@pinwren/db/identity";
import { and, asc, eq } from "drizzle-orm";

/** Only verified session/token identities may supply these identifiers. */
export async function membershipFor(orgId: string, userId: string) {
  const [row] = await identityDatabase()
    .select({
      id: member.id,
      role: member.role,
      organizationId: member.organizationId,
      userId: member.userId,
    })
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)))
    .limit(1);
  return row;
}

export async function firstOrganizationFor(userId: string): Promise<string | null> {
  const [row] = await identityDatabase()
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId))
    .orderBy(asc(member.createdAt), asc(member.id))
    .limit(1);
  return row?.organizationId ?? null;
}

export async function accountProfileFor(userId: string) {
  const [row] = await identityDatabase()
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      emailVerified: user.emailVerified,
      twoFactorEnabled: user.twoFactorEnabled,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return row;
}

export async function tokenForVerification(prefix: string) {
  const [row] = await identityDatabase()
    .select({
      id: apiToken.id,
      orgId: apiToken.orgId,
      userId: apiToken.userId,
      prefix: apiToken.prefix,
      hash: apiToken.hash,
      scopes: apiToken.scopes,
      expiresAt: apiToken.expiresAt,
      lastUsedAt: apiToken.lastUsedAt,
    })
    .from(apiToken)
    .where(eq(apiToken.prefix, prefix))
    .limit(1);
  return row;
}
