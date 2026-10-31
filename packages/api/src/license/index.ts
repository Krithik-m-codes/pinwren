import { readFile } from "node:fs/promises";
import {
  type BillingPlan,
  type BillingPlanId,
  type Entitlements,
  LICENSE_FEATURES,
  type LicenseFeature,
  type LicensePayload,
} from "@pinwren/core";
import { currentOrgId, getDb, member, user } from "@pinwren/db";
import { count, eq } from "drizzle-orm";
import { latestInstanceLicense, saveInstanceLicense, removeInstanceLicenses } from "../db/system";
import { env } from "../env";
import { ApiError } from "../errors";
import { billingEnabled } from "../billing/config";
import { planFor } from "../billing/service";
import { trustedKeys } from "./keys";
import { licenseTimeState, verifyLicense } from "./verify";

// Entitlements (F-098, wave-4 contract §6), resolved on the server from the licence in force:
// PINWREN_LICENSE_FILE (locks the upload) or the newest uploaded file. Nothing phones home. Only
// `white_label` and `jira` gate anything; Community never calls into Enterprise code to nag or degrade.

export type LicenseSource = "file" | "upload" | null;
export type Resolved = Entitlements & { source: LicenseSource; payload: LicensePayload | null };

const CACHE_MS = 60_000;
const g = globalThis as unknown as {
  __pinwrenLicense?: { at: number; value: Promise<Resolved> } | undefined;
};

async function seatsUsed(): Promise<number> {
  if (env().PINWREN_MODE === "cloud") {
    const orgId = currentOrgId();
    if (!orgId) throw new Error("Cloud entitlements require a verified organization");
    const [row] = await getDb().select({ n: count() }).from(member).where(eq(member.organizationId, orgId));
    return row?.n ?? 0;
  }
  const [row] = await getDb().select({ n: count() }).from(user);
  return row?.n ?? 0;
}

async function currentRaw(): Promise<{ raw: string; source: LicenseSource } | null> {
  const file = env().PINWREN_LICENSE_FILE;
  if (file) {
    try {
      return { raw: await readFile(file, "utf8"), source: "file" };
    } catch (err) {
      console.warn(`[pinwren] PINWREN_LICENSE_FILE ${file} cannot be read`, err);
      return { raw: "", source: "file" };
    }
  }
  const row = await latestInstanceLicense();
  return row ? { raw: row.raw, source: "upload" } : null;
}

/** Entitlements for a licence text (pure apart from the seat count). */
export function entitlementsFor(
  raw: string | null,
  source: LicenseSource,
  used: number,
  now = new Date(),
): Resolved {
  const community: Resolved = {
    edition: "community",
    status: "none",
    features: [],
    readOnly: false,
    license: null,
    error: null,
    seats: { limit: null, used },
    source,
    payload: null,
  };
  if (raw === null) return community;
  const v = verifyLicense(raw, trustedKeys(), { now, instanceId: env().PINWREN_INSTANCE_ID });
  if (!v.ok) return { ...community, status: "invalid", error: v.error };
  const p = v.payload;
  const time = licenseTimeState(p, now);
  const known = new Set<string>(LICENSE_FEATURES);
  return {
    edition: "enterprise",
    status: time.status,
    features: p.features.filter((f): f is LicenseFeature => known.has(f)),
    readOnly: time.status === "expired",
    license: {
      lid: p.lid,
      customer: p.customer,
      expiresAt: p.expiresAt,
      graceEndsAt: time.graceEndsAt.toISOString(),
      daysLeft: time.daysLeft,
      seats: p.limits.seats ?? null,
    },
    error: null,
    seats: { limit: p.limits.seats ?? null, used },
    source,
    payload: p,
  };
}

async function cloudPlan() {
  const orgId = currentOrgId();
  if (!orgId) throw new Error("Cloud entitlements require a verified organization");
  return planFor(getDb(), orgId);
}

/**
 * Cloud billing feeds the same entitlement model (WP-22): the plan in force adds its features to whatever a
 * licence grants and sets the seat limit. Without billing configured (staging, tests) nothing changes.
 */
export function withCloudPlan(
  base: Resolved,
  plan: { plan: BillingPlanId; definition: BillingPlan },
): Resolved {
  if (!billingEnabled()) return base;
  const features = [...new Set<LicenseFeature>([...base.features, ...plan.definition.features])];
  return {
    ...base,
    edition: base.edition === "enterprise" ? "enterprise" : "cloud",
    features,
    seats: { ...base.seats, limit: base.seats.limit ?? plan.definition.limits.seats },
    plan: plan.plan,
  };
}

/** Resolved entitlements, cached per process for a minute (uploads clear the cache). */
export function resolveEntitlements(): Promise<Resolved> {
  if (env().PINWREN_MODE === "cloud") {
    // A process-wide resolved value includes seat counts and must never cross tenant boundaries.
    return Promise.all([currentRaw(), seatsUsed(), cloudPlan()]).then(([current, used, plan]) =>
      withCloudPlan(entitlementsFor(current?.raw ?? null, current?.source ?? null, used), plan),
    );
  }
  const hit = g.__pinwrenLicense;
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = (async () => {
    const [current, used] = await Promise.all([currentRaw(), seatsUsed()]);
    return entitlementsFor(current?.raw ?? null, current?.source ?? null, used);
  })();
  value.catch(() => {
    if (g.__pinwrenLicense?.value === value) g.__pinwrenLicense = undefined;
  });
  g.__pinwrenLicense = { at: Date.now(), value };
  return value;
}

export const invalidateLicenseCache = () => {
  g.__pinwrenLicense = undefined;
};

/** The feature applies (valid, in grace, or read-only after grace). Never throws: no licence = false. */
export async function hasFeature(feature: LicenseFeature): Promise<boolean> {
  try {
    return (await resolveEntitlements()).features.includes(feature);
  } catch (err) {
    console.warn("[pinwren] licence check failed", err);
    return false;
  }
}

/** Refuse changing an Enterprise setting once the licence is past its grace period. */
export async function assertFeatureWritable(feature: LicenseFeature): Promise<void> {
  const e = await resolveEntitlements();
  if (e.features.includes(feature) && e.readOnly) {
    throw new ApiError(
      403,
      "LICENSE_READ_ONLY",
      "Your Enterprise licence has expired: this setting keeps working but can't be changed until you renew",
    );
  }
}

/** Public view (no payload/source details beyond what the dashboard shows). */
export const publicEntitlements = ({ source: _s, payload: _p, ...e }: Resolved): Entitlements => e;

export async function installLicense(raw: string, userId: string): Promise<Resolved> {
  if (env().PINWREN_LICENSE_FILE) {
    throw new ApiError(409, "LICENSE_LOCKED", "The licence is set by PINWREN_LICENSE_FILE on the server");
  }
  const checked = entitlementsFor(raw, "upload", await seatsUsed());
  if (checked.status === "invalid" || !checked.payload) {
    throw new ApiError(400, "INVALID_LICENSE", checked.error ?? "Invalid licence");
  }
  await saveInstanceLicense({ raw: raw.trim(), payload: checked.payload, installedBy: userId });
  invalidateLicenseCache();
  return resolveEntitlements();
}

export async function removeLicense(): Promise<Resolved> {
  if (env().PINWREN_LICENSE_FILE) {
    throw new ApiError(409, "LICENSE_LOCKED", "The licence is set by PINWREN_LICENSE_FILE on the server");
  }
  await removeInstanceLicenses();
  invalidateLicenseCache();
  return resolveEntitlements();
}
