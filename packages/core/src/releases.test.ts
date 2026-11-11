import { describe, expect, it } from "vitest";
import {
  anchorKeyOf,
  compareReleases,
  compareVersions,
  errorHash,
  errorHashesOf,
  normalizeErrorMessage,
  pagePathOf,
  parseVersion,
  releaseCreate,
  reportedRelease,
  scoreRegression,
} from "./releases";

describe("versions", () => {
  it("parses dotted versions with a v prefix, a pre-release tag and build metadata", () => {
    expect(parseVersion("v1.4.0-rc.1+b5")).toEqual({ nums: [1, 4, 0], pre: ["rc", "1"] });
    expect(parseVersion("2026.11.10")?.nums).toEqual([2026, 11, 10]);
    expect(parseVersion("a1b2c3d")).toBeNull();
    expect(parseVersion("web@3.2.1")).toBeNull();
  });

  it("orders numbers as numbers, pre-releases below the release", () => {
    expect(compareVersions("1.9.0", "1.10.0")).toBe(-1);
    expect(compareVersions("v2.0", "2.0.0")).toBe(0);
    expect(compareVersions("1.4.0", "1.4.0-rc.2")).toBe(1);
    expect(compareVersions("1.4.0-rc.2", "1.4.0-rc.10")).toBe(-1);
    expect(compareVersions("1.4.0-beta", "1.4.0-rc")).toBe(-1);
    expect(compareVersions("abc", "1.0.0")).toBeNull();
  });

  it("falls back to the deploy time for labels that are not versions", () => {
    const a = { version: "build-41", at: "2026-11-01T00:00:00Z" };
    const b = { version: "build-42", at: "2026-11-02T00:00:00Z" };
    expect(compareReleases(a, b)).toBe(-1);
    expect(compareReleases(b, a)).toBe(1);
    expect(compareReleases(a, { version: "BUILD-41" })).toBe(0);
    expect(compareReleases(a, { version: "build-43" })).toBeNull();
  });

  it("validates what CI sends", () => {
    expect(releaseCreate.safeParse({ version: "v1.4.0", commit: "9f2c1ab" }).success).toBe(true);
    expect(releaseCreate.safeParse({ version: "web@3.2.1" }).success).toBe(true);
    expect(releaseCreate.safeParse({ version: "has space" }).success).toBe(false);
    expect(releaseCreate.safeParse({ version: "" }).success).toBe(false);
    expect(releaseCreate.safeParse({ version: "1.0", commit: "not a sha!" }).success).toBe(false);
    expect(releaseCreate.safeParse({ version: "1.0", deployedAt: "yesterday" }).success).toBe(false);
  });

  it("reads the release a report carries", () => {
    expect(reportedRelease({ release: " v1.4 " })).toBe("v1.4");
    expect(reportedRelease({ release: 14 })).toBeNull();
    expect(reportedRelease({ release: "a b" })).toBeNull();
    expect(reportedRelease(null)).toBeNull();
    expect(reportedRelease({ release: "x".repeat(101) })).toBeNull();
  });
});

