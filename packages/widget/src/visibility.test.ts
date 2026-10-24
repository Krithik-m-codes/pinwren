import { describe, expect, it } from "vitest";
import { allowedByMode, hiddenBy, isProductionHost } from "./visibility";

describe("isProductionHost", () => {
  it.each([
    "localhost",
    "app.localhost",
    "127.0.0.1",
    "127.4.5.6",
    "[::1]",
    "::1",
    "0.0.0.0",
    "10.0.0.12",
    "192.168.1.20",
    "172.16.0.1",
    "172.31.255.255",
    "shop.local",
    "shop.test",
    "api.internal",
    "staging.example.com",
    "stage.example.com",
    "preview.example.com",
    "preview-42.example.com",
    "dev.example.com",
    "dev2.example.com",
    "dev-eu.example.com",
    "app.staging.example.com",
    "",
  ])("%s is not production", (host) => {
    expect(isProductionHost(host)).toBe(false);
  });

  it.each([
    "example.com",
    "www.example.com",
    "pinwren.dev", // `.dev` is a real TLD
    "shop.preview", // ditto for the last label
    "devtools.example.com",
    "developer.example.com",
    "8.8.8.8",
    "172.32.0.1",
    "Example.COM.",
  ])("%s is production", (host) => {
    expect(isProductionHost(host)).toBe(true);
  });
});

describe("hiddenBy", () => {
  const prod = { environments: "non-production", minViewportWidth: 0 } as const;
  it("hides on production hosts only when asked to", () => {
    expect(hiddenBy(prod, { hostname: "example.com", width: 1200, forceShow: false })).toBe("environment");
    expect(hiddenBy(prod, { hostname: "localhost", width: 1200, forceShow: false })).toBeNull();
    expect(
      hiddenBy(
        { environments: "all", minViewportWidth: 0 },
        { hostname: "example.com", width: 1200, forceShow: false },
      ),
    ).toBeNull();
  });
  it("hides below the minimum viewport width", () => {
    const v = { environments: "all", minViewportWidth: 768 } as const;
    expect(hiddenBy(v, { hostname: "example.com", width: 767, forceShow: false })).toBe("viewport");
    expect(hiddenBy(v, { hostname: "example.com", width: 768, forceShow: false })).toBeNull();
  });
  it("forceShow overrides every rule", () => {
    const v = { environments: "non-production", minViewportWidth: 2000 } as const;
    expect(hiddenBy(v, { hostname: "example.com", width: 300, forceShow: true })).toBeNull();
  });
});

describe("allowedByMode (wave-5)", () => {
  const page = {
    url: "https://shop.test/app/orders",
    identified: false,
    flagged: false,
    review: false,
    host: null,
  };
  const v = (
    mode: "always" | "identified" | "queryParam" | "urlPatterns" | "manual",
    urlPatterns: string[] = [],
  ) => ({
    mode,
    urlPatterns,
  });
  it("applies each mode", () => {
    expect(allowedByMode(v("always"), page)).toBe(true);
    expect(allowedByMode(v("identified"), page)).toBe(false);
    expect(allowedByMode(v("identified"), { ...page, identified: true })).toBe(true);
    expect(allowedByMode(v("queryParam"), page)).toBe(false);
    expect(allowedByMode(v("queryParam"), { ...page, flagged: true })).toBe(true);
    expect(allowedByMode(v("urlPatterns", ["/app/*"]), page)).toBe(true);
    expect(allowedByMode(v("urlPatterns", ["/blog/:slug"]), page)).toBe(false);
    expect(allowedByMode(v("manual"), page)).toBe(false);
  });
  it("lets the host and review links override the mode", () => {
    expect(allowedByMode(v("manual"), { ...page, host: "show" })).toBe(true);
    expect(allowedByMode(v("always"), { ...page, host: "hide" })).toBe(false);
    expect(allowedByMode(v("manual"), { ...page, review: true })).toBe(true);
    expect(allowedByMode(v("manual"), { ...page, review: true, host: "hide" })).toBe(false);
  });
});
