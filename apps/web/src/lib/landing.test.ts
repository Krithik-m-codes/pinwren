import { describe, expect, it } from "vitest";
import { landingCookie, landingPath, parseLanding, readLandingCookie } from "./landing";

describe("start page", () => {
  it("maps each choice to its route and falls back to the inbox", () => {
    expect(landingPath("dashboard")).toBe("/dashboard");
    expect(landingPath("my-work")).toBe("/inbox?assignee=me");
    expect(landingPath("inbox")).toBe("/inbox");
    for (const bad of [undefined, null, "", "//evil.example", "/dashboard", "constructor"]) {
      expect(parseLanding(bad)).toBe("inbox");
    }
  });

  it("stores a choice for a year and clears the cookie for the default", () => {
    expect(landingCookie("dashboard")).toContain("pinwren_landing=dashboard;");
    expect(landingCookie("dashboard")).toContain("max-age=31536000");
    expect(landingCookie("inbox")).toContain("max-age=0");
  });

  it("reads the choice back out of document.cookie", () => {
    expect(readLandingCookie("a=1; pinwren_landing=my-work; b=2")).toBe("my-work");
    expect(readLandingCookie("a=1")).toBe("inbox");
    expect(readLandingCookie("xpinwren_landing=dashboard")).toBe("inbox");
  });
});
