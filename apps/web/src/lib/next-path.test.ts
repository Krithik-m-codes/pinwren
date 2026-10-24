import { describe, expect, it } from "vitest";
import { safeNext, withNext } from "./next-path";

describe("safeNext", () => {
  it("keeps paths on this site, with their query", () => {
    expect(safeNext("/inbox?org=o1&item=f1")).toBe("/inbox?org=o1&item=f1");
    expect(safeNext("/settings/members")).toBe("/settings/members");
    expect(safeNext("/projects/p1#install")).toBe("/projects/p1#install");
  });

  it("refuses anything that could leave the site", () => {
    for (const bad of [
      "https://evil.example/inbox",
      "//evil.example/inbox",
      "/\\evil.example",
      "javascript:alert(1)",
      "inbox",
      "/\tevil",
      "",
      null,
      undefined,
    ]) {
      expect(safeNext(bad)).toBe("/inbox");
    }
  });

  it("never loops back to an auth page", () => {
    expect(safeNext("/sign-in?next=/inbox")).toBe("/inbox");
    expect(safeNext("/reset-password?token=x", "/x")).toBe("/x");
  });

  it("withNext carries only a safe destination", () => {
    expect(withNext("/sign-up", "/inbox?item=1")).toBe("/sign-up?next=%2Finbox%3Fitem%3D1");
    expect(withNext("/sign-up", "https://evil.example")).toBe("/sign-up");
    expect(withNext("/sign-up", null)).toBe("/sign-up");
  });
});
