import { z } from "zod";

// Enterprise licence files (F-098, blueprint 07 §4, wave-4 contract §6). A `.lic` file is
// `base64url(payload JSON) "." base64url(Ed25519 signature of the first segment)`. Verification is
// offline (no phone-home) against public keys compiled into the server, chosen by `kid`.

export const LICENSE_FEATURES = [
  "sso",
  "scim",
  "audit_log",
  "custom_roles",
  "white_label",
  "jira",
  "legal_hold",
  "siem_stream",
  "priority_support",
] as const;
export type LicenseFeature = (typeof LICENSE_FEATURES)[number];

export const licensePayload = z.object({
  v: z.literal(1),
  /** Signing key id: picks the public key that verifies this file (key rotation). */
  kid: z.string().min(1).max(64),
  lid: z.string().min(1).max(100),
  customer: z.string().min(1).max(200),
  email: z.email().max(254).optional(),
  edition: z.literal("enterprise"),
  /** Unknown feature names from newer issuers are kept and simply grant nothing here. */
  features: z.array(z.string().min(1).max(64)).max(100),
  limits: z.object({ seats: z.number().int().positive().optional() }).loose().default({}),
  /** Optional binding to one instance (`PINWREN_INSTANCE_ID`). */
  instance: z.string().max(200).nullable().default(null),
  issuedAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }),
  graceDays: z.number().int().min(0).max(365).default(30),
});
export type LicensePayload = z.infer<typeof licensePayload>;
export type LicensePayloadInput = z.input<typeof licensePayload>;

/**
 * none: no licence installed (Community). valid: before expiresAt. grace: expired, within graceDays —
 * everything still works, admins see a banner. expired: past grace — Enterprise settings become
 * read-only (what is configured keeps working; nothing new can be set). invalid: bad signature,
 * unknown key, malformed, not yet valid or bound to another instance — treated as no licence.
 */
export const LICENSE_STATUSES = ["none", "valid", "grace", "expired", "invalid"] as const;
export type LicenseStatus = (typeof LICENSE_STATUSES)[number];

export const licenseUpload = z.object({
  /** The `.lic` file's text. */
  license: z.string().trim().min(10).max(20_000),
});

/** `GET /api/me/entitlements` (and `GET /api/admin/license` for instance admins, with `source`). */
export const entitlementsResponse = z.object({
  edition: z.enum(["community", "enterprise"]),
  status: z.enum(LICENSE_STATUSES),
  /** Features that apply now (also after grace, read-only). */
  features: z.array(z.enum(LICENSE_FEATURES)),
  /** Past the grace period: Enterprise settings keep their effect but can't be changed. */
  readOnly: z.boolean(),
  license: z
    .object({
      lid: z.string(),
      customer: z.string(),
      expiresAt: z.string(),
      graceEndsAt: z.string(),
      daysLeft: z.number().int(),
      seats: z.number().int().nullable(),
    })
    .nullable(),
  /** Why an installed licence is not in force (status "invalid"). */
  error: z.string().nullable(),
  seats: z.object({ limit: z.number().int().nullable(), used: z.number().int() }),
});
export type Entitlements = z.infer<typeof entitlementsResponse>;
