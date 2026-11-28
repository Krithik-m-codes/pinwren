import { describe, expect, it } from "vitest";
import { customRoleCreate, customRoleUpdate, normalizePermissions } from "./custom-roles";
import {
  baseRoleForPermissions,
  CUSTOM_ROLE_PERMISSIONS,
  can,
  holdsAll,
  isPermission,
  memberUpdate,
  permissionsOf,
  permissionsOfAppRole,
  PERMISSION_GROUPS,
  PERMISSION_KEYS,
} from "./roles";

describe("permission resolver", () => {
  it("matches the built-in matrix when there is no custom role", () => {
    expect(can({ role: "member" }, "feedback.update")).toBe(true);
    expect(can({ role: "member" }, "feedback.delete")).toBe(false);
    expect(can({ role: "viewer" }, "feedback.read")).toBe(true);
    expect(can({ role: "owner" }, "roles.manage")).toBe(true);
    expect(can({ role: "member" }, "roles.manage")).toBe(false);
  });

  it("evaluates a custom role by its own list, not the base role's", () => {
    const a = { role: "member", customPermissions: ["feedback.read", "audit.read"] };
    expect(can(a, "audit.read")).toBe(true);
    // The Editor base would allow this; the custom role does not.
    expect(can(a, "feedback.update")).toBe(false);
    expect(permissionsOf(a)).toEqual(["feedback.read", "audit.read"]);
  });

  it("fails closed on unknown permissions and never grants roles.manage to a custom role", () => {
    expect(can({ role: "owner" }, "nope" as never)).toBe(false);
    expect(can({ role: "member", customPermissions: ["roles.manage", "nope"] }, "roles.manage")).toBe(false);
    expect(can({ role: "member", customPermissions: ["nope"] }, "nope" as never)).toBe(false);
    expect(isPermission("__proto__")).toBe(false);
    expect(isPermission("toString")).toBe(false);
  });

  it("never lets a custom role reduce an Admin", () => {
    expect(can({ role: "admin", customPermissions: [] }, "users.manage")).toBe(true);
    expect(can({ role: "owner", customPermissions: ["feedback.read"] }, "settings.manage")).toBe(true);
  });

  it("holdsAll is how escalation is refused", () => {
    const actor = { role: "member", customPermissions: ["feedback.read", "users.manage"] };
    expect(holdsAll(actor, ["feedback.read"])).toBe(true);
    expect(holdsAll(actor, ["feedback.read", "settings.manage"])).toBe(false);
    // An actor with users.manage still can't hand out the whole Editor role without holding it.
    expect(holdsAll(actor, permissionsOfAppRole("editor"))).toBe(false);
    expect(holdsAll({ role: "admin" }, permissionsOfAppRole("admin"))).toBe(true);
  });

  it("derives the least privileged base role", () => {
    expect(baseRoleForPermissions(["feedback.read"])).toBe("viewer");
    expect(baseRoleForPermissions(["feedback.read", "audit.read"])).toBe("viewer");
    expect(baseRoleForPermissions(["feedback.read", "labels.manage"])).toBe("editor");
    expect(baseRoleForPermissions([])).toBe("viewer");
  });

  it("lists every permission in exactly one group, except the ungrantable one", () => {
    const grouped = PERMISSION_GROUPS.flatMap((g) => g.permissions);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual([...CUSTOM_ROLE_PERMISSIONS].sort());
    expect(PERMISSION_KEYS).toContain("roles.manage");
    expect(CUSTOM_ROLE_PERMISSIONS).not.toContain("roles.manage");
  });
});

describe("custom role schemas", () => {
  it("normalises permissions: baseline added, deduplicated, catalogue order", () => {
    expect(normalizePermissions(["labels.manage", "labels.manage"])).toEqual([
      "feedback.read",
      "labels.manage",
    ]);
    const r = customRoleCreate.parse({
      name: "  Triage  ",
      permissions: ["feedback.update", "feedback.read"],
    });
    expect(r.name).toBe("Triage");
    expect(r.description).toBe("");
    expect(r.permissions).toEqual(["feedback.read", "feedback.update"]);
  });

  it("rejects unknown, instance-level and role-management permissions", () => {
    for (const p of ["roles.manage", "admin.instance", "*", ""]) {
      expect(customRoleCreate.safeParse({ name: "x", permissions: [p] }).success).toBe(false);
    }
    expect(customRoleCreate.safeParse({ name: " ", permissions: [] }).success).toBe(false);
    expect(customRoleCreate.safeParse({ name: "x".repeat(61), permissions: [] }).success).toBe(false);
  });

  it("needs something to change on update", () => {
    expect(customRoleUpdate.safeParse({}).success).toBe(false);
    expect(customRoleUpdate.safeParse({ description: "" }).success).toBe(true);
  });

  it("member update takes a built-in role or a custom role id, not both", () => {
    const id = "0192f0c4-4f6e-7c1a-8d55-9a3e2b1c4d5e";
    expect(memberUpdate.safeParse({ role: "editor" }).success).toBe(true);
    expect(memberUpdate.safeParse({ customRoleId: id }).success).toBe(true);
    expect(memberUpdate.safeParse({ role: "editor", customRoleId: id }).success).toBe(false);
    expect(memberUpdate.safeParse({ customRoleId: "not-a-uuid" }).success).toBe(false);
    expect(memberUpdate.safeParse({ role: "owner" }).success).toBe(false);
  });
});
