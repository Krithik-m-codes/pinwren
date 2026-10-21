import { BRAND_ASSET_TYPES, MAX_BRAND_ASSET_BYTES, type OrgBrandingUpdate } from "@pinwren/core";
import { brandAsset, getDb, orgSetting } from "@pinwren/db";
import { and, eq } from "drizzle-orm";
import { DEFAULT_BRAND, type EmailBrand } from "../email/templates";
import { env } from "../env";
import { ApiError, notFound } from "../errors";
import { decodeDataUrl, EXTENSIONS, storage } from "../storage";

// Organisation branding (F-094): product name, logo and accent for the dashboard and emails. Logos
// are brand assets, served without a session by random id so email clients and the widget on a
// customer's site can load them.

export const BRANDING_KEY = "branding";

export type OrgBranding = {
  productName: string | null;
  accent: string | null;
  logoAssetId: string | null;
  /** Absolute URL of the logo, or null. */
  logoUrl: string | null;
};

type Stored = { productName?: string | null; accent?: string | null; logoAssetId?: string | null };

export const brandAssetUrl = (id: string) =>
  `${env().PINWREN_URL.replace(/\/$/, "")}/api/brand-assets/${encodeURIComponent(id)}`;

export async function getOrgBranding(orgId: string): Promise<OrgBranding> {
  const [row] = await getDb()
    .select({ value: orgSetting.value })
    .from(orgSetting)
    .where(and(eq(orgSetting.orgId, orgId), eq(orgSetting.key, BRANDING_KEY)));
  const s = (row?.value ?? {}) as Stored;
  const logoAssetId = typeof s.logoAssetId === "string" ? s.logoAssetId : null;
  return {
    productName: typeof s.productName === "string" && s.productName.trim() ? s.productName : null,
    accent: typeof s.accent === "string" ? s.accent : null,
    logoAssetId,
    logoUrl: logoAssetId ? brandAssetUrl(logoAssetId) : null,
  };
}

/** Branding for emails; never throws (an unreadable setting falls back to the defaults). */
export async function emailBrand(orgId: string | null | undefined): Promise<EmailBrand> {
  if (!orgId) return DEFAULT_BRAND;
  try {
    const b = await getOrgBranding(orgId);
    return {
      productName: b.productName ?? DEFAULT_BRAND.productName,
      accent: b.accent ?? DEFAULT_BRAND.accent,
      logoUrl: b.logoUrl,
    };
  } catch {
    return DEFAULT_BRAND;
  }
}

export async function updateOrgBranding(
  orgId: string,
  patch: OrgBrandingUpdate,
  userId: string,
): Promise<OrgBranding> {
  const db = getDb();
  if (patch.logoAssetId) {
    const [a] = await db
      .select({ id: brandAsset.id })
      .from(brandAsset)
      .where(and(eq(brandAsset.id, patch.logoAssetId), eq(brandAsset.orgId, orgId)));
    if (!a) throw notFound("Logo");
  }
  const [row] = await db
    .select({ value: orgSetting.value })
    .from(orgSetting)
    .where(and(eq(orgSetting.orgId, orgId), eq(orgSetting.key, BRANDING_KEY)));
  const next: Stored = { ...((row?.value ?? {}) as Stored) };
  for (const k of ["productName", "accent", "logoAssetId"] as const) {
    if (patch[k] !== undefined) next[k] = patch[k];
  }
  await db
    .insert(orgSetting)
    .values({ orgId, key: BRANDING_KEY, value: next, updatedBy: userId })
    .onConflictDoUpdate({
      target: [orgSetting.orgId, orgSetting.key],
      set: { value: next, updatedBy: userId, updatedAt: new Date() },
    });
  return getOrgBranding(orgId);
}

/** Store an uploaded logo (PNG/JPEG/WebP, magic-byte checked, ≤ 512 KB). */
export async function saveBrandAsset(orgId: string, dataUrl: string, userId: string) {
  let file: { bytes: Uint8Array; contentType: string };
  try {
    file = decodeDataUrl(dataUrl, BRAND_ASSET_TYPES, MAX_BRAND_ASSET_BYTES);
  } catch (err) {
    throw new ApiError(400, "INVALID_IMAGE", err instanceof Error ? err.message : "Invalid image");
  }
  const key = `branding/${crypto.randomUUID()}.${EXTENSIONS[file.contentType]}`;
  await storage().put(key, file.bytes, file.contentType);
  const [a] = await getDb()
    .insert(brandAsset)
    .values({
      orgId,
      storageKey: key,
      contentType: file.contentType,
      bytes: file.bytes.length,
      createdBy: userId,
    })
    .returning({ id: brandAsset.id, contentType: brandAsset.contentType, bytes: brandAsset.bytes });
  if (!a) throw new Error("brand asset insert failed");
  return { ...a, url: brandAssetUrl(a.id) };
}
