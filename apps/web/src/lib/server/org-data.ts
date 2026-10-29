import "server-only";
import { env } from "@pinwren/api";
import { getDb } from "@pinwren/db";
import { cacheLife, cacheTag } from "next/cache";
import type { OrgBranding } from "@/lib/api";

// Organisation-level data that is the same for every member, cached on the server with `use cache` and
// tagged per organisation. The exported getters take an org id the caller has already resolved from the
// member's session (`requireViewer`); the cached functions themselves are never handed a raw id from a
// request. Mutations refresh them with `updateTag` (lib/server/actions.ts).

export const brandingTag = (orgId: string) => `branding:${orgId}`;

/** Workspace branding (F-094) as `GET /api/branding` returns it (`org_setting` key "branding"). */
export async function getOrgBranding(orgId: string): Promise<OrgBranding> {
  "use cache";
  cacheTag(brandingTag(orgId));
  cacheLife("hours");
  const row = await getDb().query.orgSetting.findFirst({
    where: (t, { and, eq }) => and(eq(t.orgId, orgId), eq(t.key, "branding")),
    columns: { value: true },
  });
  const s = row?.value ?? {};
  const logoAssetId = typeof s.logoAssetId === "string" ? s.logoAssetId : null;
  const faviconAssetId = typeof s.faviconAssetId === "string" ? s.faviconAssetId : null;
  return {
    productName: typeof s.productName === "string" && s.productName.trim() ? s.productName : null,
    accent: typeof s.accent === "string" ? s.accent : null,
    logoAssetId,
    logoUrl: logoAssetId
      ? `${env().PINWREN_URL.replace(/\/$/, "")}/api/brand-assets/${encodeURIComponent(logoAssetId)}`
      : null,
    faviconAssetId,
    faviconUrl: faviconAssetId
      ? `${env().PINWREN_URL.replace(/\/$/, "")}/api/brand-assets/${encodeURIComponent(faviconAssetId)}`
      : null,
  };
}

export const workspaceTag = (orgId: string) => `workspace:${orgId}`;

/** The workspace's name, for the sidebar header. */
export async function getWorkspaceName(orgId: string): Promise<string | null> {
  "use cache";
  cacheTag(workspaceTag(orgId));
  cacheLife("hours");
  const o = await getDb().query.organization.findFirst({
    where: (t, { eq }) => eq(t.id, orgId),
    columns: { name: true },
  });
  return o?.name ?? null;
}
