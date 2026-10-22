import { feedbackAsset, getDb } from "@pinwren/db";
import { and, eq } from "drizzle-orm";
import { notFound } from "../errors";
import { storage } from "../storage";

/**
 * Stream one feedback file (screenshot, attachment, session replay) of the organisation. Shared by the
 * dashboard (session) and the public API (token). Files are always served through the API, sandboxed,
 * never as something other than their checked type.
 */
export async function assetResponse(orgId: string, id: string): Promise<Response> {
  const [a] = await getDb()
    .select()
    .from(feedbackAsset)
    .where(and(eq(feedbackAsset.id, id), eq(feedbackAsset.orgId, orgId)));
  if (!a) throw notFound("Asset");
  const file = await storage().get(a.storageKey);
  if (!file) throw notFound("Asset file");
  const headers: Record<string, string> = {
    "content-type": a.contentType,
    "cache-control": "private, max-age=3600",
    "content-security-policy": "default-src 'none'; sandbox",
    "x-content-type-options": "nosniff",
  };
  if (file.bytes) headers["content-length"] = String(file.bytes);
  if (a.kind === "attachment") {
    // Non-images download rather than render (blueprint 09: Content-Disposition for non-images).
    const safe = (a.name ?? "attachment").replace(/[^\w.-]+/g, "_").slice(0, 120) || "attachment";
    const disposition = a.contentType.startsWith("image/") ? "inline" : "attachment";
    headers["content-disposition"] =
      `${disposition}; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(a.name ?? safe)}`;
  }
  return new Response(file.body, { headers });
}
