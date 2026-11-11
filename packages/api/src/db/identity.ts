import { apiToken, member, user } from "@pinwren/db";
import { identityDatabase } from "@pinwren/db/identity";
import { and, asc, eq, sql } from "drizzle-orm";

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

/**
 * The member of one organisation whose *confirmed* email is `email` (Slack-to-member mapping). Reads the
 * confirmation flag, which the tenant runtime role may not see, so it goes through the identity role; the
 * organisation id is always part of the predicate.
 */
export async function verifiedMemberByEmail(orgId: string, email: string) {
  const [row] = await identityDatabase()
    .select({ userId: user.id, name: user.name, role: member.role })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(
      and(
        eq(member.organizationId, orgId),
        sql`lower(${user.email}) = ${email.toLowerCase()}`,
        eq(user.emailVerified, true),
      ),
    )
    .limit(1);
  return row;
}