describe("signals", () => {
  it("normalises an error so two builds agree", () => {
    const a =
      "Uncaught TypeError: Cannot read properties of undefined (reading 'id') at https://x.io/app.3f9a1c.js:12:40";
    const b =
      "TypeError: Cannot read properties of undefined (reading 'id') at https://x.io/app.77be20.js:98:7";
    expect(errorHash(a)).toBe(errorHash(b));
    expect(errorHash(a)).not.toBe(errorHash("TypeError: x is not a function while rendering the cart"));
  });

  it("ignores noise and short messages", () => {
    expect(normalizeErrorMessage("Script error.")).toBeNull();
    expect(
      normalizeErrorMessage("Failed to load resource: the server responded with a status of 404 ()"),
    ).toBeNull();
    expect(normalizeErrorMessage("oops")).toBeNull();
  });

  it("collects the prompt error and the newest console errors, distinct", () => {
    const entries = [
      { level: "log", message: "hello hello hello", at: 1 },
      { level: "error", message: "ReferenceError: cart is not defined", at: 2 },
      { level: "error", message: "ReferenceError: cart is not defined", at: 3 },
      { level: "error", message: "TypeError: price.toFixed is not a function", at: 4 },
    ];
    const hashes = errorHashesOf(entries, {
      error: { message: "RangeError: Invalid array length in checkout" },
    });
    expect(hashes).toHaveLength(3);
    expect(hashes[0]).toBe(errorHash("RangeError: Invalid array length in checkout"));
    expect(errorHashesOf(undefined, undefined)).toEqual([]);
    expect(errorHashesOf("nope", "nope")).toEqual([]);
  });

  it("reduces a URL to its path", () => {
    expect(pagePathOf("https://x.io/pricing/?a=1#top")).toBe("/pricing");
    expect(pagePathOf("https://x.io/")).toBe("/");
    expect(pagePathOf("not a url")).toBeNull();
    expect(pagePathOf(null)).toBeNull();
  });

  it("keys an anchor by the most stable handle", () => {
    expect(anchorKeyOf({ attrs: { pinwrenAnchor: "buy", testId: "x" }, css: "div > a" })).toBe("pw:buy");
    expect(anchorKeyOf({ attrs: { testId: "x" }, css: "div > a" })).toBe("tid:x");
    expect(anchorKeyOf({ css: "main > button.buy" })).toBe("css:main > button.buy");
    expect(anchorKeyOf({})).toBeNull();
    expect(anchorKeyOf(null)).toBeNull();
  });
});

describe("scoreRegression", () => {
  const old = { path: "/checkout", anchor: "css:button.pay", errors: ["e1", "e2"] };

  it("needs a shared error or the same element on the same page", () => {
    expect(scoreRegression({ path: "/checkout", anchor: null, errors: [] }, old)).toBeNull();
    expect(scoreRegression({ path: "/other", anchor: "css:button.pay", errors: [] }, old)).toBeNull();
    expect(scoreRegression({ path: "/checkout", anchor: "css:button.other", errors: [] }, old)).toBeNull();
    expect(scoreRegression({ path: null, anchor: null, errors: ["zzz"] }, old)).toBeNull();
  });

  it("a shared error alone is possible; with the element it is likely", () => {
    const err = scoreRegression({ path: "/x", anchor: null, errors: ["e2"] }, old);
    expect(err).toMatchObject({ score: 50, confidence: "possible", signals: ["error"] });
    const both = scoreRegression({ path: "/checkout", anchor: "css:button.pay", errors: ["e1"] }, old);
    expect(both).toMatchObject({ score: 100, confidence: "likely", signals: ["error", "element"] });
    const element = scoreRegression({ path: "/checkout", anchor: "css:button.pay", errors: [] }, old);
    expect(element).toMatchObject({ score: 40, confidence: "possible", signals: ["element"] });
  });

  it("raises confidence for a report from the fixed release or later", () => {
    const fresh = { path: "/x", anchor: null, errors: ["e1"] };
    const fixedIn = { version: "1.4.0" };
    const later = scoreRegression(fresh, old, { reported: { version: "1.4.1" }, fixedIn });
    expect(later).toMatchObject({ score: 70, confidence: "likely", afterFix: true });
    expect(later?.signals).toContain("release");
    const same = scoreRegression(fresh, old, { reported: { version: "v1.4.0" }, fixedIn });
    expect(same?.afterFix).toBe(true);
  });

  it("a report from before the fix is dropped unless the evidence is strong", () => {
    const fixedIn = { version: "1.4.0" };
    const reported = { version: "1.3.9" };
    expect(
      scoreRegression({ path: "/x", anchor: null, errors: ["e1"] }, old, { reported, fixedIn }),
    ).toBeNull();
    const strong = scoreRegression({ path: "/checkout", anchor: "css:button.pay", errors: ["e1"] }, old, {
      reported,
      fixedIn,
    });
    expect(strong).toMatchObject({ score: 60, confidence: "possible", afterFix: false });
  });

  it("leaves the score alone when the releases cannot be ordered", () => {
    const m = scoreRegression({ path: "/x", anchor: null, errors: ["e1"] }, old, {
      reported: { version: "deadbeef" },
      fixedIn: { version: "1.4.0" },
    });
    expect(m).toMatchObject({ score: 50, afterFix: null });
  });
});
