import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, resolveConfig } from "./config";

describe("resolveConfig", () => {
  it("fills every key from the contract defaults", () => {
    expect(resolveConfig(undefined)).toEqual({
      launcher: {
        position: "bottom-right",
        offset: { x: 20, y: 20 },
        shape: "round",
        label: "Feedback",
        icon: "pin",
        accent: "#5b5bd6",
        tooltip: "Give feedback",
        hidden: false,
      },
      modes: { comment: true, bug: true },
      shortcuts: true,
      rightClickComment: false,
      readOnly: false,
      visitorsCanResolve: true,
      consent: { enabled: false, text: null, privacyUrl: null },
    });
  });

  it("merges partial nested config over the defaults", () => {
    const c = resolveConfig({
      launcher: { shape: "pill", label: "Comments" },
      modes: { bug: false },
      readOnly: true,
    });
    expect(c.launcher.shape).toBe("pill");
    expect(c.launcher.label).toBe("Comments");
    expect(c.launcher.position).toBe("bottom-right");
    expect(c.modes).toEqual({ comment: true, bug: false });
    expect(c.readOnly).toBe(true);
  });

  it("accepts null for nullable strings", () => {
    const c = resolveConfig({
      launcher: { tooltip: null, label: null },
      consent: { enabled: true, text: "Hi" },
    });
    expect(c.launcher.tooltip).toBeNull();
    expect(c.launcher.label).toBeNull();
    expect(c.consent).toEqual({ enabled: true, text: "Hi", privacyUrl: null });
  });

  it("rejects wrong types and unknown enum values", () => {
    const c = resolveConfig({
      launcher: {
        position: "middle",
        shape: "square",
        icon: "rocket",
        offset: { x: "9", y: -40 },
        hidden: "yes",
      },
      readOnly: "true",
      extra: 1,
    });
    expect(c.launcher.position).toBe("bottom-right");
    expect(c.launcher.shape).toBe("round");
    expect(c.launcher.icon).toBe("pin");
    expect(c.launcher.offset).toEqual({ x: 20, y: 0 });
    expect(c.launcher.hidden).toBe(false);
    expect(c.readOnly).toBe(false);
    expect(c).not.toHaveProperty("extra");
  });

  it("only lets plain hex colours into the accent (it becomes a CSS variable)", () => {
    expect(resolveConfig({ launcher: { accent: "red;}body{display:none" } }).launcher.accent).toBe("#5b5bd6");
    expect(resolveConfig({ launcher: { accent: "#E11D48" } }).launcher.accent).toBe("#E11D48");
    expect(resolveConfig({}, "#0090ff").launcher.accent).toBe("#0090ff");
  });

  it("never mutates the shared defaults", () => {
    const before = JSON.stringify(DEFAULT_CONFIG);
    resolveConfig({ launcher: { position: "nope", offset: { x: 1e9, y: 3 } } });
    resolveConfig(null);
    expect(JSON.stringify(DEFAULT_CONFIG)).toBe(before);
  });
});
