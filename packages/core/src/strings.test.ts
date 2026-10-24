import { describe, expect, it } from "vitest";
import { normalizePageUrl, normalizePattern, originMatches } from "./origins";
import { cutAt, trimTrailingSlashes } from "./strings";
import { urlPath, urlPatternMatches, urlPatternRegexSource } from "./url-pattern";

describe("trimTrailingSlashes / cutAt", () => {
  it("trim like the regexes they replace", () => {
    expect(trimTrailingSlashes("https://x.com///")).toBe("https://x.com");
    expect(trimTrailingSlashes("/a/b")).toBe("/a/b");
    expect(trimTrailingSlashes("///")).toBe("");
    expect(trimTrailingSlashes("")).toBe("");
    expect(cutAt("/a?b#c", "?#")).toBe("/a");
    expect(cutAt("/a#b?c", "?#")).toBe("/a");
    expect(cutAt("/a", "?#")).toBe("/a");
    expect(cutAt("example.com/path/x", "/")).toBe("example.com");
  });
});

// CodeQL js/polynomial-redos: these inputs took seconds with `/\/+$/` and `/[?#].*$/`. Linear code
// handles 200 000 characters in a few milliseconds; the bound is generous for slow CI machines.
describe("no quadratic time on hostile input", () => {
  const slashes = `/${"/".repeat(200_000)}x`;
  const hashes = `#${"#".repeat(200_000)}`;
  const fast = (fn: () => unknown) => {
    const t = performance.now();
    fn();
    return performance.now() - t;
  };

  it("url patterns", () => {
    expect(fast(() => urlPatternRegexSource(slashes.slice(0, 400)))).toBeLessThan(200);
    expect(fast(() => urlPath(hashes))).toBeLessThan(200);
    expect(fast(() => urlPath(slashes))).toBeLessThan(200);
    expect(fast(() => urlPatternMatches("/a/*", slashes))).toBeLessThan(200);
  });

  it("origin patterns and page URLs", () => {
    expect(fast(() => normalizePattern(slashes))).toBeLessThan(200);
    expect(fast(() => originMatches("https://example.com", `example.com${slashes}`))).toBeLessThan(200);
    expect(fast(() => normalizePageUrl(`https://example.com${slashes}/`))).toBeLessThan(200);
  });

  it("keeps the old results", () => {
    expect(normalizePattern("https://Example.com/some/path")).toBe("example.com");
    expect(originMatches("https://example.com", "https://example.com/x")).toBe(true);
    expect(urlPath("/blog/post?x=1#top")).toBe("/blog/post");
    expect(urlPatternRegexSource("/blog/*/?q#h")).toBe("^/blog/.*/?$");
    expect(normalizePageUrl("https://x.com/pricing///")).toBe("https://x.com/pricing");
  });
});
