import { describe, expect, it } from "vitest";
import { en } from "./i18n/en";
import { GO_CHORDS, goTarget, SHORTCUT_GROUPS } from "./shortcuts";

describe("shortcuts", () => {
  it("resolves go-to chords and ignores everything else", () => {
    expect(goTarget("d")).toBe("/dashboard");
    expect(goTarget("m")).toBe("/inbox?assignee=me");
    expect(goTarget("z")).toBeNull();
    expect(goTarget("toString")).toBeNull();
  });

  it("documents every chord and only uses keys that have English text", () => {
    const rows = SHORTCUT_GROUPS.flatMap((g) => g.rows);
    for (const k of Object.keys(GO_CHORDS)) expect(rows.map((r) => r[0])).toContain(`g ${k}`);
    for (const g of SHORTCUT_GROUPS) {
      expect(en).toHaveProperty(g.title);
      for (const [, label] of g.rows) expect(en).toHaveProperty(label);
    }
  });
});
