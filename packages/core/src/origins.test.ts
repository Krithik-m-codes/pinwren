import { describe, expect, it } from "vitest";
import { isIgnoredQueryParam, isOriginAllowed, normalizePageUrl, originMatches } from "./origins";

describe("originMatches", () => {
  it.each([
    ["https://example.com", "example.com", true],
    ["https://www.example.com", "example.com", false],
    ["https://www.example.com", "*.example.com", true],
    ["https://example.com", "*.example.com", false],
    ["http://localhost:3000", "localhost:3000", true],
    ["http://localhost:4000", "localhost:3000", false],
    ["https://evil-example.com", "example.com", false],
    ["https://example.com.evil.io", "*.example.com", false],
    ["https://EXAMPLE.com", "https://example.com/", true],
    ["not a url", "example.com", false],
  ])("%s vs %s → %s", (origin, pattern, expected) => {
    expect(originMatches(origin, pattern)).toBe(expected);
  });

  it("rejects missing origins", () => {
    expect(isOriginAllowed(null, ["example.com"])).toBe(false);
  });
});

describe("normalizePageUrl", () => {
  it("drops the hash and sorts the query", () => {
    expect(normalizePageUrl("https://a.com/p?b=2&a=1#x")).toBe("https://a.com/p?a=1&b=2");
  });

  it("drops deep-link, review-link and tracking parameters", () => {
    expect(normalizePageUrl("https://a.com/p?pinwren=abc&pwt=t&b=2")).toBe("https://a.com/p?b=2");
    expect(normalizePageUrl("https://a.com/p?utm_source=x&utm_medium=y&gclid=1&fbclid=2")).toBe(
      "https://a.com/p",
    );
    expect(normalizePageUrl("https://a.com/p?pinwren_review=tok&ref=x&q=1")).toBe("https://a.com/p?q=1");
  });

  it("folds a trailing slash but keeps the root", () => {
    expect(normalizePageUrl("https://a.com/pricing/")).toBe("https://a.com/pricing");
    expect(normalizePageUrl("https://a.com/pricing//?b=1")).toBe("https://a.com/pricing?b=1");
    expect(normalizePageUrl("https://a.com/")).toBe("https://a.com/");
    expect(normalizePageUrl("https://a.com")).toBe("https://a.com/");
  });

  it("drops a project's own ignored parameters, with prefix wildcards", () => {
    expect(normalizePageUrl("https://a.com/p?sid=1&hsa_cam=2&id=3", ["sid", "HSA_*"])).toBe(
      "https://a.com/p?id=3",
    );
    expect(isIgnoredQueryParam("Gclid")).toBe(true);
    expect(isIgnoredQueryParam("page")).toBe(false);
    expect(isIgnoredQueryParam("x", ["*"])).toBe(false);
  });
});
