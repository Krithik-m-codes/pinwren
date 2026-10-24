"use server";

import { updateTag } from "next/cache";
import { brandingTag, workspaceTag } from "./org-data";
import { getAuth } from "@pinwren/api";
import { headers } from "next/headers";

/**
 * After the client saved the workspace branding through the API: expire the server's cached copy so the
 * sidebar, product name and theme re-render with it (read-your-own-writes). Authorises itself from the
 * session — the org id never comes from the client.
 */
export async function refreshBranding(): Promise<void> {
  const s = await getAuth().api.getSession({ headers: await headers() });
  const orgId = s?.session.activeOrganizationId;
  if (orgId) updateTag(brandingTag(orgId));
}

/** After renaming the workspace through the API: expire the cached name the sidebar shows. */
export async function refreshWorkspace(): Promise<void> {
  const s = await getAuth().api.getSession({ headers: await headers() });
  const orgId = s?.session.activeOrganizationId;
  if (orgId) updateTag(workspaceTag(orgId));
}
