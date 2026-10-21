import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, readableOn, resolveBranding, resolveConfig, safeLogoUrl } from "./config";

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
      panelActions: [],
      privacyMode: false,
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

describe("panel actions (wave-3 §1)", () => {
  const ok = {
    id: "jira",
    label: "Create ticket",
    kind: "link",
    url: "https://x.test/{id}",
    visibleTo: "everyone",
  };

  it("keeps well-formed actions and defaults the icon", () => {
    const [a] = resolveConfig({ panelActions: [ok] }).panelActions;
    expect(a).toEqual({ ...ok, icon: null });
  });

  it("drops malformed ones, non-http URLs and anything past five", () => {
    const c = resolveConfig({
      panelActions: [
        { ...ok, id: "Bad Id" },
        { ...ok, url: "javascript:alert(1)" },
        { ...ok, kind: "email" },
        { ...ok, label: "  " },
        "nope",
        ...Array.from({ length: 7 }, (_, i) => ({ ...ok, id: `a${i}`, icon: "rocket", visibleTo: "x" })),
      ],
    });
    expect(c.panelActions.map((a) => a.id)).toEqual(["a0", "a1", "a2", "a3", "a4"]);
    expect(c.panelActions[0]?.icon).toBeNull();
    // An unknown audience is treated as the safer one: dashboard only.
    expect(c.panelActions[0]?.visibleTo).toBe("team");
    expect(resolveConfig({ panelActions: { 0: ok } }).panelActions).toEqual([]);
  });

  it("truncates long labels", () => {
    expect(
      resolveConfig({ panelActions: [{ ...ok, label: "x".repeat(60) }] }).panelActions[0]?.label,
    ).toHaveLength(40);
  });
});

describe("branding (wave-3 §2)", () => {
  const api = "https://pinwren.example.com";

  it("defaults to Pinwren's own branding", () => {
    expect(resolveBranding(undefined, api)).toEqual({
      hidePoweredBy: false,
      dialogAccent: null,
      logoUrl: null,
    });
  });

  it("only accepts a hex dialog accent", () => {
    expect(resolveBranding({ dialogAccent: "#0f766e" }, api).dialogAccent).toBe("#0f766e");
    expect(resolveBranding({ dialogAccent: "red;}*{display:none" }, api).dialogAccent).toBeNull();
    expect(resolveBranding({ hidePoweredBy: "yes" }, api).hidePoweredBy).toBe(false);
    expect(resolveBranding({ hidePoweredBy: true }, api).hidePoweredBy).toBe(true);
  });

  it("accepts https logos and the server's own /api/assets/ URLs, nothing else", () => {
    expect(safeLogoUrl("https://cdn.example.com/logo.png", api)).toBe("https://cdn.example.com/logo.png");
    expect(safeLogoUrl("/api/assets/abc", api)).toBe("https://pinwren.example.com/api/assets/abc");
    // Plain-http dev server: its own asset URLs work, other http URLs don't.
    expect(safeLogoUrl("/api/assets/abc", "http://localhost:3100")).toBe(
      "http://localhost:3100/api/assets/abc",
    );
    expect(safeLogoUrl("http://localhost:3100/api/assets/abc", "http://localhost:3100")).toBe(
      "http://localhost:3100/api/assets/abc",
    );
    expect(safeLogoUrl("http://evil.test/api/assets/abc", "http://localhost:3100")).toBeNull();
    expect(safeLogoUrl("http://localhost:3100/api/brand-assets/b1", "http://localhost:3100")).toBe(
      "http://localhost:3100/api/brand-assets/b1",
    );
    expect(safeLogoUrl("/api/other/x", "http://localhost:3100")).toBeNull();
    expect(safeLogoUrl("/api/assets/../users", "http://localhost:3100")).toBeNull();
    expect(safeLogoUrl("http://cdn.example.com/logo.png", api)).toBeNull();
    expect(safeLogoUrl("javascript:alert(1)", api)).toBeNull();
    expect(safeLogoUrl("data:image/svg+xml,<svg/>", api)).toBeNull();
    expect(safeLogoUrl("https://user:pw@cdn.example.com/x.png", api)).toBeNull();
    expect(safeLogoUrl(42, api)).toBeNull();
    expect(safeLogoUrl("", api)).toBeNull();
  });

  it("picks readable text for the accent", () => {
    expect(readableOn("#5b5bd6")).toBe("#ffffff");
    expect(readableOn("#0f766e")).toBe("#ffffff");
    expect(readableOn("#fde047")).toBe("#18181b");
    expect(readableOn("#fff")).toBe("#18181b");
  });
});
