// @vitest-environment node
import { describe, expect, it } from "vitest";
import { close, destroy, identify, init, load, on, open, setPageScope } from "./loader";

describe("npm entry during server-side rendering", () => {
  it("does nothing and never touches window", async () => {
    expect(typeof window).toBe("undefined");
    expect(() => {
      init({ projectKey: "pk_1", endpoint: "https://fb.example.com" });
      open("comment");
      close();
      identify({ id: "1" });
      setPageScope({ urlPattern: "/x" });
      destroy();
      on("ready", () => undefined)();
    }).not.toThrow();
    await expect(load("https://fb.example.com")).rejects.toThrow("browser");
  });
});
