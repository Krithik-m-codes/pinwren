import { describe, expect, it, vi } from "vitest";
import { identityOf, urlPatternOf } from "./identity";

const SIG = "a".repeat(64);

describe("identityOf (wave-4 §4)", () => {
  it("keeps the id and a hex HMAC-SHA256 signature", () => {
    expect(
      identityOf({ id: "u_42", name: " Maria ", email: "m@example.com" }, { signature: SIG.toUpperCase() }),
    ).toEqual({
      id: "u_42",
      name: "Maria",
      email: "m@example.com",
      signature: SIG,
    });
  });
  it("accepts numeric ids", () => {
    expect(identityOf({ id: 42 }, { signature: SIG }).id).toBe("42");
  });
  it("drops a malformed signature, and any signature without an id", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(identityOf({ id: "u_1" }, { signature: "not-hex" }).signature).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
    expect(identityOf({ name: "Anon" }, { signature: SIG }).signature).toBeUndefined();
    warn.mockRestore();
  });
  it("ignores junk", () => {
    expect(identityOf(null, undefined)).toEqual({});
    expect(identityOf({ id: {}, name: 5, email: "" }, 7)).toEqual({
      id: undefined,
      name: undefined,
      email: undefined,
      signature: undefined,
    });
    expect(identityOf({ id: "x".repeat(300) }, undefined).id).toHaveLength(200);
  });
});

describe("urlPatternOf", () => {
  it("trims and caps the pattern; anything else is no scope", () => {
    expect(urlPatternOf(" /product/:id ")).toBe("/product/:id");
    expect(urlPatternOf("x".repeat(600))).toHaveLength(500);
    expect(urlPatternOf("")).toBeUndefined();
    expect(urlPatternOf(null)).toBeUndefined();
    expect(urlPatternOf(12)).toBeUndefined();
  });
});
