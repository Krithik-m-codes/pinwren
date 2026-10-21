import { describe, expect, it } from "vitest";
import { isOriginAllowed, normalizePageUrl, originMatches } from "./origins";

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
});
