import { project } from "@pinwren/db";
import { getDb } from "@pinwren/db";
import { eq } from "drizzle-orm";
import { decryptSecret, encryptSecret, hmacSha256Hex, randomToken, safeEqualHex } from "../crypto";

// Signed identity (wave-4 contract §4). The host app's server computes
//   signature = hex(HMAC-SHA256(identity secret, user id))
// and passes it to `Pinwren.identify(user, { signature })`. A reporter whose signature verifies is
// marked `verified`, so the team knows the name and email came from the app, not from a visitor.

type ProjectRow = typeof project.$inferSelect;

/** The project's identity secret, created on first read (like the panel-action secret). */
export async function ensureIdentitySecret(p: Pick<ProjectRow, "id" | "identitySecret">): Promise<string> {
  if (p.identitySecret) {
    try {
      return decryptSecret(p.identitySecret);
    } catch {
      // Unreadable after a PINWREN_SECRET change: issue a new one below.
    }
  }
  return rotateIdentitySecret(p.id);
}

export async function rotateIdentitySecret(projectId: string): Promise<string> {
  const secret = `idsec_${randomToken(32)}`;
  await getDb()
    .update(project)
    .set({ identitySecret: encryptSecret(secret) })
    .where(eq(project.id, projectId));
  return secret;
}

export const identitySignature = (secret: string, externalId: string) => hmacSha256Hex(secret, externalId);

/** Constant-time check of a widget-supplied signature. False when the project has no secret yet. */
export function verifyIdentity(
  encryptedSecret: string | null,
  externalId: string | undefined,
  signature: string | undefined,
): boolean {
  if (!encryptedSecret || !externalId || !signature) return false;
  let secret: string;
  try {
    secret = decryptSecret(encryptedSecret);
  } catch {
    return false;
  }
  return safeEqualHex(identitySignature(secret, externalId), signature.toLowerCase());
}
