import { describe, expect, it } from "vitest";
import {
  IMPLEMENTED_LICENSE_FEATURES,
  isImplementedLicenseFeature,
  LICENSE_FEATURES,
  licensePayload,
  PLANNED_LICENSE_FEATURES,
} from "./license";

// The Licence page lists implemented entitlements and "Coming soon" ones apart (wave-5 install-onboarding).

describe("licence features", () => {
  it("splits every known feature into implemented or planned, never both", () => {
    expect([...LICENSE_FEATURES].sort()).toEqual(
      [...IMPLEMENTED_LICENSE_FEATURES, ...PLANNED_LICENSE_FEATURES].sort(),
    );
    for (const f of IMPLEMENTED_LICENSE_FEATURES) expect(PLANNED_LICENSE_FEATURES).not.toContain(f);
    expect(isImplementedLicenseFeature("white_label")).toBe(true);
    expect(isImplementedLicenseFeature("sso")).toBe(false);
  });

  it("still accepts licences naming planned or unknown features", () => {
    const parsed = licensePayload.safeParse({
      v: 1,
      kid: "k1",
      lid: "l1",
      customer: "Acme",
      edition: "enterprise",
      features: ["sso", "white_label", "future_thing"],
      issuedAt: "2026-01-01T00:00:00Z",
      expiresAt: "2027-01-01T00:00:00Z",
    });
    expect(parsed.success).toBe(true);
  });
});
