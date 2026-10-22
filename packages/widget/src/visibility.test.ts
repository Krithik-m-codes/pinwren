import { describe, expect, it } from "vitest";
import { hiddenBy, isProductionHost } from "./visibility";

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
