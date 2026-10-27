import { describe, expect, it } from "vitest";
import {
  differentOrigin,
  doctorCommand,
  INSTALL_METHODS,
  installSnippets,
  patternForOrigin,
} from "./install";

describe("install snippets", () => {
  it("point every method at the configured public URL and key", () => {
    const s = installSnippets("https://feedback.example.com/", "pk_abc");
    for (const m of INSTALL_METHODS) {
      expect(s[m]).toContain("https://feedback.example.com");
      expect(s[m]).not.toContain("example.com//");
      expect(s[m]).toContain("pk_abc");
    }
    expect(s.npm).toContain('import { init } from "@pinwren/widget"');
    expect(s.react).toContain("<Pinwren projectKey=");
    expect(s.html).toBe(
      '<script src="https://feedback.example.com/widget.js" data-project="pk_abc" async></script>',
    );
  });

  it("builds the doctor command with an origin when a site is known", () => {
    expect(doctorCommand("https://f.example.com", "pk_1")).toBe(
      "npx @pinwren/cli doctor --url https://f.example.com --key pk_1",
    );
    expect(doctorCommand("https://f.example.com", "pk_1", "www.shop.com")).toBe(
      "npx @pinwren/cli doctor --url https://f.example.com --key pk_1 --origin https://www.shop.com",
    );
    expect(doctorCommand("https://f.example.com", "pk_1", "*.shop.com")).toContain(
      "--origin https://www.shop.com",
    );
  });
});

describe("refused origins", () => {
  it("allow the host, keeping an explicit port", () => {
    expect(patternForOrigin("https://www.example.com")).toBe("www.example.com");
    expect(patternForOrigin("http://localhost:3000")).toBe("localhost:3000");
    expect(patternForOrigin("https://Shop.Example.com:8443")).toBe("shop.example.com:8443");
    expect(patternForOrigin("file:///x")).toBeNull();
    expect(patternForOrigin("nonsense")).toBeNull();
  });

  it("notices a dashboard opened on another address", () => {
    expect(differentOrigin("http://localhost:3100", "https://feedback.example.com")).toBe(true);
    expect(differentOrigin("https://feedback.example.com", "https://feedback.example.com/")).toBe(false);
    expect(differentOrigin(null, "https://feedback.example.com")).toBe(false);
  });
});
