// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { environment } from "./env";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

describe("environment", () => {
  it("sends the full user agent and browser version normally", () => {
    const e = environment(false, UA);
    expect(e.userAgent).toBe(UA);
    expect(e.browser).toBe("Chrome 141");
    expect(e.os).toBe("Windows");
  });

  it("privacy mode reduces it to browser and OS family (wave-3 §3)", () => {
    const e = environment(true, UA);
    expect(e.userAgent).toBe("Chrome on Windows");
    expect(e.browser).toBe("Chrome");
    expect(e.os).toBe("Windows");
    expect(JSON.stringify(e)).not.toMatch(/141|537|NT 10/);
    expect(e).not.toHaveProperty("timezone");
    expect(e).not.toHaveProperty("referrer");
    expect(environment(true, "curl/8").userAgent).toBe("Unknown browser on unknown OS");
  });
});
