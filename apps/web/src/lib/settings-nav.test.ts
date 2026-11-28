import { describe, expect, it } from "vitest";
import { SETTINGS_PAGES, visibleSettingsPages } from "./settings-nav";

const labels = (role: string, instanceAdmin: boolean) =>
  visibleSettingsPages({ role, instanceAdmin }).map((p) => p.label);

describe("settings pages shown to each person", () => {
  it("shows everything to an instance admin who is a workspace admin", () => {
    // Other areas add pages to the list; every one of them is visible to someone with every role.
    expect(labels("owner", true)).toEqual(
      SETTINGS_PAGES.filter((p) => p.label !== "Billing").map((p) => p.label),
    );
    expect(labels("owner", true)).toEqual(
      expect.arrayContaining([
        "Profile",
        "Notifications",
        "Integrations",
        "Branding",
        "Email",
        "Security",
        "Licence",
        "AI",
      ]),
    );
  });

  it("hides workspace and instance settings from Editors and Viewers", () => {
    for (const role of ["member", "viewer"]) {
      const l = labels(role, false);
      expect(l).toContain("Profile");
      expect(l).not.toContain("Branding");
      expect(l).not.toContain("AI");
      expect(l).not.toContain("Integrations");
      expect(l).not.toContain("Email");
      expect(l).not.toContain("Licence");
    }
  });

  it("gives a workspace Admin the email templates but not instance security", () => {
    const l = labels("admin", false);
    expect(l).toContain("Email");
    expect(l).toContain("Branding");
    expect(l).not.toContain("Security");
  });
});

describe("billing page", () => {
  const labelsFor = (role: string, cloud: boolean) =>
    visibleSettingsPages({ role, instanceAdmin: false, cloud }).map((p) => p.label);

  it("is for workspace admins on Cloud only", () => {
    expect(labelsFor("owner", true)).toContain("Billing");
    expect(labelsFor("admin", true)).toContain("Billing");
    expect(labelsFor("member", true)).not.toContain("Billing");
    expect(labelsFor("owner", false)).not.toContain("Billing");
    expect(visibleSettingsPages({ role: "owner", instanceAdmin: true }).map((p) => p.label)).not.toContain(
      "Billing",
    );
  });
});

describe("roles page and audit access for custom roles", () => {
  const names = (role: string, permissions?: string[]) =>
    visibleSettingsPages({ role, instanceAdmin: false, permissions }).map((p) => p.label);

  it("shows Roles to workspace Admins only", () => {
    expect(names("owner")).toContain("Roles");
    expect(names("admin")).toContain("Roles");
    expect(names("member")).not.toContain("Roles");
    // roles.manage can never be granted to a custom role, so a permission list doesn't open the page.
    expect(names("member", ["feedback.read", "users.manage"])).not.toContain("Roles");
  });

  it("shows the audit log to Admins and to anyone holding audit.read", () => {
    expect(names("admin")).toContain("Audit log");
    expect(names("viewer", ["feedback.read", "audit.read"])).toContain("Audit log");
    expect(names("viewer", ["feedback.read"])).not.toContain("Audit log");
    expect(names("member")).not.toContain("Audit log");
  });
});
