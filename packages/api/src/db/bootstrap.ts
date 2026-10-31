import {
  brandAsset,
  feedbackAsset,
  issueIntegration,
  issueLink,
  project,
  webhookDelivery,
} from "@pinwren/db";
import { identityDatabase } from "@pinwren/db/identity";
import { and, eq, isNull, sql } from "drizzle-orm";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Capability resolution only. Content and configuration are re-read through tenant runtime scope. */
export async function projectForPublicKey(key: string) {
  if (key.length > 160) return undefined;
  const [row] = await identityDatabase()
    .select({
      id: project.id,
      orgId: project.orgId,
      publicKey: project.publicKey,
      allowedOrigins: project.allowedOrigins,
      archivedAt: project.archivedAt,
    })
    .from(project)
    .where(and(eq(project.publicKey, key), isNull(project.archivedAt)))
    .limit(1);
  return row;
}

/** Only verified signed project claims may supply this identifier. */
export async function projectOwnerForClaim(id: string) {
  if (!uuid.test(id)) return undefined;
  const [row] = await identityDatabase()
    .select({ id: project.id, orgId: project.orgId })
    .from(project)
    .where(eq(project.id, id))
    .limit(1);
  return row;
}

export async function brandAssetOwner(id: string) {
  if (!uuid.test(id)) return undefined;
  const [row] = await identityDatabase()
    .select({ id: brandAsset.id, orgId: brandAsset.orgId })
    .from(brandAsset)
    .where(eq(brandAsset.id, id))
    .limit(1);
  return row;
}

/** Call only after verifying the signed image token. No storage keys leave the bootstrap query. */
export async function imageAssetOwner(id: string) {
  if (!uuid.test(id)) return undefined;
  const [row] = await identityDatabase()
    .select({ id: feedbackAsset.id, orgId: feedbackAsset.orgId })
    .from(feedbackAsset)
    .where(eq(feedbackAsset.id, id))
    .limit(1);
  return row;
}

export async function integrationSignatureCandidates(
  provider: typeof issueIntegration.$inferSelect.provider,
  repo: unknown,
) {
  if (typeof repo !== "string" || repo.length === 0 || repo.length > 300) return [];
  return identityDatabase()
    .select({
      id: issueIntegration.id,
      orgId: issueIntegration.orgId,
      projectId: issueIntegration.projectId,
      provider: issueIntegration.provider,
      repo: issueIntegration.repo,
      webhookSecret: issueIntegration.webhookSecret,
      active: issueIntegration.active,
    })
    .from(issueIntegration)
    .where(
      and(
        eq(issueIntegration.provider, provider),
        eq(issueIntegration.active, true),
        sql`lower(${issueIntegration.repo}) = lower(${repo})`,
      ),
    );
}

/** Resolve only the tenant owner for a queue-held delivery capability. */
export async function webhookDeliveryOwner(id: string) {
  if (!uuid.test(id)) return undefined;
  const [row] = await identityDatabase()
    .select({ id: webhookDelivery.id, orgId: webhookDelivery.orgId })
    .from(webhookDelivery)
    .where(eq(webhookDelivery.id, id))
    .limit(1);
  return row;
}

export async function issueIntegrationOwner(id: string) {
  if (!uuid.test(id)) return undefined;
  const [row] = await identityDatabase()
    .select({ id: issueIntegration.id, orgId: issueIntegration.orgId, projectId: issueIntegration.projectId })
    .from(issueIntegration)
    .where(eq(issueIntegration.id, id))
    .limit(1);
  return row;
}

export async function issueLinkOwner(id: string) {
  if (!uuid.test(id)) return undefined;
  const [row] = await identityDatabase()
    .select({ id: issueLink.id, orgId: issueLink.orgId })
    .from(issueLink)
    .where(eq(issueLink.id, id))
    .limit(1);
  return row;
}
